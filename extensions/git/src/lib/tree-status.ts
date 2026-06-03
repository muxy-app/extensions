import type { GitStatus as TreeGitStatus, GitStatusEntry } from "@pierre/trees";
import type { FileEntry } from "@/lib/git-status";

const LABEL_TO_STATUS: Record<string, TreeGitStatus> = {
  A: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
  U: "added",
  "?": "untracked",
};

export function label_to_status(label: string): TreeGitStatus {
  return LABEL_TO_STATUS[label] ?? "modified";
}

export function entries_to_git_status(entries: FileEntry[]): GitStatusEntry[] {
  return entries.map((entry) => ({ path: entry.path, status: label_to_status(entry.label) }));
}

const STATUS_LETTER: Record<TreeGitStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
  ignored: "I",
};

export function status_letter(status: TreeGitStatus): string {
  return STATUS_LETTER[status] ?? "M";
}

export function entries_to_status_map(entries: FileEntry[]): Map<string, TreeGitStatus> {
  return new Map(entries.map((entry) => [entry.path, label_to_status(entry.label)]));
}
