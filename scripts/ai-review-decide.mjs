#!/usr/bin/env node
// Job 2 of the Copilot malware review (.github/workflows/ai-review.yml).
//
// The only part of the review with a writable token. It never checks out the
// fork and never talks to the model. It reads the artifact from the review
// job (meta.json written by trusted code, model-output.txt written by the
// model), validates the verdict as untrusted data, and then:
//
//   approved                -> APPROVE review pinned to the head SHA
//   malicious / changes     -> REQUEST_CHANGES review with findings
//   needs-maintainer / inconclusive -> COMMENT review
//
// When it does not approve, it dismisses earlier approvals by this bot so a
// stale approval never survives a new push. The check fails unless approved.

import fs from "node:fs";
import path from "node:path";
import {
  GitHubAPI,
  pullRequestContextFromEnvironment,
  repositoryAPIName,
} from "./lib/github-pr.mjs";
import {
  decide,
  parseVerdict,
  renderReview,
  unreviewedFiles,
} from "./lib/ai-review.mjs";

const BOT_LOGIN = "github-actions[bot]";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_BODY_CHARS = 60_000;
const ESCALATE_RE = /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]{1,100})?$/;

function workflowMessage(kind, message) {
  const escaped = String(message)
    .replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.log(`::${kind}::${escaped}`);
}

function readOptional(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readMeta(dir, context) {
  const text = readOptional(path.join(dir, "meta.json"), 1024 * 1024);
  if (text === null) return null;
  const meta = JSON.parse(text);
  if (meta?.version !== 1) throw new Error("meta.json has an unknown version");
  if (meta.number !== context.number || meta.headSha !== context.headSha) {
    throw new Error("meta.json does not belong to this pull request event");
  }
  const levels = new Set(["blocker", "maintainer", "info"]);
  if (
    !Array.isArray(meta.signals) ||
    !meta.signals.every((s) => levels.has(s?.level) && typeof s.message === "string") ||
    !Array.isArray(meta.requiredFiles) ||
    !Array.isArray(meta.extensionNames)
  ) {
    throw new Error("meta.json is malformed");
  }
  return meta;
}

async function listReviews(api, repository, number) {
  const reviews = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api.get(`/repos/${repository}/pulls/${number}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid review list");
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  return reviews;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.env.AI_REVIEW_DIR ?? "");
  const context = pullRequestContextFromEnvironment();
  const api = new GitHubAPI(process.env.GITHUB_TOKEN);
  const repository = repositoryAPIName(context.baseRepository);
  const reviewJobResult = process.env.REVIEW_JOB_RESULT ?? "";

  let meta = null;
  let error = null;
  try {
    meta = readMeta(dir, context);
  } catch (e) {
    error = `Could not read the review job's results (${e.message}).`;
  }
  if (meta?.skip) {
    console.log("No extension changed; nothing to decide.");
    return;
  }
  if (!meta && !error) {
    error = `The review job did not produce results (job result: ${reviewJobResult || "unknown"}).`;
  }

  let verdict = null;
  if (meta) {
    const exitCode = (readOptional(path.join(dir, "copilot-exit-code"), 64) ?? "").trim();
    const output = readOptional(path.join(dir, "model-output.txt"), MAX_OUTPUT_BYTES);
    try {
      verdict = parseVerdict(output ?? "", meta.nonce);
    } catch (e) {
      error = `Copilot did not return a usable verdict: ${e.message}${exitCode && exitCode !== "0" ? ` (Copilot exited with code ${exitCode})` : ""}.`;
    }
  }

  const signals = meta?.signals ?? [];
  const missingFiles = verdict ? unreviewedFiles(meta.requiredFiles, verdict.filesReviewed) : [];
  const { outcome, event } = decide({ verdict, error, signals, missingFiles });

  const escalateRaw = (process.env.AI_REVIEW_ESCALATE ?? "").trim();
  const escalate = ESCALATE_RE.test(escalateRaw) ? escalateRaw : "";
  if (escalateRaw && !escalate) workflowMessage("warning", "AI_REVIEW_ESCALATE is not a valid @user or @org/team; ignoring it.");

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "";
  let body = renderReview({
    outcome,
    verdict,
    error,
    signals,
    missingFiles,
    headSha: context.headSha,
    extensionNames: meta?.extensionNames ?? [],
    runUrl,
    escalate,
  });
  if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n\n…(truncated; see the workflow run)`;

  console.log(`Outcome: ${outcome} (${event})`);
  if (verdict) console.log(`Copilot: ${verdict.verdict}, ${verdict.confidence} confidence, ${verdict.findings.length} finding(s)`);
  if (error) console.log(`Error: ${error}`);

  if (dryRun) {
    console.log(`\n--- ${event} review body (dry run, not posted) ---\n${body}`);
    return;
  }

  // Only act on the commit that was reviewed. If the PR moved on, a newer run
  // owns the decision.
  const pr = await api.get(`/repos/${repository}/pulls/${context.number}`);
  if (pr?.state !== "open" || pr?.head?.sha !== context.headSha) {
    console.log("The pull request is closed or has a newer head commit; not posting a review.");
    return;
  }

  if (event !== "APPROVE") {
    const reviews = await listReviews(api, repository, context.number);
    for (const review of reviews) {
      if (review?.user?.login === BOT_LOGIN && review.state === "APPROVED" && Number.isSafeInteger(review.id)) {
        await api.request(`/repos/${repository}/pulls/${context.number}/reviews/${review.id}/dismissals`, {
          method: "PUT",
          body: { message: "Superseded by a newer automated security review.", event: "DISMISS" },
        });
        console.log(`Dismissed earlier approval ${review.id}.`);
      }
    }
  }

  await api.post(`/repos/${repository}/pulls/${context.number}/reviews`, {
    commit_id: context.headSha,
    event,
    body,
  });
  console.log(`Posted ${event} review.`);

  if (outcome !== "approved") {
    workflowMessage("error", `Automated security review did not approve: ${outcome}.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  workflowMessage("error", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
