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

export type RepoState =
  | { kind: "loading" }
  | { kind: "no_repo" }
  | { kind: "ready"; status: GitStatus };

export type TabId = "branch" | "prs" | "history";
export type PrFilter = "open" | "closed" | "merged" | "all";
export type MergeMethod = "merge" | "squash" | "rebase";
export type PrAction = MergeMethod | "close" | "cleanup";
export type RowAction = "checkout" | "worktree" | "close" | "diff";

export interface CreatePrInput {
  title: string;
  body: string;
  baseBranch?: string;
  newBranch?: string;
  draft?: boolean;
}

export interface CommitRef {
  name: string;
  kind: string;
}

export interface CommitNode {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorDate: string;
  isMerge: boolean;
  parentHashes: string[];
  refs: CommitRef[];
}

export interface GraphEdge {
  fromColumn: number;
  toColumn: number;
}

export interface CommitLane {
  column: number;
  passthrough: number[];
  edges: GraphEdge[];
  width: number;
}

export interface GraphRow {
  commit: CommitNode;
  lane: CommitLane;
}

export interface GraphState {
  rows: GraphRow[];
  hasMore: boolean;
  loading: boolean;
}

export interface BranchList {
  current: string | null;
  branches: string[];
}

export interface CleanupTarget {
  branch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
}
