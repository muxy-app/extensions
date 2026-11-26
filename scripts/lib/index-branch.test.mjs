import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { commitIndexBranch, gitAuthEnv } from "./index-branch.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "muxy-index-branch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  git(root, "init", "--quiet", "--bare", remote);
  git(root, "init", "--quiet", work);
  git(work, "remote", "add", "origin", remote);
  fs.writeFileSync(path.join(work, "main.txt"), "main\n");
  git(work, "add", "main.txt");
  git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "main");
  return { remote, work };
}

test("commitIndexBranch creates an orphan branch, skips unchanged content, then appends", (t) => {
  const { remote, work } = setup(t);
  const headBefore = git(work, "rev-parse", "HEAD");

  const first = commitIndexBranch({ cwd: work, content: '{"schema":1}\n' });
  assert.equal(first.changed, true);
  assert.equal(git(remote, "rev-parse", "refs/heads/index"), first.commit);
  assert.equal(git(remote, "rev-list", "--count", "index"), "1");
  assert.equal(git(remote, "show", "index:index.json"), '{"schema":1}');
  assert.equal(git(remote, "ls-tree", "--name-only", "index"), "index.json");

  const again = commitIndexBranch({ cwd: work, content: '{"schema":1}\n' });
  assert.equal(again.changed, false);
  assert.equal(git(remote, "rev-parse", "refs/heads/index"), first.commit);

  const next = commitIndexBranch({ cwd: work, content: '{"schema":2}\n' });
  assert.equal(next.changed, true);
  assert.equal(git(remote, "rev-parse", "index^"), first.commit);
  assert.equal(git(remote, "show", "index:index.json"), '{"schema":2}');

  assert.equal(git(work, "rev-parse", "HEAD"), headBefore);
  assert.equal(git(work, "status", "--porcelain"), "");
});

test("gitAuthEnv appends the token header after any existing git config entries", () => {
  const env = gitAuthEnv("secret", {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.x",
    GIT_CONFIG_VALUE_0: "y",
  });
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.GIT_CONFIG_KEY_0, "core.x");
  assert.equal(env.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
  assert.equal(
    env.GIT_CONFIG_VALUE_1,
    `AUTHORIZATION: basic ${Buffer.from("x-access-token:secret").toString("base64")}`,
  );
  assert.equal(gitAuthEnv("", {}).GIT_CONFIG_COUNT, undefined);
});
