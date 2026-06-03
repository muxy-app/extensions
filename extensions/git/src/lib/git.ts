import type { FileEntry, GitStatus } from "@/lib/git-status";

export async function active_worktree_path(): Promise<string | undefined> {
  try {
    const worktrees = await muxy.worktrees.list();
    const active = worktrees.find((w) => w.isActive) ?? worktrees.find((w) => w.isPrimary);
    return active?.path ?? worktrees[0]?.path;
  } catch {
    return undefined;
  }
}

export async function open_diff(focusPath: string): Promise<void> {
  try {
    const cwd = await active_worktree_path();
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
    void 0;
  }
}

export async function open_pr_diff(prNumber: number): Promise<void> {
  try {
    const cwd = await active_worktree_path();
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
    void 0;
  }
}

export function open_url(url: string): void {
  if (!url) return;
  void muxy.exec(["open", url]).catch(() => undefined);
}

export function close_panel(): void {
  try {
    void muxy.panels.close("scm");
  } catch {
    void 0;
  }
}

export function error_message(err: unknown): string {
  if (err instanceof Error) return err.message;
  const text = String(err).trim();
  return text || "Unknown error";
}

export async function confirm_action(opts: {
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

export async function alert_error(title: string, err: unknown): Promise<void> {
  try {
    await muxy.dialog.alert({ title, message: error_message(err), style: "critical" });
  } catch {
    void 0;
  }
}

export async function try_action(action: () => Promise<unknown>, error_title: string): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    await alert_error(error_title, err);
    return false;
  }
}

export async function exec_git(
  cwd: string | undefined,
  args: string[],
  error_title: string,
): Promise<boolean> {
  const res = await muxy.exec(["git", ...args], { cwd }).catch(() => null);
  if (!res || res.exitCode !== 0) {
    const message = (res?.stderr || res?.stdout || "git failed").trim() || "git failed";
    await alert_error(error_title, new Error(message));
    return false;
  }
  return true;
}

export function to_view_status(s: MuxyGitStatus): GitStatus {
  return {
    branch: s.branch || null,
    defaultBranch: s.defaultBranch,
    ahead: s.aheadBehind.ahead,
    behind: s.aheadBehind.behind,
    staged: s.stagedFiles.map(to_entry),
    unstaged: s.unstagedFiles.map(to_entry),
    pullRequest: s.pullRequest,
  };
}

function to_entry(f: MuxyGitFile): FileEntry {
  return {
    path: f.path,
    label: normalize_label(f.status),
    added: f.additions,
    removed: f.deletions,
  };
}

function normalize_label(status: string): string {
  const letter = status.trim().charAt(0).toUpperCase();
  return letter || "M";
}
