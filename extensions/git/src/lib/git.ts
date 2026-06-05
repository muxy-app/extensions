import type { BranchList, FileEntry, GitStatus } from "@/lib/types";

interface ProjectCandidate {
  path: string;
  isActive?: boolean;
}

interface WorktreeCandidate {
  path: string;
  isPrimary: boolean;
}

let resolvedProject = false;
let cachedProject: string | undefined;
let inflightProject: Promise<string | undefined> | null = null;
let busyDepth = 0;
const busyListeners = new Set<(busy: boolean) => void>();

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function resolveGitProjectPath(
  projects: ProjectCandidate[],
  worktrees: WorktreeCandidate[],
): string | undefined {
  const project = projects.find((p) => p.isActive)?.path ?? projects[0]?.path;
  const primary = worktrees.find((w) => w.isPrimary)?.path;
  if (!project) return primary;
  const selected = worktrees.find((w) => samePath(w.path, project));
  if (selected && !selected.isPrimary) return primary;
  return project;
}

export async function activeGitProjectPath(): Promise<string | undefined> {
  const [projects, worktrees] = await Promise.all([
    muxy.projects.list().catch(() => [] as MuxyProject[]),
    muxy.worktrees.list().catch(() => [] as MuxyWorktree[]),
  ]);
  const project = resolveGitProjectPath(projects, worktrees);
  if (!project) return undefined;
  try {
    await muxy.git.repoInfo({ project });
    return project;
  } catch {
    return undefined;
  }
}

function invalidateProject(): void {
  resolvedProject = false;
  inflightProject = null;
  cachedProject = undefined;
}

muxy.events.subscribe("project.switched", invalidateProject);
muxy.events.subscribe("worktree.switched", invalidateProject);

export async function activeProject(): Promise<string | undefined> {
  if (resolvedProject) return cachedProject;
  if (!inflightProject) {
    inflightProject = activeGitProjectPath().then((value) => {
      cachedProject = value;
      resolvedProject = true;
      inflightProject = null;
      return value;
    });
  }
  return inflightProject;
}

export function isBusy(): boolean {
  return busyDepth > 0;
}

export function onBusyChange(fn: (busy: boolean) => void): () => void {
  busyListeners.add(fn);
  return () => busyListeners.delete(fn);
}

function setBusyDepth(next: number): void {
  const was = busyDepth > 0;
  busyDepth = next;
  const now = busyDepth > 0;
  if (was !== now) for (const fn of busyListeners) fn(now);
}

export async function runPinned<T>(fn: (project?: string) => Promise<T>): Promise<T> {
  const project = await activeProject();
  setBusyDepth(busyDepth + 1);
  try {
    return await fn(project);
  } finally {
    setBusyDepth(busyDepth - 1);
  }
}

export async function activeWorktreePath(): Promise<string | undefined> {
  try {
    const worktrees = await muxy.worktrees.list();
    const active = worktrees.find((w) => w.isActive) ?? worktrees.find((w) => w.isPrimary);
    return active?.path ?? worktrees[0]?.path;
  } catch {
    return undefined;
  }
}

export async function openDiff(focusPath: string): Promise<void> {
  try {
    const cwd = await activeWorktreePath();
    void muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "diff-viewer",
        singleton: true,
        data: { focusPath, cwd },
      },
    });
  } catch {
    return;
  }
}

export async function openCommitDiff(hash: string, shortHash: string): Promise<void> {
  try {
    const cwd = await activeWorktreePath();
    void muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "diff-viewer",
        singleton: true,
        data: { source: "commit", hash, shortHash, cwd },
      },
    });
  } catch {
    return;
  }
}

export async function openPrDiff(prNumber: number): Promise<void> {
  try {
    const cwd = await activeWorktreePath();
    void muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "diff-viewer",
        singleton: true,
        data: { source: "pr", prNumber, cwd },
      },
    });
  } catch {
    return;
  }
}

export function openUrl(url: string): void {
  if (!url) return;
  void muxy.exec(["open", url]).catch(() => undefined);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const text = String(err).trim();
  return text || "Unknown error";
}

export async function confirmAction(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  critical?: boolean;
}): Promise<boolean> {
  try {
    const choice = await muxy.dialog.confirm({
      title: opts.title,
      message: opts.message,
      buttons: [opts.confirmLabel, "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
      style: opts.critical ? "critical" : "warning",
    });
    return choice === opts.confirmLabel;
  } catch {
    return false;
  }
}

export async function alertError(title: string, err: unknown): Promise<void> {
  try {
    await muxy.dialog.alert({ title, message: errorMessage(err), style: "critical" });
  } catch {
    return;
  }
}

export async function tryAction(
  action: () => Promise<unknown>,
  errorTitle: string,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    await alertError(errorTitle, err);
    return false;
  }
}

export function toViewStatus(s: MuxyGitStatus): GitStatus {
  return {
    branch: s.branch || null,
    defaultBranch: s.defaultBranch,
    ahead: s.aheadBehind.ahead,
    behind: s.aheadBehind.behind,
    staged: s.stagedFiles.map(toEntry),
    unstaged: s.unstagedFiles.map(toEntry),
    pullRequest: s.pullRequest,
  };
}

function toEntry(f: MuxyGitFile): FileEntry {
  return {
    path: f.path,
    label: normalizeLabel(f.status),
    added: f.additions,
    removed: f.deletions,
  };
}

function normalizeLabel(status: string): string {
  const letter = status.trim().charAt(0).toUpperCase();
  return letter || "M";
}

export async function listBranches(): Promise<BranchList> {
  const [branches, current] = await Promise.all([
    muxy.git.branches().catch(() => [] as string[]),
    muxy.git.currentBranch().catch(() => ""),
  ]);
  return { current: current || null, branches };
}

export async function hasPendingChanges(project?: string): Promise<boolean> {
  const s = await muxy.git.status({ local: true, project }).catch(() => null);
  if (!s) return false;
  return s.stagedFiles.length > 0 || s.unstagedFiles.length > 0;
}

export function commitAll(message: string, project?: string): Promise<boolean> {
  return tryAction(
    () => muxy.git.commit({ message, stageAll: true, project }),
    "Could not commit changes",
  );
}
