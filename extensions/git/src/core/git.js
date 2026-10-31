import { normalizeStatus, parsePorcelain } from "@/core/status";
import { LOG_FORMAT, normalizeCommit, parseCommitDetails, parseLog, parseStashList } from "@/core/commits";

export async function run(argv, opts = {}) {
  const res = await muxy.exec(argv, opts);
  if (res.exitCode !== 0) throw new Error((res.stderr || res.stdout || `${argv.join(" ")} failed`).trim());
  return res.stdout;
}

export async function tryRun(argv, opts) {
  try {
    return await run(argv, opts);
  } catch {
    return "";
  }
}

const git = (...args) => run(["git", "-c", "core.editor=true", ...args]);

export async function readStatus({ fresh = false } = {}) {
  try {
    return normalizeStatus(await muxy.git.status({ local: true, fresh }));
  } catch (err) {
    const res = await muxy
      .exec(["git", "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"])
      .catch(() => null);
    if (res?.exitCode === 0) return parsePorcelain(res.stdout);
    throw err;
  }
}

const PENDING_SCRIPT = [
  'cd "$1" 2>/dev/null || exit 0',
  "if [ -d rebase-merge ] || [ -d rebase-apply ]; then echo rebase",
  "elif [ -f MERGE_HEAD ]; then echo merge",
  "elif [ -f CHERRY_PICK_HEAD ]; then echo cherry-pick",
  "elif [ -f REVERT_HEAD ]; then echo revert",
  "fi",
].join("\n");

export async function pendingOperation(gitDir) {
  if (!gitDir) return null;
  const res = await muxy.exec(["sh", "-c", PENDING_SCRIPT, "sh", gitDir]).catch(() => null);
  return res?.stdout?.trim() || null;
}

export async function upstream() {
  try {
    const res = await muxy.git.aheadBehind({ fresh: true });
    return { hasUpstream: !!res.hasUpstream, ahead: Number(res.ahead) || 0, behind: Number(res.behind) || 0 };
  } catch {
    return { hasUpstream: false, ahead: 0, behind: 0 };
  }
}

export const stage = (paths) => muxy.git.stage({ paths });
export const unstage = (paths) => muxy.git.unstage({ paths });
export const discard = (paths, untrackedPaths) => muxy.git.discard({ paths, untrackedPaths });

export function commit(message, all) {
  return muxy.git.commit({ message, stageAll: !!all });
}

export function amend(message, all) {
  const args = ["commit", "--amend"];
  if (all) args.push("--all");
  args.push(...(message ? ["-m", message] : ["--no-edit"]));
  return git(...args);
}

export async function undoLastCommit() {
  const message = await tryRun(["git", "log", "-1", "--format=%B"]);
  await git("reset", "--soft", "HEAD~1");
  return message.trim();
}

export function push({ setUpstream = false, force = false } = {}) {
  if (force) return run(["git", "push", "--force-with-lease"], { timeoutMs: 120000 });
  return muxy.git.push({ setUpstream });
}

export function fetch() {
  return run(["git", "fetch", "--prune", "--quiet"], { timeoutMs: 120000 });
}

export function integrate(mode) {
  if (mode === "rebase") return git("rebase", "@{upstream}");
  if (mode === "merge") return git("merge", "--no-edit", "@{upstream}");
  return git("merge", "--ff-only", "@{upstream}");
}

export const abortOperation = (op) => git(op, "--abort");
export const continueOperation = (op) => git(op, "--continue");

export async function localBranches() {
  return (await muxy.git.branches()).map(String);
}

export async function remoteBranches() {
  try {
    return (await muxy.git.remoteBranches()).map(String).filter((name) => !name.endsWith("/HEAD"));
  } catch {
    return [];
  }
}

export const switchBranch = (branch) => muxy.git.branch.switchTo({ branch });
export const createBranch = (name) => muxy.git.branch.create({ name });
export const createBranchAt = (name, hash) => git("switch", "-c", name, hash);
export const trackRemote = (ref) => git("switch", "--track", ref);
export const deleteBranch = (name, force) => muxy.git.branch.delete({ name, force: !!force });
export const deleteRemoteBranch = (branch) => muxy.git.branch.deleteRemote({ branch });

export const stashPush = (message) => git("stash", "push", "--include-untracked", ...(message ? ["-m", message] : []));
export const stashApply = (ref, pop) => git("stash", pop ? "pop" : "apply", ref);
export const stashDrop = (ref) => git("stash", "drop", ref);

export async function stashList() {
  return parseStashList(await tryRun(["git", "stash", "list", "--format=%gd%x1f%s%x1f%cr"]));
}

export async function log({ skip = 0, maxCount = 100, fresh = false } = {}) {
  return (await muxy.git.log({ skip, maxCount, fresh })).map(normalizeCommit);
}

export async function logRange(range, maxCount = 200) {
  return parseLog(await tryRun(["git", "log", `--max-count=${maxCount}`, `--format=${LOG_FORMAT}`, range]));
}

export async function outgoingHashes() {
  return new Set((await tryRun(["git", "rev-list", "--max-count=1000", "@{upstream}..HEAD"])).split("\n").filter(Boolean));
}

export async function commitDetails(hash) {
  return parseCommitDetails(await git("show", "-s", "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%B", hash));
}

export async function commitPatch(hash, parents) {
  if (parents.length > 1) return git("diff", "--no-color", "-M", parents[0], hash);
  return git("show", "--format=", "--no-color", "-M", hash);
}

export const rangePatch = (range) => git("diff", "--no-color", "-M", range);

export async function workingPatches() {
  const [staged, unstaged] = await Promise.all([
    muxy.git.diff({ raw: true, staged: true, fresh: true }),
    muxy.git.diff({ raw: true, staged: false, fresh: true }),
  ]);
  return { staged: staged?.diff ?? "", unstaged: unstaged?.diff ?? "", truncated: !!(staged?.truncated || unstaged?.truncated) };
}

export const remoteUrl = async () => (await tryRun(["git", "remote", "get-url", "origin"])).trim();
export const checkoutCommit = (hash) => muxy.git.checkout({ hash });
export const cherryPick = (hash) => muxy.git.cherryPick({ hash });
export const revert = (hash) => muxy.git.revert({ hash });
export const createTag = (name, hash) => muxy.git.tag.create({ name, hash });
export const initRepo = () => muxy.git.init();

export function ignorePath(path) {
  return run(["sh", "-c", 'printf "%s\\n" "$1" >> .gitignore', "sh", `/${path}`]);
}

export async function defaultBranchOf(status) {
  if (status?.defaultBranch) return status.defaultBranch;
  const ref = (await tryRun(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
  return ref ? ref.replace(/^origin\//, "") : null;
}

export async function worktreeList(root) {
  const list = await muxy.git.worktrees().catch(() => []);
  const clean = (path) => String(path ?? "").replace(/\/+$/, "");
  return list.map((entry, index) => ({
    path: clean(entry.path),
    branch: entry.branch ?? null,
    primary: index === 0,
    active: clean(entry.path) === clean(root),
  }));
}
