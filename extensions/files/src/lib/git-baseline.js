import { strip_slash } from "@/lib/files";
import { worktree_root } from "@/lib/worktree-root";

export async function head_baseline(filePath) {
  const rel = strip_slash(filePath);
  if (!rel) return null;
  try {
    const cwd = await worktree_root();
    const res = await muxy.exec(["git", "show", `HEAD:${rel}`], { cwd });
    if (res.exitCode !== 0) return null;
    return res.stdout;
  } catch {
    return null;
  }
}
