// Git status for tree decorations. `build_git_index` is pure (unit-tested);
// `GitStatus` refreshes it with at most one request in flight, coalesces
// bursts, and only notifies when the index actually changed.

import { parent_of, strip_slash } from "@/shared/paths";

// What a folder shows when it contains changes of several kinds.
const PRIORITY = { M: 3, R: 3, D: 2, A: 1, "?": 1 };

// `status` is a porcelain column letter; copies, type changes, and conflicts
// (C, T, U) read as modified.
function letter_of(status) {
  const letter = String(status ?? "").trim().charAt(0).toUpperCase();
  return letter === "?" || PRIORITY[letter] ? letter : "M";
}

function merge(current, next) {
  if (!current || current === next) return next;
  return (PRIORITY[next] ?? 0) > (PRIORITY[current] ?? 0) ? next : current;
}

/** `{ files: Map<path, letter>, folders: Map<dir/, letter>, key }` from `git.status()`. */
export function build_git_index(status) {
  const files = new Map();
  for (const list of [status?.unstagedFiles, status?.stagedFiles]) {
    for (const file of list ?? []) {
      if (!file || typeof file.path !== "string") continue;
      const path = strip_slash(file.path);
      files.set(path, merge(files.get(path), letter_of(file.status)));
    }
  }
  const folders = new Map();
  for (const [path, letter] of files) {
    const folderLetter = letter === "?" ? "?" : "M";
    for (let dir = parent_of(path); dir !== ""; dir = parent_of(dir)) {
      const merged = merge(folders.get(dir), folderLetter);
      if (merged === folders.get(dir)) break;
      folders.set(dir, merged);
    }
  }
  const key = [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, l]) => `${l}${p}`).join("\n");
  return { files, folders, key };
}

const EMPTY = { files: new Map(), folders: new Map(), key: "" };

export class GitStatus {
  constructor(onChange) {
    this.onChange = onChange;
    this.index = EMPTY;
    this.available = false;
    this.timer = null;
    this.inFlight = false;
    this.again = false;
    this.generation = 0;
  }

  statusOf(entry) {
    return (entry.dir ? this.index.folders.get(entry.path) : this.index.files.get(entry.path)) ?? null;
  }

  get changedFiles() {
    return this.index.files;
  }

  schedule(delay = 300) {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  async refresh() {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    const generation = this.generation;
    let index = EMPTY;
    let available = false;
    try {
      index = build_git_index(await muxy.git.status({ local: true }));
      available = true;
    } catch {}
    this.inFlight = false;
    if (generation !== this.generation) return;
    const changed = index.key !== this.index.key || available !== this.available;
    this.index = index;
    this.available = available;
    if (changed) this.onChange();
    if (this.again) {
      this.again = false;
      this.schedule(0);
    }
  }

  /** Forgets the current project's status (on project or worktree switch). */
  reset() {
    this.generation += 1;
    this.index = EMPTY;
    this.available = false;
    this.again = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight = false;
  }

  dispose() {
    this.reset();
    this.onChange = () => {};
  }
}
