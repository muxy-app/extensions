import { parsePorcelain } from "@/core/status";
import { LOG_FORMAT, parseCommitDetails, parseLog, parseStashList } from "@/core/commits";
import { getCwd, getRoot, pin, repoInfo as targetRepoInfo } from "@/core/target";

export const NO_UPSTREAM = { hasUpstream: false, ahead: 0, behind: 0 };

export function exec(argv, opts = {}) {
  return muxy.exec(argv, { cwd: getRoot() || undefined, ...opts });
}

export async function run(argv, opts = {}) {
  const res = await exec(argv, opts);
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

export const repoInfo = (opts) => targetRepoInfo(opts);

const defaultBranches = new Map();

async function cachedDefaultBranch() {
  const root = getRoot();
  if (!defaultBranches.has(root)) defaultBranches.set(root, await defaultBranchOf(null));
  return defaultBranches.get(root);
}

export async function readStatus() {
  const [text, defaultBranch] = await Promise.all([
    run(["git", "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]),
    cachedDefaultBranch(),
  ]);
  return { ...parsePorcelain(text), defaultBranch };
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
  const res = await exec(["sh", "-c", PENDING_SCRIPT, "sh", gitDir]).catch(() => null);
  return res?.stdout?.trim() || null;
}

export async function upstream() {
  const out = await tryRun(["git", "rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  const [behind, ahead] = out.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return NO_UPSTREAM;
  return { hasUpstream: true, ahead, behind };
}

export const stage = (paths = []) => git(...(paths.length ? ["add", "--", ...paths] : ["add", "-A"]));

export async function unstage(paths = []) {
  const targets = paths.length ? paths : ["."];
  try {
    await git("restore", "--staged", "--", ...targets);
  } catch {
    await git("rm", "--cached", "-r", "-q", "--", ...targets);
  }
}

export async function discard(paths = [], untrackedPaths = []) {
  if (paths.length) await git("restore", "--worktree", "--", ...paths);
  if (untrackedPaths.length) await git("clean", "-fdq", "--", ...untrackedPaths);
}

export async function commit(message, all) {
  if (all) await stage();
  await git("commit", "-m", message);
  return { hash: (await tryRun(["git", "rev-parse", "HEAD"])).trim() };
}

export async function amend(message, all) {
  if (all) await stage();
  return git("commit", "--amend", ...(message ? ["-m", message] : ["--no-edit"]));
}

export async function undoLastCommit() {
  const message = await tryRun(["git", "log", "-1", "--format=%B"]);
  await git("reset", "--soft", "HEAD~1");
  return message.trim();
}

export function push({ setUpstream = false, force = false } = {}) {
  if (force) return run(["git", "push", "--force-with-lease"], { timeoutMs: 120000 });
  return run(["git", "push", ...(setUpstream ? ["--set-upstream", "origin", "HEAD"] : [])], { timeoutMs: 120000 });
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

const refNames = async (pattern) => (await tryRun(["git", "for-each-ref", "--format=%(refname:short)", pattern])).split("\n").filter(Boolean);

export const localBranches = () => refNames("refs/heads");

export async function remoteBranches() {
  return (await refNames("refs/remotes")).filter((name) => !name.endsWith("/HEAD") && name.includes("/"));
}

export const switchBranch = (branch) => git("switch", branch);
export const createBranch = (name) => git("switch", "-c", name);
export const createBranchAt = (name, hash) => git("switch", "-c", name, hash);
export const trackRemote = (ref) => git("switch", "--track", ref);
export const deleteBranch = (name, force) => git("branch", force ? "-D" : "-d", name);
export const deleteRemoteBranch = (branch) => git("push", "origin", "--delete", branch);

export const stashPush = (message, paths = []) =>
  git("stash", "push", "--include-untracked", ...(message ? ["-m", message] : []), ...(paths.length ? ["--", ...paths] : []));
export const stashApply = (ref, pop) => git("stash", pop ? "pop" : "apply", ref);
export const stashDrop = (ref) => git("stash", "drop", ref);

export async function stashList() {
  return parseStashList(await tryRun(["git", "stash", "list", "--format=%gd%x1f%s%x1f%cr"]));
}

export async function log({ skip = 0, maxCount = 100 } = {}) {
  return parseLog(await run(["git", "log", `--skip=${skip}`, `--max-count=${maxCount}`, `--format=${LOG_FORMAT}`]));
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
  const diff = async (...args) => {
    const res = await exec(["git", "diff", "--no-color", "-M", ...args]);
    if (res.exitCode !== 0) throw new Error((res.stderr || "git diff failed").trim());
    return res;
  };
  const [staged, unstaged] = await Promise.all([diff("--cached"), diff()]);
  return { staged: staged.stdout, unstaged: unstaged.stdout, truncated: !!(staged.truncated || unstaged.truncated) };
}

export const remoteUrl = async () => (await tryRun(["git", "remote", "get-url", "origin"])).trim();
export const checkoutCommit = (hash) => git("checkout", hash);
export const cherryPick = (hash) => git("cherry-pick", hash);
export const revert = (hash) => git("revert", "--no-edit", hash);
export const createTag = (name, hash) => git("tag", name, ...(hash ? [hash] : []));
export const initRepo = () => run(["git", "init"], { cwd: getCwd() || undefined });

export function ignorePath(path) {
  return run(["sh", "-c", 'printf "%s\\n" "$1" >> .gitignore', "sh", `/${path}`]);
}

export async function defaultBranchOf(status) {
  if (status?.defaultBranch) return status.defaultBranch;
  const ref = (await tryRun(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
  return ref ? ref.replace(/^origin\//, "") : null;
}

export function parseWorktrees(text) {
  return String(text ?? "")
    .split("\n\n")
    .map((block) => {
      const fields = Object.fromEntries(block.split("\n").map((line) => [line.split(" ")[0], line.slice(line.indexOf(" ") + 1)]));
      return fields.worktree ? { path: fields.worktree, branch: fields.branch ? fields.branch.replace(/^refs\/heads\//, "") : null } : null;
    })
    .filter(Boolean);
}

export async function worktreeList(root) {
  const list = parseWorktrees(await tryRun(["git", "worktree", "list", "--porcelain"]));
  const clean = (path) => String(path ?? "").replace(/\/+$/, "");
  return list.map((entry, index) => ({
    path: clean(entry.path),
    branch: entry.branch,
    primary: index === 0,
    active: clean(entry.path) === clean(root),
  }));
}

const EXPAND_PATH = 'p="$1"; case "$p" in "~/"*) p="$HOME/${p#"~/"}";; esac; shift;';
const WORKTREE_ADD = `${EXPAND_PATH} git worktree add "$p" "$@" >&2 && cd "$p" && pwd`;
const PR_WORKTREE_ADD = `${EXPAND_PATH} git worktree add --detach "$p" >&2 || exit 1
if (cd "$p" && "$@" >&2); then cd "$p" && pwd; exit 0; fi
git worktree remove --force "$p" >&2
exit 1`;

export const worktreeAdd = async (path, ...args) => (await run(["sh", "-c", WORKTREE_ADD, "sh", path, ...args])).trim();
export const worktreeAddWith = async (path, ...checkout) => (await run(["sh", "-c", PR_WORKTREE_ADD, "sh", path, ...checkout])).trim();
export const worktreeRemove = (path, otherRoot, force) => run(["git", "worktree", "remove", ...(force ? ["--force"] : []), path], { cwd: otherRoot });

export async function followWorktree(path) {
  pin(path);
  await muxy.git.worktree.switchTo({ identifier: path }).catch(() => undefined);
}
