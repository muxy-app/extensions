import assert from "node:assert/strict";
import test from "node:test";

import {
  changedExtensionNames,
  compareVersionCores,
  getRepositoryTextFile,
  parseExtensionManifest,
  parsePullRequestContext,
} from "./github-pr.mjs";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

function pullRequestEvent(overrides = {}) {
  return {
    number: 105,
    pull_request: {
      number: 105,
      title: "example v1.2.3",
      user: { login: "external-author" },
      base: {
        sha: BASE_SHA,
        repo: { full_name: "muxy-app/extensions" },
      },
      head: {
        sha: HEAD_SHA,
        repo: { full_name: "external-author/extensions" },
      },
      ...overrides,
    },
  };
}

test("parsePullRequestContext accepts only exact immutable repository context", () => {
  const context = parsePullRequestContext(pullRequestEvent());
  assert.deepEqual(context, {
    number: 105,
    baseRepository: "muxy-app/extensions",
    baseSha: BASE_SHA,
    headRepository: "external-author/extensions",
    headSha: HEAD_SHA,
    opener: "external-author",
    currentTitle: "example v1.2.3",
  });

  assert.throws(
    () =>
      parsePullRequestContext(
        pullRequestEvent({ head: { sha: "main", repo: { full_name: "x/y" } } }),
      ),
    /full Git commit SHA/,
  );
  assert.throws(
    () =>
      parsePullRequestContext(
        pullRequestEvent({
          head: { sha: HEAD_SHA, repo: { full_name: "../extensions" } },
        }),
      ),
    /invalid repository name/,
  );
});

test("parsePullRequestContext tolerates a deleted head repository", () => {
  const context = parsePullRequestContext(
    pullRequestEvent({ head: { sha: HEAD_SHA, repo: null } }),
  );
  assert.equal(context.headRepository, null);
  assert.equal(context.headSha, HEAD_SHA);
  assert.equal(context.baseRepository, "muxy-app/extensions");
});

test("changedExtensionNames handles renames and rejects unsafe directories", () => {
  assert.deepEqual(
    changedExtensionNames([
      { filename: "extensions/beta/package.json" },
      {
        filename: "extensions/gamma/index.js",
        previous_filename: "extensions/alpha/index.js",
      },
      { filename: "scripts/validate.mjs" },
    ]),
    ["alpha", "beta", "gamma"],
  );

  assert.throws(
    () => changedExtensionNames([{ filename: "extensions/bad name/index.js" }]),
    /invalid extension directory/,
  );
});

test("changedExtensionNames ignores files that sit directly in extensions/", () => {
  assert.deepEqual(
    changedExtensionNames([
      { filename: "extensions/.gitkeep" },
      { filename: "extensions/README.md" },
      { filename: "extensions/demo/src/index.js" },
    ]),
    ["demo"],
  );
});

test("parseExtensionManifest strictly validates semver and GitHub handles", () => {
  const parsed = parseExtensionManifest(
    JSON.stringify({
      name: "demo",
      version: "1.2.3-beta.1+build.7",
      muxy: { marketplace: { github: "@valid-user" } },
    }),
    "demo",
  );
  assert.equal(parsed.authorGitHub, "valid-user");
  assert.equal(parsed.authorWarning, null);

  const invalidAuthor = parseExtensionManifest(
    JSON.stringify({
      name: "demo",
      version: "1.2.3",
      muxy: { marketplace: { github: "victim\ntitle=attacker" } },
    }),
    "demo",
  );
  assert.equal(invalidAuthor.authorGitHub, null);
  assert.match(invalidAuthor.authorWarning, /invalid/);

  assert.throws(
    () =>
      parseExtensionManifest(
        JSON.stringify({ name: "demo", version: "1.2.3\ntitle=attacker" }),
        "demo",
      ),
    /valid semver/,
  );
  assert.throws(
    () =>
      parseExtensionManifest(
        JSON.stringify({ name: "other", version: "1.2.3" }),
        "demo",
      ),
    /must equal/,
  );
  assert.throws(
    () =>
      parseExtensionManifest(
        JSON.stringify({ name: "demo", version: `1.2.3+${"a".repeat(100)}` }),
        "demo",
      ),
    /valid semver/,
  );
});

test("compareVersionCores handles arbitrarily large numeric components", () => {
  assert.equal(compareVersionCores("1.10.0", "1.9.999"), 1);
  assert.equal(
    compareVersionCores("999999999999999999999.0.0", "2.999.999"),
    1,
  );
  assert.equal(compareVersionCores("1.2.3-beta.1", "1.2.3+build.4"), 0);
});

test("getRepositoryTextFile decodes bounded API content", async () => {
  const api = {
    async get(apiPath) {
      assert.match(apiPath, /ref=b{40}$/);
      return {
        type: "file",
        encoding: "base64",
        size: 5,
        content: Buffer.from("hello").toString("base64"),
      };
    },
  };
  assert.equal(
    await getRepositoryTextFile(
      api,
      "external-author/extensions",
      HEAD_SHA,
      "extensions/demo/package.json",
      { maxBytes: 5 },
    ),
    "hello",
  );
});
