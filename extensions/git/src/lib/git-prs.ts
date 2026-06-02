import { run_git } from "@/lib/git";
import {
  run_gh,
  parse_checks,
  parse_mergeable,
  parse_state,
  type PrCheckoutInfo,
  type PrInfo,
  type PrListItem,
} from "@/lib/gh";

const LIST_FIELDS =
  "number,title,author,headRefName,baseRefName,state,isDraft,url,statusCheckRollup";
const INFO_FIELDS =
  "url,number,state,isDraft,baseRefName,mergeable,mergeStateStatus,statusCheckRollup,isCrossRepository";
const CHECKOUT_FIELDS = "number,headRefName,headRepository";

export async function list_prs(cwd: string | undefined): Promise<PrListItem[]> {
  const res = await run_gh(cwd, [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    LIST_FIELDS,
  ]);
  if (!res.ok) return [];
  const raw = safe_parse<Array<Record<string, unknown>>>(res.stdout) ?? [];
  return raw.map((entry) => ({
    number: (entry.number as number) ?? 0,
    title: (entry.title as string) ?? "",
    author: (entry.author as { login?: string })?.login ?? "",
    headBranch: (entry.headRefName as string) ?? "",
    baseBranch: (entry.baseRefName as string) ?? "",
    state: parse_state(entry.state as string),
    isDraft: (entry.isDraft as boolean) ?? false,
    url: (entry.url as string) ?? "",
    checks: parse_checks(entry.statusCheckRollup as never),
  }));
}

export async function view_pr(
  cwd: string | undefined,
  number: number,
): Promise<PrInfo | null> {
  const res = await run_gh(cwd, ["pr", "view", String(number), "--json", INFO_FIELDS], {
    quiet: true,
  });
  if (!res.ok) return null;
  const entry = safe_parse<Record<string, unknown>>(res.stdout);
  if (!entry) return null;
  return {
    url: (entry.url as string) ?? "",
    number: (entry.number as number) ?? number,
    state: parse_state(entry.state as string),
    isDraft: (entry.isDraft as boolean) ?? false,
    baseBranch: (entry.baseRefName as string) ?? "",
    mergeable: parse_mergeable(entry.mergeable as string),
    mergeStateStatus: (entry.mergeStateStatus as string) ?? "",
    checks: parse_checks(entry.statusCheckRollup as never),
    isCrossRepository: (entry.isCrossRepository as boolean) ?? false,
  };
}

export async function checkout_info(
  cwd: string | undefined,
  number: number,
): Promise<PrCheckoutInfo | null> {
  const res = await run_gh(cwd, ["pr", "view", String(number), "--json", CHECKOUT_FIELDS]);
  if (!res.ok) return null;
  const entry = safe_parse<Record<string, unknown>>(res.stdout);
  const headBranch = entry?.headRefName as string | undefined;
  const nameWithOwner = (entry?.headRepository as { nameWithOwner?: string })?.nameWithOwner;
  if (!entry || !headBranch || !nameWithOwner) return null;
  return {
    number: (entry.number as number) ?? number,
    headBranch,
    headRepositoryNameWithOwner: nameWithOwner,
  };
}

export function local_branch_name(info: PrCheckoutInfo): string {
  return `pr/${info.number}/${safe_ref(info.headBranch)}`;
}

function remote_name(info: PrCheckoutInfo): string {
  return `pr-${info.number}-${safe_ref(info.headRepositoryNameWithOwner).replace(/\//g, "-")}`;
}

function safe_ref(value: string): string {
  const segments = value
    .split("/")
    .map((part) =>
      part
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .split("-")
        .filter(Boolean)
        .join("-"),
    )
    .filter(Boolean);
  return segments.length === 0 ? "head" : segments.join("/");
}

async function prepare_branch(
  cwd: string | undefined,
  info: PrCheckoutInfo,
): Promise<boolean> {
  const remote = remote_name(info);
  const branch = local_branch_name(info);

  const remotes = await run_git(cwd, ["remote"], { quiet: true });
  const hasRemote = remotes.stdout.split("\n").some((line) => line.trim() === remote);
  if (!hasRemote) {
    const add = await run_git(cwd, [
      "remote",
      "add",
      remote,
      `https://github.com/${info.headRepositoryNameWithOwner}.git`,
    ]);
    if (!add.ok) return false;
  }

  const fetch = await run_git(cwd, [
    "fetch",
    remote,
    `refs/heads/${info.headBranch}:refs/remotes/${remote}/${info.headBranch}`,
  ]);
  if (!fetch.ok) return false;

  const exists = await run_git(
    cwd,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { quiet: true },
  );
  const branchRes = exists.ok
    ? await run_git(cwd, [
        "branch",
        `--set-upstream-to=${remote}/${info.headBranch}`,
        branch,
      ])
    : await run_git(cwd, [
        "branch",
        "--track",
        branch,
        `refs/remotes/${remote}/${info.headBranch}`,
      ]);
  if (!branchRes.ok) return false;

  await run_git(cwd, ["config", `branch.${branch}.muxy-pr-number`, String(info.number)], {
    quiet: true,
  });
  return true;
}

export async function checkout_pr_here(
  cwd: string | undefined,
  number: number,
): Promise<{ ok: boolean; branch?: string }> {
  const info = await checkout_info(cwd, number);
  if (!info) return { ok: false };
  if (!(await prepare_branch(cwd, info))) return { ok: false };
  const branch = local_branch_name(info);
  const res = await run_git(cwd, ["switch", branch]);
  return { ok: res.ok, branch };
}

export async function checkout_pr_worktree(
  cwd: string | undefined,
  number: number,
  worktreePath: string,
): Promise<{ ok: boolean; branch?: string; path?: string }> {
  const info = await checkout_info(cwd, number);
  if (!info) return { ok: false };
  if (!(await prepare_branch(cwd, info))) return { ok: false };
  const branch = local_branch_name(info);
  const res = await run_git(cwd, ["worktree", "add", "--", worktreePath, branch]);
  return { ok: res.ok, branch, path: worktreePath };
}

function safe_parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
