export interface FileEntry {
  path: string;
  label: string;
  added: number | null;
  removed: number | null;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  staged: FileEntry[];
  unstaged: FileEntry[];
}

export function parse_status(stdout: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
  };

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const tag = line[0];

    if (tag === "#") {
      if (line.startsWith("# branch.head ")) {
        status.branch = line.slice("# branch.head ".length);
      } else if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          status.ahead = Number(match[1]);
          status.behind = Number(match[2]);
        }
      }
    } else if (tag === "1" || tag === "2") {
      const parts = line.split(" ");
      const [x, y] = parts[1];
      const path = parts
        .slice(tag === "1" ? 8 : 9)
        .join(" ")
        .split("\t")[0];
      if (x !== ".") status.staged.push(make_entry(path, x));
      if (y !== ".") status.unstaged.push(make_entry(path, y));
    } else if (tag === "u") {
      status.unstaged.push(make_entry(line.split(" ").slice(10).join(" "), "U"));
    } else if (tag === "?") {
      status.unstaged.push(make_entry(line.slice(2), "?"));
    }
  }

  return status;
}

function make_entry(path: string, label: string): FileEntry {
  return { path, label, added: null, removed: null };
}

export type DiffStats = Map<string, { added: number | null; removed: number | null }>;

export function parse_numstat(stdout: string): DiffStats {
  const stats: DiffStats = new Map();
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [a, r, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    stats.set(path, {
      added: a === "-" ? null : Number(a),
      removed: r === "-" ? null : Number(r),
    });
  }
  return stats;
}

export function apply_stats(entries: FileEntry[], stats: DiffStats): void {
  for (const entry of entries) {
    const s = stats.get(entry.path);
    if (s) {
      entry.added = s.added;
      entry.removed = s.removed;
    }
  }
}
