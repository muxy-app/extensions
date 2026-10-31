const NO_CHECKS = { status: "none", total: 0, passing: 0, failing: 0, pending: 0 };

export function prState(pr) {
  const state = String(pr?.state ?? "").toLowerCase();
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  return "open";
}

export function prTone(pr) {
  if (pr.isDraft && prState(pr) === "open") return "draft";
  return prState(pr);
}

function author(value) {
  if (typeof value === "string") return value;
  return value?.login ?? value?.username ?? value?.name ?? "";
}

function checksSummary(raw) {
  if (!raw) return NO_CHECKS;
  const passing = Number(raw.passing) || 0;
  const failing = Number(raw.failing) || 0;
  const pending = Number(raw.pending) || 0;
  const total = Number(raw.total) || passing + failing + pending;
  let status = String(raw.status ?? "").toLowerCase();
  if (!["success", "failure", "pending"].includes(status)) {
    status = failing ? "failure" : pending ? "pending" : passing ? "success" : "none";
  }
  return { status, total, passing, failing, pending };
}

export function fromGh(raw) {
  return {
    number: Number(raw.number) || 0,
    title: String(raw.title ?? ""),
    author: author(raw.author),
    headBranch: String(raw.headBranch ?? raw.headRefName ?? ""),
    baseBranch: String(raw.baseBranch ?? raw.baseRefName ?? ""),
    state: String(raw.state ?? "").toLowerCase(),
    url: String(raw.url ?? ""),
    isDraft: !!raw.isDraft,
    updatedAt: String(raw.updatedAt ?? ""),
    mergeable: raw.mergeable === true || raw.mergeable === "MERGEABLE" ? true : raw.mergeable === false || raw.mergeable === "CONFLICTING" ? false : null,
    mergeState: String(raw.mergeStateStatus ?? "").toUpperCase(),
    reviewDecision: String(raw.reviewDecision ?? "").toUpperCase(),
    checks: checksSummary(raw.checks),
  };
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return String(value.ref ?? value.name ?? value.label ?? value.login ?? value.username ?? "");
  return String(value);
}

function teaChecks(value) {
  const s = String(value ?? "").toLowerCase();
  let status = "none";
  if (s.includes("fail") || s.includes("error")) status = "failure";
  else if (s.includes("pend") || s.includes("running") || s.includes("progress") || s.includes("wait")) status = "pending";
  else if (s.includes("success") || s.includes("pass")) status = "success";
  const one = status === "none" ? 0 : 1;
  return {
    status,
    total: one,
    passing: status === "success" ? 1 : 0,
    failing: status === "failure" ? 1 : 0,
    pending: status === "pending" ? 1 : 0,
  };
}

function teaState(raw) {
  if (raw.merged || raw.merged_at || raw.has_merged) return "merged";
  return String(raw.state ?? "").toLowerCase() || "open";
}

function teaMergeable(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

export function fromTea(raw) {
  const title = text(raw.title);
  const state = teaState(raw);
  return {
    number: Number(raw.index ?? raw.number) || 0,
    title,
    author: text(raw.author ?? raw.user ?? raw.poster),
    headBranch: text(raw.head),
    baseBranch: text(raw.base),
    state,
    url: text(raw.html_url ?? raw.url),
    isDraft: /^\s*(wip:|\[wip\])/i.test(title),
    updatedAt: text(raw.updated ?? raw.updated_at),
    mergeable: state === "open" ? teaMergeable(raw.mergeable) : null,
    mergeState: "",
    reviewDecision: "",
    checks: teaChecks(raw.ci ?? raw.status),
  };
}

export function parseTeaList(stdout, filter) {
  const data = JSON.parse(String(stdout ?? "").trim() || "[]");
  const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return rows
    .map(fromTea)
    .filter((pr) => (filter === "merged" ? pr.state === "merged" : filter === "closed" ? pr.state === "closed" : true));
}

export function teaQueryState(filter) {
  if (filter === "merged" || filter === "closed") return "closed";
  if (filter === "all") return "all";
  return "open";
}

export function mergeBlocker(pr) {
  if (prState(pr) !== "open") return `This pull request is ${prState(pr)}.`;
  if (pr.isDraft) return "Draft pull requests can't be merged.";
  if (pr.mergeable === false || pr.mergeState === "DIRTY") return "Resolve the merge conflicts first.";
  if (pr.mergeState === "BLOCKED") return "Merging is blocked by branch protection.";
  return null;
}

export function checksLabel(checks) {
  if (!checks || checks.status === "none") return "";
  if (checks.status === "failure") return `${checks.failing || 1} failing`;
  if (checks.status === "pending") return `${checks.pending || 1} running`;
  return `${checks.passing || checks.total} passed`;
}

export function prWorktreePath(root, number) {
  const clean = String(root ?? "").replace(/\/+$/, "");
  if (!clean) return `pr-${number}`;
  const slash = clean.lastIndexOf("/");
  const parent = slash > 0 ? clean.slice(0, slash) : "";
  const name = `${clean.slice(slash + 1) || "repo"}.pr-${number}`;
  return `${parent}/${name}`;
}

export function existingPrUrl(message) {
  const text = String(message ?? "");
  if (!/already exists/i.test(text)) return null;
  return text.match(/https?:\/\/\S+/)?.[0]?.replace(/[.,)\]]+$/, "") ?? null;
}

export function branchSlug(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug;
}

function entry(raw, kind) {
  return {
    id: String(raw.id ?? `${kind}-${raw.submittedAt ?? raw.createdAt ?? raw.created ?? ""}`),
    kind,
    author: author(raw.author ?? raw.user ?? raw.reviewer) || "Unknown",
    body: String(raw.body ?? ""),
    createdAt: String(raw.submittedAt ?? raw.createdAt ?? raw.created ?? ""),
    state: String(raw.state ?? "").toUpperCase(),
  };
}

export function timeline(comments = [], reviews = []) {
  return [
    ...comments.map((raw) => entry(raw, "comment")),
    ...reviews.filter((raw) => String(raw.body ?? "").trim() || ["APPROVED", "CHANGES_REQUESTED"].includes(String(raw.state ?? "").toUpperCase())).map((raw) => entry(raw, "review")),
  ].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export function mergeStatus(pr) {
  const state = prState(pr);
  if (state !== "open") return { label: state === "merged" ? "Merged" : "Closed", tone: "muted" };
  if (pr.isDraft) return { label: "Draft", tone: "muted" };
  if (pr.mergeable === false || pr.mergeState === "DIRTY") return { label: "Has conflicts", tone: "bad" };
  if (pr.mergeState === "BLOCKED") return { label: "Blocked", tone: "bad" };
  if (pr.mergeState === "BEHIND") return { label: "Behind base", tone: "warn" };
  if (pr.mergeState === "UNSTABLE" || pr.checks?.status === "failure") return { label: "Checks failing", tone: "warn" };
  if (pr.checks?.status === "pending") return { label: "Checks running", tone: "muted" };
  if (pr.mergeable === true || pr.mergeState === "CLEAN") return { label: "Ready to merge", tone: "good" };
  return { label: "Unknown", tone: "muted" };
}

export function reviewStatus(pr) {
  if (pr.reviewDecision === "APPROVED") return { label: "Approved", tone: "good" };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { label: "Changes requested", tone: "bad" };
  if (pr.reviewDecision === "REVIEW_REQUIRED") return { label: "Review required", tone: "warn" };
  return { label: "No review required", tone: "muted" };
}

export function rollupChecks(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const check of rollup) {
    const outcome = String(check.conclusion ?? check.state ?? "").toUpperCase();
    const status = String(check.status ?? "").toUpperCase();
    if (status && status !== "COMPLETED") pending += 1;
    else if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome)) passing += 1;
    else if (["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", ""].includes(outcome)) pending += 1;
    else failing += 1;
  }
  return checksSummary({ passing, failing, pending, total: rollup.length });
}
