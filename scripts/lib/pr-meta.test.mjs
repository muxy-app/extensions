import assert from "node:assert/strict";
import test from "node:test";

import { updatePullRequestMetadata } from "../pr-meta-ci.mjs";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const REPOSITORY_PATH = "/repos/muxy-app/extensions";
const MARKER = "<!-- muxy-extension-author-review -->";

function manifest(name, version, github) {
  return { name, version, muxy: { marketplace: { github } } };
}

async function runMetadata({ base = null, head, opener = "contributor", comments = [] }) {
  const context = {
    number: 211,
    baseRepository: "muxy-app/extensions",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    opener,
    currentTitle: "Submitted extension",
  };
  const packagePath = `extensions/${head.name}/package.json`;
  const reads = [];
  const postedComments = [];
  const titles = [];
  const api = {
    async get(apiPath, options) {
      reads.push(apiPath);
      if (apiPath === `${REPOSITORY_PATH}/pulls/211/files?per_page=100&page=1`) {
        return [{ filename: packagePath }];
      }
      if (apiPath === `${REPOSITORY_PATH}/issues/211/comments?per_page=100&page=1`) {
        return comments;
      }
      for (const [sha, pkg] of [[BASE_SHA, base], [HEAD_SHA, head]]) {
        if (apiPath === `${REPOSITORY_PATH}/contents/${packagePath}?ref=${sha}`) {
          assert.equal(options.allow404, true);
          if (pkg === null) return null;
          const text = JSON.stringify(pkg);
          return {
            type: "file",
            encoding: "base64",
            size: Buffer.byteLength(text),
            content: Buffer.from(text).toString("base64"),
          };
        }
      }
      assert.fail(`Unexpected API read: ${apiPath}`);
    },
    async post(apiPath, body) {
      assert.equal(apiPath, `${REPOSITORY_PATH}/issues/211/comments`);
      postedComments.push(body.body);
    },
    async patch(apiPath, body) {
      assert.equal(apiPath, `${REPOSITORY_PATH}/pulls/211`);
      titles.push(body.title);
    },
  };

  await updatePullRequestMetadata(api, context);
  return { reads, postedComments, titles };
}

test("new hyphenated extensions do not ping authors copied into their manifest", async () => {
  const result = await runMetadata({
    head: manifest("files-custom", "2.0.6", "saeedvaziry"),
  });

  assert.deepEqual(result.postedComments, []);
  assert.deepEqual(result.titles, ["files-custom 2.0.6"]);
  assert.deepEqual(result.reads, [
    `${REPOSITORY_PATH}/pulls/211/files?per_page=100&page=1`,
    `${REPOSITORY_PATH}/contents/extensions/files-custom/package.json?ref=${HEAD_SHA}`,
    `${REPOSITORY_PATH}/contents/extensions/files-custom/package.json?ref=${BASE_SHA}`,
  ]);
});

test("existing extensions ping the base author even when the PR changes the handle", async () => {
  const result = await runMetadata({
    base: manifest("files-custom", "2.0.5", "@original-author"),
    head: manifest("files-custom", "2.0.6", "replacement-author"),
  });

  assert.deepEqual(result.postedComments, [
    `${MARKER}\n@original-author — this PR changes the **files-custom** extension, ` +
      "which you're listed as the author of. Could you review it?",
  ]);
  assert.deepEqual(result.titles, ["files-custom 2.0.6"]);
});

test("removing the PR author metadata does not suppress a base author ping", async () => {
  const result = await runMetadata({
    base: manifest("files", "2.0.5", "original-author"),
    head: manifest("files", "2.0.6"),
  });

  assert.equal(result.postedComments.length, 1);
  assert.match(result.postedComments[0], /@original-author/);
});

test("missing or invalid base handles do not fall back to PR-supplied authors", async () => {
  for (const handle of [undefined, "", "invalid\nhandle"]) {
    const result = await runMetadata({
      base: manifest("files-custom", "2.0.5", handle),
      head: manifest("files-custom", "2.0.6", "replacement-author"),
    });

    assert.deepEqual(result.postedComments, []);
    assert.ok(result.reads.every((apiPath) => !apiPath.includes("/comments?")));
  }
});

test("base authors opening their own PR are not pinged, ignoring case", async () => {
  const result = await runMetadata({
    base: manifest("files-custom", "2.0.5", "@Original-Author"),
    head: manifest("files-custom", "2.0.6", "replacement-author"),
    opener: "original-author",
  });

  assert.deepEqual(result.postedComments, []);
});

test("existing bot author pings are not duplicated", async () => {
  const result = await runMetadata({
    base: manifest("files-custom", "2.0.5", "original-author"),
    head: manifest("files-custom", "2.0.6", "original-author"),
    comments: [{ user: { login: "github-actions[bot]" }, body: MARKER }],
  });

  assert.deepEqual(result.postedComments, []);
});

test("non-bot comments cannot suppress the base author ping", async () => {
  const result = await runMetadata({
    base: manifest("files-custom", "2.0.5", "original-author"),
    head: manifest("files-custom", "2.0.6", "original-author"),
    comments: [{ user: { login: "contributor" }, body: MARKER }],
  });

  assert.equal(result.postedComments.length, 1);
  assert.match(result.postedComments[0], /@original-author/);
});
