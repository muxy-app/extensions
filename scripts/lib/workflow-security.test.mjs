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

test("privileged workflows never checkout fork pull request refs", () => {
  for (const workflow of [validateWorkflow, securityWorkflow]) {
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
  for (const workflow of [validateWorkflow, securityWorkflow]) {
    const actionReferences = [...workflow.matchAll(/uses:\s+actions\/[^@\s]+@([^\s]+)/g)];
    assert.ok(actionReferences.length > 0);
    for (const match of actionReferences) {
      assert.match(match[1], /^[0-9a-f]{40}$/);
    }
  }
});

test("pull_request_target triggers are pinned to the main branch", () => {
  for (const workflow of [validateWorkflow, securityWorkflow]) {
    const privilegedTrigger = workflow.split("pull_request_target:\n")[1];
    assert.ok(privilegedTrigger);
    assert.match(privilegedTrigger.split("\n\n")[0], /branches: \[main\]/);
  }
});

test("these guardrails run on every pull request that edits a workflow", () => {
  const triggers = validateWorkflow.split("jobs:")[0];
  assert.match(triggers, /- "\.github\/workflows\/\*\*"/);
});

test("privileged jobs do not pass untrusted values through GITHUB_OUTPUT", () => {
  const privilegedValidateJob = validateWorkflow.split("\n  pr-meta:\n")[1];
  assert.ok(privilegedValidateJob);
  assert.doesNotMatch(privilegedValidateJob, /GITHUB_OUTPUT/);
  assert.doesNotMatch(securityWorkflow, /GITHUB_OUTPUT/);
});
