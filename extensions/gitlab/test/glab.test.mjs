import test from "node:test";
import assert from "node:assert/strict";

import { parseRemote, encodeProjectPath, query } from "../src/glab.js";

test("parseRemote reads scp-style SSH remotes", () => {
  assert.deepEqual(parseRemote("git@gitlab.com:group/project.git"), {
    host: "gitlab.com",
    path: "group/project",
  });
});

test("parseRemote reads nested groups on a self-managed host", () => {
  assert.deepEqual(parseRemote("git@gitlab.example.com:team/sub/project.git"), {
    host: "gitlab.example.com",
    path: "team/sub/project",
  });
});

test("parseRemote reads ssh:// remotes with a port", () => {
  assert.deepEqual(parseRemote("ssh://git@gitlab.example.com:2222/group/project.git"), {
    host: "gitlab.example.com",
    path: "group/project",
  });
});

test("parseRemote reads https remotes, with or without a .git suffix", () => {
  assert.deepEqual(parseRemote("https://gitlab.com/group/project.git"), {
    host: "gitlab.com",
    path: "group/project",
  });
  assert.deepEqual(parseRemote("https://gitlab.example.com/group/project/"), {
    host: "gitlab.example.com",
    path: "group/project",
  });
});

test("parseRemote lowercases the host but preserves path case", () => {
  assert.deepEqual(parseRemote("git@GitLab.Example.COM:Group/Project.git"), {
    host: "gitlab.example.com",
    path: "Group/Project",
  });
});

test("parseRemote rejects remotes without a namespace", () => {
  assert.equal(parseRemote("git@gitlab.com:project.git"), null);
  assert.equal(parseRemote(""), null);
  assert.equal(parseRemote("not a url"), null);
});

test("encodeProjectPath percent-encodes the separators GitLab needs", () => {
  assert.equal(encodeProjectPath("group/sub/project"), "group%2Fsub%2Fproject");
});

test("query skips empty values and encodes the rest", () => {
  assert.equal(
    query({ state: "opened", per_page: 100, search: "", missing: undefined }),
    "?state=opened&per_page=100",
  );
  assert.equal(query({}), "");
  assert.equal(query({ search: "a b&c" }), "?search=a%20b%26c");
});
