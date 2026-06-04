import { exec_git } from "@/lib/git";

export async function has_pending_changes(cwd: string | undefined): Promise<boolean> {
  const res = await muxy.exec(["git", "status", "--porcelain"], { cwd }).catch(() => null);
  if (!res || res.exitCode !== 0) return false;
  return res.stdout.trim().length > 0;
}

export async function commit_all(cwd: string | undefined, message: string): Promise<boolean> {
  const staged = await exec_git(cwd, ["add", "-A"], "Could not stage changes");
  if (!staged) return false;
  return exec_git(cwd, ["commit", "-m", message], "Could not commit changes");
}
