import test from "node:test";
import assert from "node:assert/strict";

import { detect, suggestedSources, cctrayUrlFor, nativeProviders } from "../src/providers/detect.js";

/** Stubs muxy.files with an in-memory tree of paths. */
function withFiles(paths) {
  const set = new Set(paths);
  globalThis.window = {
    muxy: {
      files: {
        async stat(path) {
          if (set.has(path)) return { path, isDirectory: false };
          if ([...set].some((p) => p.startsWith(`${path}/`))) return { path, isDirectory: true };
          throw new Error("not found");
        },
        async list(path) {
          return [...set]
            .filter((p) => p.startsWith(`${path}/`))
            .map((p) => ({ name: p.slice(path.length + 1), path: p, isDirectory: false }));
        },
      },
    },
  };
}

test("detects GitHub Actions from a workflow file", async () => {
  withFiles([".github/workflows/ci.yml"]);
  const { native } = await detect();
  assert.equal(native.length, 1);
  assert.equal(native[0].kind, "github");
  assert.equal(native[0].cli, "gh");
  assert.equal(native[0].evidence, ".github/workflows/ci.yml");
});

test("ignores a workflows directory holding no YAML", async () => {
  withFiles([".github/workflows/README.md"]);
  assert.equal((await detect()).native.length, 0);
});

test("detects GitLab CI from either spelling of the config", async () => {
  withFiles([".gitlab-ci.yml"]);
  assert.equal((await detect()).native[0].kind, "gitlab");
  withFiles([".gitlab-ci.yaml"]);
  assert.equal((await detect()).native[0].kind, "gitlab");
});

test("detects both natives in a repository that uses both", async () => {
  withFiles([".github/workflows/ci.yaml", ".gitlab-ci.yml"]);
  const { native } = await detect();
  assert.deepEqual(native.map((n) => n.kind), ["github", "gitlab"]);
});

test("detects GitLab CI under .gitlab/, not just at the root", async () => {
  withFiles([".gitlab/.gitlab-ci.yml"]);
  let hit = (await detect()).native[0];
  assert.equal(hit.kind, "gitlab");
  assert.equal(hit.evidence, ".gitlab/.gitlab-ci.yml");

  withFiles([".gitlab/.gitlab-ci.yaml"]);
  assert.equal((await detect()).native[0].evidence, ".gitlab/.gitlab-ci.yaml");
});

test("detects a GitLab config split across .gitlab/ci/", async () => {
  withFiles([".gitlab/ci/build.yml", ".gitlab/ci/test.yml"]);
  const hit = (await detect()).native[0];
  assert.equal(hit.kind, "gitlab");
  assert.ok(hit.evidence.startsWith(".gitlab/ci/"));
});

test("detects a GitLab config under .gitlab-ci/", async () => {
  withFiles([".gitlab-ci/main.yml"]);
  assert.equal((await detect()).native[0].kind, "gitlab");
});

test("prefers the root config as evidence when several locations exist", async () => {
  withFiles([".gitlab-ci.yml", ".gitlab/.gitlab-ci.yml", ".gitlab/ci/build.yml"]);
  const native = (await detect()).native;
  assert.equal(native.length, 1, "one GitLab hit, not one per file");
  assert.equal(native[0].evidence, ".gitlab-ci.yml");
});

test("a .gitlab directory holding no YAML is not a GitLab CI hit", async () => {
  // .gitlab/ is also used for issue and merge request templates.
  withFiles([".gitlab/issue_templates/Bug.md", ".gitlab/merge_request_templates/MR.md"]);
  assert.equal((await detect()).native.length, 0);
});

test("nativeProviders lists every provider that can be added by hand", async () => {
  // Detection cannot be complete — GitLab allows a custom config path, another
  // project, or an external URL — so the full catalogue must stay addable.
  const kinds = nativeProviders().map((n) => n.kind);
  assert.deepEqual(kinds.sort(), ["github", "gitlab"]);
  for (const n of nativeProviders()) assert.ok(n.label && n.cli);
});

test("turns other build systems into CCTray hints rather than dead ends", async () => {
  withFiles(["Jenkinsfile"]);
  const { native, hints } = await detect();
  assert.equal(native.length, 0);
  assert.equal(hints[0].id, "jenkins");
  assert.equal(hints[0].cctrayPath, "/cc.xml");
});

test("recognises TeamCity, CircleCI and Azure layouts", async () => {
  withFiles([".teamcity/settings.kts", ".circleci/config.yml", "azure-pipelines.yml"]);
  const ids = (await detect()).hints.map((h) => h.id);
  assert.deepEqual(ids.sort(), ["azure", "circleci", "teamcity"]);
});

test("reports nothing for a repository with no CI configuration", async () => {
  withFiles(["README.md", "src/index.js"]);
  const { native, hints } = await detect();
  assert.deepEqual(native, []);
  assert.deepEqual(hints, []);
});

test("suggestedSources only offers providers whose CLI is installed", async () => {
  const detection = {
    native: [
      { kind: "github", label: "GitHub Actions", cli: "gh" },
      { kind: "gitlab", label: "GitLab CI", cli: "glab" },
    ],
  };
  const sources = await suggestedSources(detection, async (cli) => cli === "gh");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, "github");
  assert.equal(sources[0].enabled, true);
});

test("cctrayUrlFor joins a base URL with the server's conventional path", () => {
  assert.equal(
    cctrayUrlFor({ cctrayPath: "/cc.xml" }, "https://jenkins.example.com/"),
    "https://jenkins.example.com/cc.xml",
  );
  assert.equal(cctrayUrlFor({ cctrayPath: "" }, "https://x.example.com"), "https://x.example.com");
  assert.equal(cctrayUrlFor({ cctrayPath: "/cc.xml" }, ""), "");
});
