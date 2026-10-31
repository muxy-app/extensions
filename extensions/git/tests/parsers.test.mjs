import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCommit, parseCommitDetails, parseLog, parseStashList } from "@/core/commits";
import { commitWebUrl, remoteHost, webUrl } from "@/core/remote";
import { branchSlug, existingPrUrl, fromGh, mergeBlocker, parseTeaList, prWorktreePath } from "@/core/forge/normalize";
import { branchSteps } from "@/core/forge/tea-steps";

test("parseLog reads records and decorations", () => {
  const out = `abc\x1fa\x1fFix it\x1fAda\x1f2026-01-01T00:00:00Z\x1fp1 p2\x1fHEAD -> main, origin/main, tag: v1, origin/HEAD\x1e\n`;
  const [commit] = parseLog(out);
  assert.deepEqual(commit.parents, ["p1", "p2"]);
  assert.deepEqual(commit.refs, [{ name: "main", kind: "branch" }, { name: "origin/main", kind: "remote" }, { name: "v1", kind: "tag" }]);
});

test("normalizeCommit maps host refs and drops HEAD", () => {
  const commit = normalizeCommit({ hash: "abcdef12", subject: "x", parentHashes: ["p"], refs: [{ name: "HEAD", kind: "head" }, { name: "v2", kind: "Tag" }, { name: "origin/x", kind: "remoteBranch" }] });
  assert.equal(commit.shortHash, "abcdef1");
  assert.deepEqual(commit.refs.map((r) => r.kind), ["tag", "remote"]);
});

test("parseCommitDetails splits subject and body", () => {
  const details = parseCommitDetails("H\0h\0Ada\0a@x\0date\0p1\0Subject line\n\nBody text\n");
  assert.equal(details.subject, "Subject line");
  assert.equal(details.body, "Body text");
  assert.deepEqual(details.parents, ["p1"]);
});

test("parseStashList", () => {
  assert.deepEqual(parseStashList("stash@{0}\x1fWIP on main\x1f2 hours ago\n"), [{ ref: "stash@{0}", subject: "WIP on main", when: "2 hours ago" }]);
});

test("remote URLs become web URLs", () => {
  assert.equal(webUrl("git@github.com:me/repo.git"), "https://github.com/me/repo");
  assert.equal(webUrl("ssh://git@code.example.com:2222/me/repo.git"), "https://code.example.com/me/repo");
  assert.equal(webUrl("https://user@github.com/me/repo.git"), "https://github.com/me/repo");
  assert.equal(remoteHost("git@GitHub.com:me/repo.git"), "github.com");
  assert.equal(commitWebUrl("https://gitlab.com/a/b", "123"), "https://gitlab.com/a/b/-/commit/123");
});

test("forge helpers", () => {
  const pr = fromGh({ number: 3, title: "T", author: { login: "ada" }, state: "OPEN", mergeable: "CONFLICTING", checks: { passing: 2, failing: 1, pending: 0, total: 3 } });
  assert.equal(pr.author, "ada");
  assert.equal(pr.checks.status, "failure");
  assert.equal(mergeBlocker(pr), "Resolve the merge conflicts first.");
  assert.equal(existingPrUrl("a pull request for branch already exists:\nhttps://github.com/a/b/pull/9."), "https://github.com/a/b/pull/9");
  assert.equal(branchSlug("Fix: the  Login redirect!!"), "fix-the-login-redirect");
  assert.equal(prWorktreePath("/Users/me/code/repo/", 12), "/Users/me/code/repo.pr-12");
});

test("tea list keeps only the requested state", () => {
  const json = JSON.stringify([{ index: 1, title: "WIP: a", state: "closed", merged: true }, { index: 2, title: "b", state: "closed" }]);
  assert.deepEqual(parseTeaList(json, "merged").map((p) => p.number), [1]);
  assert.deepEqual(parseTeaList(json, "closed").map((p) => p.number), [2]);
  assert.equal(parseTeaList(json, "all")[0].isDraft, true);
});

test("tea checkout fast-forwards the branch when it is already checked out", () => {
  assert.deepEqual(branchSteps(7, "pr/7").steps[0], ["git", "merge", "--ff-only", "refs/muxy/pr/7"]);
  assert.deepEqual(branchSteps(7, "main").steps[0], ["git", "branch", "-f", "pr/7", "refs/muxy/pr/7"]);
});

test("rollupChecks summarizes gh statusCheckRollup", async () => {
  const { rollupChecks } = await import("@/core/forge/normalize");
  const summary = rollupChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }, { state: "SUCCESS" }]);
  assert.deepEqual(summary, { status: "failure", total: 4, passing: 2, failing: 1, pending: 1 });
  assert.equal(rollupChecks([]), null);
});
