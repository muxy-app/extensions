export interface FileEntry {
  path: string;
  label: string;
  added: number | null;
  removed: number | null;
}

export interface GitStatus {
  branch: string | null;
  defaultBranch: string | null;
  ahead: number;
  behind: number;
  staged: FileEntry[];
  unstaged: FileEntry[];
  pullRequest: MuxyGitPR | null;
}
