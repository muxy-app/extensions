import { canonical_dir, strip_slash } from "@/lib/files";

const FOLDER_PRIORITY = { M: 3, R: 3, D: 2, A: 1, "?": 1 };

function normalize_letter(status) {
  const letter = String(status || "").trim().charAt(0).toUpperCase();
  if (letter === "?") return "?";
  if (FOLDER_PRIORITY[letter]) return letter;
  return "M";
}

function merge_status(current, next) {
  if (!current) return next;
  if (current === next) return current;
  return (FOLDER_PRIORITY[next] ?? 0) > (FOLDER_PRIORITY[current] ?? 0) ? next : current;
}

function fold_folders(files) {
  const folders = new Map();
  for (const [path, status] of files) {
    const folderStatus = status === "?" ? "?" : "M";
    let parent = parent_of(path);
    while (parent !== "") {
      folders.set(parent, merge_status(folders.get(parent), folderStatus));
      parent = parent_of(parent);
    }
  }
  return folders;
}

function parent_of(path) {
  const clean = strip_slash(path);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? "" : canonical_dir(clean.slice(0, idx));
}

function build_index(status) {
  const files = new Map();
  const collect = (list) => {
    for (const file of list ?? []) {
      if (!file || typeof file.path !== "string") continue;
      const letter = file.status === "?" ? "?" : normalize_letter(file.status);
      files.set(strip_slash(file.path), merge_status(files.get(strip_slash(file.path)), letter));
    }
  };
  collect(status?.unstagedFiles);
  collect(status?.stagedFiles);
  return { files, folders: fold_folders(files) };
}

export class GitStatusStore {
  constructor() {
    this.files = new Map();
    this.folders = new Map();
    this.available = false;
    this.listeners = new Set();
    this.loadId = 0;
    this.refreshTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  statusFor(path, isDirectory) {
    if (isDirectory) return this.folders.get(canonical_dir(path)) ?? null;
    return this.files.get(strip_slash(path)) ?? null;
  }

  emit() {
    for (const listener of this.listeners) listener();
  }

  scheduleRefresh(delay = 0) {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  async refresh() {
    if (!muxy.git?.status) {
      this.applyResult({ files: new Map(), folders: new Map() }, false);
      return;
    }
    const loadId = ++this.loadId;
    try {
      const status = await muxy.git.status({ local: true });
      if (loadId !== this.loadId) return;
      this.applyResult(build_index(status), true);
    } catch {
      if (loadId !== this.loadId) return;
      this.applyResult({ files: new Map(), folders: new Map() }, false);
    }
  }

  applyResult(index, available) {
    this.files = index.files;
    this.folders = index.folders;
    this.available = available;
    this.emit();
  }

  dispose() {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.listeners.clear();
  }
}
