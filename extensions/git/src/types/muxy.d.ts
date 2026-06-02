export {};

interface MuxyProject {
  path: string;
  isActive?: boolean;
}

interface MuxyExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

interface MuxyExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

interface MuxyToastOptions {
  title?: string;
  body: string;
  variant?: "success" | "error" | "info" | "warning";
}

interface MuxyOpenExtensionTab {
  kind: "extensionWebView";
  extension: { id: string; tabType: string; singleton?: boolean; data?: Record<string, unknown> };
}

interface MuxyWorktree {
  id: string;
  name: string;
  path: string;
  branch?: string | null;
  isPrimary: boolean;
}

interface MuxyTheme {
  colorScheme: "light" | "dark";
  accent?: string;
}

interface MuxyGitFile {
  path: string;
  oldPath: string | null;
  status: string;
  isStaged: boolean;
  isUnstaged: boolean;
  isBinary: boolean;
  additions: number | null;
  deletions: number | null;
}

interface MuxyGitAheadBehind {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

interface MuxyGitPRChecks {
  status: "none" | "pending" | "success" | "failure";
  passing: number;
  failing: number;
  pending: number;
  total: number;
}

interface MuxyGitPR {
  url: string;
  number: number;
  state: string;
  isDraft: boolean;
  baseBranch: string;
  mergeable: boolean | null;
  mergeStateStatus: string;
  isCrossRepository: boolean;
  checks: MuxyGitPRChecks;
}

interface MuxyGitStatus {
  branch: string;
  aheadBehind: MuxyGitAheadBehind;
  defaultBranch: string | null;
  branches: string[];
  stagedFiles: MuxyGitFile[];
  unstagedFiles: MuxyGitFile[];
  pullRequest: MuxyGitPR | null;
}

interface MuxyGitDiffRow {
  kind: "hunk" | "context" | "addition" | "deletion" | "collapsed";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldText: string | null;
  newText: string | null;
  text: string;
}

interface MuxyGitDiff {
  additions: number;
  deletions: number;
  truncated: boolean;
  rows: MuxyGitDiffRow[];
}

interface MuxyGitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorDate: string;
  isMerge: boolean;
  parentHashes: string[];
  refs: { name: string; kind: string }[];
}

interface MuxyGitWorktreeRecord {
  path: string;
  branch: string | null;
  head: string | null;
  isBare: boolean;
  isDetached: boolean;
  isPrunable: boolean;
}

interface MuxyGitScope {
  project?: string;
}

interface MuxyGit {
  status(opts?: MuxyGitScope): Promise<MuxyGitStatus>;
  diff(opts: MuxyGitScope & { filePath: string; staged?: boolean; lineLimit?: number }): Promise<MuxyGitDiff>;
  log(opts?: MuxyGitScope & { maxCount?: number; skip?: number }): Promise<MuxyGitCommit[]>;
  branches(opts?: MuxyGitScope): Promise<string[]>;
  currentBranch(opts?: MuxyGitScope): Promise<string>;
  aheadBehind(opts?: MuxyGitScope): Promise<MuxyGitAheadBehind>;
  worktrees(opts?: MuxyGitScope): Promise<MuxyGitWorktreeRecord[]>;
  stage(opts: MuxyGitScope & { paths?: string[] }): Promise<void>;
  unstage(opts: MuxyGitScope & { paths?: string[] }): Promise<void>;
  discard(opts: MuxyGitScope & { paths?: string[]; untrackedPaths?: string[] }): Promise<void>;
  commit(opts: MuxyGitScope & { message: string; stageAll?: boolean }): Promise<{ hash: string }>;
  push(opts?: MuxyGitScope): Promise<void>;
  pull(opts?: MuxyGitScope): Promise<void>;
  branch: {
    create(opts: MuxyGitScope & { name: string }): Promise<void>;
    switchTo(opts: MuxyGitScope & { branch: string }): Promise<void>;
  };
  pr: {
    info(opts?: MuxyGitScope): Promise<MuxyGitPR | null>;
    list(opts?: MuxyGitScope & { filter?: "open" | "closed" | "merged" | "all"; limit?: number }): Promise<MuxyGitPR[]>;
    create(opts: MuxyGitScope & { title: string; body?: string; baseBranch?: string; draft?: boolean }): Promise<MuxyGitPR>;
    merge(opts: MuxyGitScope & { number: number; method?: "merge" | "squash" | "rebase"; deleteBranch?: boolean }): Promise<void>;
    close(opts: MuxyGitScope & { number: number }): Promise<void>;
  };
  worktree: {
    add(opts: MuxyGitScope & { path: string; branch: string; createBranch?: boolean; baseBranch?: string }): Promise<void>;
    remove(opts: MuxyGitScope & { path: string; force?: boolean }): Promise<void>;
  };
}

interface MuxyBridge {
  extensionID: string;
  data?: Record<string, unknown>;
  theme?: MuxyTheme;
  onThemeChange?(handler: (theme: MuxyTheme) => void): void;
  onDataChange?(handler: (data: Record<string, unknown>) => void): void;
  projects: { list(): Promise<MuxyProject[]> };
  worktrees: {
    list(project?: string): Promise<MuxyWorktree[]>;
    switchTo(identifier: string, project?: string): Promise<void>;
    refresh(project?: string): Promise<void>;
  };
  tabs: { open(target: MuxyOpenExtensionTab): Promise<void> };
  panels: {
    open(panelID: string, data?: Record<string, unknown>): Promise<void>;
    toggle(panelID: string, data?: Record<string, unknown>): Promise<void>;
    close(panelID: string): Promise<void>;
  };
  git: MuxyGit;
  exec(argv: string[], options?: MuxyExecOptions): Promise<MuxyExecResult>;
  exec(options: { shell: string; cwd?: string; timeoutMs?: number }): Promise<MuxyExecResult>;
  toast(opts: MuxyToastOptions): Promise<void>;
  notifications: {
    notify(opts: { title: string; body: string }): Promise<void>;
    toast(opts: MuxyToastOptions): Promise<void>;
  };
  events: {
    subscribe(name: string, handler: (payload: unknown) => void): () => void;
    unsubscribe(name: string, handler: (payload: unknown) => void): void;
  };
}

declare global {
  interface Window {
    muxy: MuxyBridge;
  }
  const muxy: MuxyBridge;
}
