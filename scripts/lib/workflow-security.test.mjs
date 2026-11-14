import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const validateWorkflow = fs.readFileSync(
  new URL("../../.github/workflows/validate.yml", import.meta.url),
  "utf8",
);
const securityWorkflow = fs.readFileSync(
  new URL("../../.github/workflows/security-comment.yml", import.meta.url),
  "utf8",
);
const aiReviewWorkflow = fs.readFileSync(
  new URL("../../.github/workflows/ai-review.yml", import.meta.url),
  "utf8",
);

test("privileged workflows never checkout fork pull request refs", () => {
  for (const workflow of [validateWorkflow, securityWorkflow, aiReviewWorkflow]) {
    assert.doesNotMatch(workflow, /allow-unsafe-pr-checkout/);
    assert.doesNotMatch(
      workflow,
      /repository:\s*\$\{\{\s*github\.event\.pull_request\.head\.repo/,
    );
    assert.doesNotMatch(
      workflow,
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha/,
    );
  }
});

test("workflow actions use immutable commit SHAs", () => {
  for (const workflow of [validateWorkflow, securityWorkflow, aiReviewWorkflow]) {
    const actionReferences = [...workflow.matchAll(/uses:\s+actions\/[^@\s]+@([^\s]+)/g)];
    assert.ok(actionReferences.length > 0);
    for (const match of actionReferences) {
      assert.match(match[1], /^[0-9a-f]{40}$/);
    }
  }
});

test("pull_request_target triggers are pinned to the main branch", () => {
  for (const workflow of [validateWorkflow, securityWorkflow, aiReviewWorkflow]) {
    const privilegedTrigger = workflow.split("pull_request_target:\n")[1];
    assert.ok(privilegedTrigger);
    assert.match(privilegedTrigger.split("\n\n")[0], /branches: \[main\]/);
  }
});

test("these guardrails run on every pull request that edits a workflow", () => {
  const triggers = validateWorkflow.split("jobs:")[0];
  assert.match(triggers, /- "\.github\/workflows\/\*\*"/);
});

test("security comment workflow can write pull request comments", () => {
  const permissions = securityWorkflow.split("concurrency:")[0];
  assert.match(permissions, /issues:\s*write/);
  assert.match(permissions, /pull-requests:\s*write/);
});

test("privileged jobs do not pass untrusted values through GITHUB_OUTPUT", () => {
  const privilegedValidateJob = validateWorkflow.split("\n  pr-meta:\n")[1];
  assert.ok(privilegedValidateJob);
  assert.doesNotMatch(privilegedValidateJob, /GITHUB_OUTPUT/);
  assert.doesNotMatch(securityWorkflow, /GITHUB_OUTPUT/);
  assert.doesNotMatch(aiReviewWorkflow, /GITHUB_OUTPUT/);
});

function aiReviewJob(name) {
  const jobs = aiReviewWorkflow.split("\njobs:\n")[1];
  assert.ok(jobs);
  const job = jobs.split(/^  (?=[a-z-]+:$)/m).find((chunk) => chunk.startsWith(`${name}:`));
  assert.ok(job, `job ${name} exists`);
  return job;
}

test("AI review: the job that runs Copilot cannot write to the repository", () => {
  assert.match(aiReviewWorkflow.split("concurrency:")[0], /^permissions: \{\}$/m);
  const review = aiReviewJob("review");
  const permissions = review.split("permissions:\n")[1].split(/\n    [a-z-]+:/)[0];
  assert.doesNotMatch(permissions, /contents:\s*write|pull-requests:\s*write|issues:\s*write/);
  assert.match(permissions, /copilot-requests:\s*write/);
});

test("AI review: Copilot only gets read-only tools inside the bundle", () => {
  const review = aiReviewJob("review");
  assert.match(review, /--available-tools=view,grep,glob\n/);
  for (const flag of [
    "--deny-tool=shell",
    "--deny-tool=write",
    "--deny-tool=url",
    "--disable-builtin-mcps",
    "--no-custom-instructions",
    "--disallow-temp-dir",
  ]) {
    assert.ok(review.includes(flag), flag);
  }
  assert.doesNotMatch(review, /--allow-all|--yolo|--allow-tool|--add-dir|--allow-url|--trust-folder/);
  assert.match(review, /-C "\$AI_REVIEW_DIR\/bundle"/);
});

test("AI review: only the decide job can post reviews, and it never runs Copilot", () => {
  const decide = aiReviewJob("decide");
  assert.match(decide, /pull-requests:\s*write/);
  assert.doesNotMatch(decide, /copilot/i);
  assert.match(decide, /needs: review/);
});
