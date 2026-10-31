import { run, tryRun } from "@/core/git";
import { fromTea, parseTeaList, teaQueryState, timeline } from "@/core/forge/normalize";
import { branchSteps, fetchStep, prRef } from "@/core/forge/tea-steps";

const FIELDS = "index,state,title,author,url,mergeable,base,head,ci,updated";

export const kind = "gitea";

export async function list(filter, limit = 100) {
  const out = await run(["tea", "pr", "list", "--state", teaQueryState(filter), "--fields", FIELDS, "--output", "json", "--limit", String(limit)]);
  return parseTeaList(out, filter);
}

async function currentBranch() {
  return (await tryRun(["git", "branch", "--show-current"])).trim();
}

async function single(number, comments = false) {
  const raw = JSON.parse(await run(["tea", "pr", String(number), ...(comments ? ["--comments"] : []), "--output", "json"]));
  return { raw, pr: fromTea(raw) };
}

export async function current() {
  const branch = await currentBranch();
  if (!branch) return null;
  const stored = (await tryRun(["git", "config", "--get", `branch.${branch}.muxy-pr-number`])).trim();
  if (stored) return (await single(stored).catch(() => null))?.pr ?? null;
  const open = await list("open", 100).catch(() => []);
  return open.find((pr) => pr.headBranch === branch || pr.headBranch.endsWith(`:${branch}`)) ?? null;
}

export async function details(number) {
  const { raw, pr } = await single(number, true);
  return {
    ...pr,
    body: String(raw.body ?? ""),
    createdAt: String(raw.created ?? ""),
    additions: null,
    deletions: null,
    changedFiles: null,
    labels: (raw.labels ?? []).map((label) => String(label.name ?? label)).filter(Boolean),
    timeline: timeline(raw.comments ?? [], raw.reviews ?? []),
  };
}

export async function checks() {
  return [];
}

export const comment = (number, body) => run(["tea", "comment", String(number), body]);

export function merge(number, method) {
  const style = method === "squash" || method === "rebase" ? method : "merge";
  return run(["tea", "pr", "merge", "--style", style, String(number)]);
}

export const close = (number) => run(["tea", "pr", "close", String(number)]);

export function ready(pr) {
  const title = pr.title.replace(/^\s*(?:wip:|\[wip\])\s*/i, "").trim() || pr.title;
  return run(["tea", "pr", "edit", "--title", title, String(pr.number)]);
}

export async function updateBranch() {
  throw new Error("Updating a branch is only available for GitHub pull requests.");
}

export function create({ title, body, baseBranch, draft }) {
  const argv = ["tea", "pr", "create", "--title", draft ? `WIP: ${title}` : title, "--description", body ?? ""];
  if (baseBranch) argv.push("--base", baseBranch);
  return run(argv);
}

async function fetchHead(number) {
  await run(fetchStep(number));
  return prRef(number);
}

async function prepareBranch(number) {
  await fetchHead(number);
  const { branch, steps } = branchSteps(number, await currentBranch());
  for (const step of steps) await run(step);
  return branch;
}

export async function checkout(number) {
  const branch = await prepareBranch(number);
  if ((await currentBranch()) !== branch) await run(["git", "switch", branch]);
}

export async function checkoutWorktree(number, path) {
  const branch = await prepareBranch(number);
  await muxy.git.worktree.add({ path, branch, createBranch: false });
}

export async function diff(number) {
  const ref = await fetchHead(number);
  const { pr } = await single(number).catch(() => ({ pr: null }));
  const base = pr?.baseBranch ? `origin/${pr.baseBranch.replace(/^.*:/, "")}` : "origin/HEAD";
  const mergeBase = (await tryRun(["git", "merge-base", base, ref])).trim() || base;
  return run(["git", "diff", "--no-color", "-M", `${mergeBase}..${ref}`]);
}

const NO_RUNS = "Workflow runs are only available for GitHub repositories.";
export const runs = async () => {
  throw new Error(NO_RUNS);
};
export const rerun = runs;
export const cancelRun = runs;
