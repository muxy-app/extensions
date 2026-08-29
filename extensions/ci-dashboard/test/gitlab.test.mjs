// The GitLab provider. `window.muxy.exec` is stubbed to answer `git remote`,
// `git remote get-url`, and `glab api` calls, so identity resolution and the
// per-cwd cache run for real rather than being assumed.

import test from "node:test";
import assert from "node:assert/strict";

import * as gitlab from "../src/providers/gitlab.js";

const SOURCE = { id: "gl1", kind: "gitlab", label: "GitLab CI", enabled: true };

test("parseRemote reads scp-style SSH remotes", () => {
  assert.deepEqual(gitlab.parseRemote("git@gitlab.com:group/project.git"), {
    host: "gitlab.com",
    path: "group/project",
  });
});

test("parseRemote reads nested groups on a self-managed host", () => {
  assert.deepEqual(gitlab.parseRemote("git@gitlab.example.com:team/sub/project.git"), {
    host: "gitlab.example.com",
    path: "team/sub/project",
  });
});

test("parseRemote reads ssh:// remotes with a port", () => {
  assert.deepEqual(gitlab.parseRemote("ssh://git@gitlab.example.com:2222/group/project.git"), {
    host: "gitlab.example.com",
    path: "group/project",
  });
});

test("parseRemote reads https remotes, with or without a .git suffix", () => {
  assert.deepEqual(gitlab.parseRemote("https://gitlab.com/group/project.git"), {
    host: "gitlab.com",
    path: "group/project",
  });
  assert.deepEqual(gitlab.parseRemote("https://gitlab.example.com/group/project/"), {
    host: "gitlab.example.com",
    path: "group/project",
  });
});

test("parseRemote rejects remotes without a namespace", () => {
  assert.equal(gitlab.parseRemote("git@gitlab.com:project.git"), null);
  assert.equal(gitlab.parseRemote(""), null);
  assert.equal(gitlab.parseRemote("not a url"), null);
});

/** Answers `git remote`, `git remote get-url origin`, and `glab api` calls. */
function stubExec(getRemoteUrl, onApi) {
  globalThis.window = {
    muxy: {
      exec: async (argv) => {
        if (argv[0] === "git" && argv[1] === "remote" && argv.length === 2) {
          return { stdout: "origin\n", stderr: "", exitCode: 0 };
        }
        if (argv[0] === "git" && argv[1] === "remote" && argv[2] === "get-url") {
          return { stdout: `${getRemoteUrl()}\n`, stderr: "", exitCode: 0 };
        }
        if (argv[0] === "glab" && argv[1] === "api") {
          const endpoint = argv.at(-1);
          const projectId = decodeURIComponent(endpoint.match(/^projects\/([^/]+)\//)?.[1] || "");
          onApi(projectId);
          return { stdout: "[]", stderr: "", exitCode: 0 };
        }
        throw new Error(`unexpected argv: ${argv.join(" ")}`);
      },
    },
  };
}

// The identity cache is keyed by `cwd`, and the panel's "Current project"
// mode always calls providers with `cwd === ""` — so switching the active
// project between two GitLab repos while on that mode never changes the cache
// key. Without an explicit clear at the right time, a stale identity leaks
// into the new project silently (see main.js's `invalidate()`).
test("the identity cache must be cleared explicitly when the underlying remote changes", async () => {
  gitlab.clearIdentityCache();
  let remote = "git@gitlab.com:group/project-a.git";
  const seen = [];
  stubExec(() => remote, (projectId) => seen.push(projectId));

  await gitlab.loadRuns(SOURCE, "");
  remote = "git@gitlab.com:group/project-b.git"; // same cwd ("") — a project switch on "Current project"
  await gitlab.loadRuns(SOURCE, "");

  assert.deepEqual(seen, ["group/project-a", "group/project-a"],
    "the cached identity from the first project is still used for the second");

  gitlab.clearIdentityCache();
  await gitlab.loadRuns(SOURCE, "");

  assert.equal(seen.at(-1), "group/project-b", "clearing the cache re-resolves the current remote");
});
