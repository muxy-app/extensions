import { toast } from "@/lib/git";

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type ChecksStatus = "none" | "pending" | "success" | "failure";

export interface PrChecks {
  status: ChecksStatus;
  passing: number;
  failing: number;
  pending: number;
  total: number;
}

export type PrState = "open" | "merged" | "closed";

export interface PrListItem {
  number: number;
  title: string;
  author: string;
  headBranch: string;
  baseBranch: string;
  state: PrState;
  isDraft: boolean;
  url: string;
  checks: PrChecks;
}

export interface PrInfo {
  url: string;
  number: number;
  state: PrState;
  isDraft: boolean;
  baseBranch: string;
  mergeable: boolean | null;
  mergeStateStatus: string;
  checks: PrChecks;
  isCrossRepository: boolean;
}

export interface PrCheckoutInfo {
  number: number;
  headBranch: string;
  headRepositoryNameWithOwner: string;
}

export async function run_gh(
  cwd: string | undefined,
  args: string[],
  options: { quiet?: boolean } = {},
): Promise<GhResult> {
  const res = await muxy.exec(["gh", ...args], { cwd });
  const ok = res.exitCode === 0;
  if (!ok && !options.quiet) {
    const message = (res.stderr || res.stdout || "gh failed").trim().split("\n")[0];
    toast(message, "error");
  }
  return { ok, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export async function gh_available(cwd: string | undefined): Promise<boolean> {
  const res = await muxy.exec(["gh", "--version"], { cwd }).catch(() => null);
  return res?.exitCode === 0;
}

type RollupEntry = {
  __typename?: string;
  status?: string;
  conclusion?: string;
  state?: string;
};

function classify_outcome(entry: RollupEntry): "passing" | "failing" | "pending" {
  let raw: string;
  if (entry.__typename === "CheckRun") {
    raw =
      (entry.status ?? "").toUpperCase() !== "COMPLETED"
        ? "PENDING"
        : (entry.conclusion ?? "").toUpperCase();
  } else {
    raw = (entry.state ?? "").toUpperCase();
  }
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(raw)) return "passing";
  if (
    ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(raw)
  ) {
    return "failing";
  }
  return "pending";
}

export function parse_checks(rollup: RollupEntry[] | null | undefined): PrChecks {
  if (!rollup || rollup.length === 0) {
    return { status: "none", passing: 0, failing: 0, pending: 0, total: 0 };
  }
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const entry of rollup) {
    const outcome = classify_outcome(entry);
    if (outcome === "passing") passing += 1;
    else if (outcome === "failing") failing += 1;
    else pending += 1;
  }
  const total = passing + failing + pending;
  const status: ChecksStatus =
    failing > 0 ? "failure" : pending > 0 ? "pending" : passing > 0 ? "success" : "none";
  return { status, passing, failing, pending, total };
}

export function parse_state(raw: string | undefined): PrState {
  const lowered = (raw ?? "open").toLowerCase();
  if (lowered === "merged") return "merged";
  if (lowered === "closed") return "closed";
  return "open";
}

export function parse_mergeable(raw: string | undefined): boolean | null {
  if (raw === "MERGEABLE") return true;
  if (raw === "CONFLICTING") return false;
  return null;
}
