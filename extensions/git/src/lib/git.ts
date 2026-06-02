export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function toast(message: string, variant: "success" | "error" = "success"): void {
  try {
    void muxy.toast({ title: "Git", body: message, variant });
  } catch {
    void 0;
  }
}

export function open_diff(focusPath: string): void {
  try {
    void muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "diff-viewer",
        singleton: true,
        data: { focusPath },
      },
    });
  } catch {
    void 0;
  }
}

export async function open_pr_diff(prNumber: number, prTitle: string): Promise<void> {
  try {
    const cwd = await resolve_cwd();
    void muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "diff-viewer",
        singleton: true,
        data: { source: "pr", prNumber, prTitle, cwd },
      },
    });
  } catch {
    void 0;
  }
}

export function close_panel(): void {
  try {
    void muxy.panels.close("scm");
  } catch {
    void 0;
  }
}

export async function resolve_cwd(): Promise<string | undefined> {
  try {
    const projects = await muxy.projects.list();
    const active = projects.find((p) => p.isActive) ?? projects[0];
    return active?.path;
  } catch {
    return undefined;
  }
}

export async function run_git(
  cwd: string | undefined,
  args: string[],
  options: { quiet?: boolean } = {},
): Promise<GitResult> {
  const res = await muxy.exec(["git", ...args], { cwd });
  const ok = res.exitCode === 0;
  if (!ok && !options.quiet) {
    const message = (res.stderr || res.stdout || "git failed").trim().split("\n")[0];
    toast(message, "error");
  }
  return { ok, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
