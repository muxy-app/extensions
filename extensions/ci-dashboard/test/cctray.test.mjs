import test from "node:test";
import assert from "node:assert/strict";

import { parseCCTray, splitName, toRun, curlArgs, selectProjects } from "../src/providers/cctray.js";
import { STATUS, durationMs, formatDuration } from "../src/model.js";

// Shaped after what TeamCity, Jenkins and GoCD actually publish.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<Projects>
  <Project name="Platform :: Build" activity="Sleeping" lastBuildStatus="Success"
           lastBuildLabel="1841" lastBuildTime="2026-08-26T10:30:34Z"
           webUrl="https://teamcity.example.com/viewType.html?buildTypeId=Platform_Build"/>
  <Project name="Platform :: E2E :: release/2.1" activity="Building" lastBuildStatus="Failure"
           lastBuildLabel="1842" lastBuildTime="2026-08-26T11:02:00Z"
           webUrl="https://teamcity.example.com/viewType.html?buildTypeId=Platform_E2E"/>
  <Project name="nightly (main)" activity="Sleeping" lastBuildStatus="Exception"
           lastBuildLabel="7" lastBuildTime="2026-08-26T02:00:00Z"
           webUrl="https://jenkins.example.com/job/nightly/"
           messages="Tom &amp; Jerry broke it"/>
</Projects>`;

const SOURCE = { id: "s1", kind: "cctray", label: "TeamCity", url: "https://tc.example.com/cc.xml", auth: { kind: "none" } };

test("parseCCTray reads every project and decodes entities", () => {
  const projects = parseCCTray(FEED);
  assert.equal(projects.length, 3);
  assert.equal(projects[0].name, "Platform :: Build");
  assert.equal(projects[0].lastbuildlabel, "1841");
  assert.equal(projects[2].messages, "Tom & Jerry broke it");
});

test("parseCCTray tolerates self-closing and paired Project elements", () => {
  const paired = `<Projects><Project name="a" lastBuildStatus="Success"></Project></Projects>`;
  assert.equal(parseCCTray(paired)[0].name, "a");
});

test("parseCCTray returns nothing for a non-CCTray body", () => {
  assert.deepEqual(parseCCTray("<html><body>404</body></html>"), []);
  assert.deepEqual(parseCCTray(""), []);
});

test("parseCCTray handles single-quoted attributes", () => {
  assert.equal(parseCCTray(`<Projects><Project name='b' activity='Building'/></Projects>`)[0].activity, "Building");
});

test("splitName separates TeamCity project, config and branch", () => {
  assert.deepEqual(splitName("Platform :: E2E :: release/2.1"), {
    workflow: "Platform :: E2E", title: "E2E", branch: "release/2.1",
  });
  assert.deepEqual(splitName("Platform :: Build"), {
    workflow: "Platform", title: "Build", branch: "",
  });
});

test("splitName reads a parenthesized branch, as Jenkins publishes it", () => {
  assert.deepEqual(splitName("nightly (main)"), { workflow: "", title: "nightly", branch: "main" });
  assert.deepEqual(splitName("plain-job"), { workflow: "", title: "plain-job", branch: "" });
});

test("toRun maps a sleeping successful project", () => {
  const run = toRun(parseCCTray(FEED)[0], SOURCE);
  assert.equal(run.status, STATUS.success);
  assert.equal(run.number, "1841");
  assert.equal(run.title, "Build");
  assert.equal(run.finishedAt, "2026-08-26T10:30:34Z");
  assert.equal(run.sourceKind, "cctray");
  assert.equal(run.jobs, null); // CCTray has no job breakdown
});

test("toRun lets an in-flight build win over the previous outcome", () => {
  const run = toRun(parseCCTray(FEED)[1], SOURCE);
  assert.equal(run.status, STATUS.running);
  assert.equal(run.branch, "release/2.1");
  assert.equal(run.finishedAt, ""); // still building
});

test("toRun treats a CCTray Exception as a failure", () => {
  assert.equal(toRun(parseCCTray(FEED)[2], SOURCE).status, STATUS.failed);
});

test("selectProjects applies the allowlist, and an empty list means everything", () => {
  const projects = parseCCTray(FEED);
  assert.equal(selectProjects(projects, []).length, 3);
  assert.equal(selectProjects(projects, ["Platform :: Build"]).length, 1);
  assert.equal(selectProjects(projects, ["nothing"]).length, 0);
});

test("curlArgs sends the response headers to stderr and follows redirects", () => {
  const args = curlArgs(SOURCE, SOURCE.url);
  assert.equal(args[0], "curl");
  assert.ok(args.includes("--location"));
  assert.deepEqual(args.slice(-3), ["-D", "/dev/stderr", SOURCE.url]);
});

test("curlArgs builds each auth mode", () => {
  const withAuth = (auth) => curlArgs({ ...SOURCE, auth }, SOURCE.url);

  assert.ok(withAuth({ kind: "token", token: "abc" }).join(" ").includes("Authorization: Bearer abc"));
  assert.ok(withAuth({ kind: "header", name: "X-Api-Key", value: "k" }).join(" ").includes("X-Api-Key: k"));

  const basic = withAuth({ kind: "basic", user: "u", password: "p" });
  assert.equal(basic[basic.indexOf("-u") + 1], "u:p");

  const config = withAuth({ kind: "curlConfig", path: "~/.tc.curl" });
  assert.equal(config[config.indexOf("--config") + 1], "~/.tc.curl");

  assert.ok(!withAuth({ kind: "none" }).includes("-u"));
});

test("curlArgs only passes --insecure when the monitor opted in", () => {
  assert.ok(!curlArgs(SOURCE, SOURCE.url).includes("--insecure"));
  assert.ok(curlArgs({ ...SOURCE, insecure: true }, SOURCE.url).includes("--insecure"));
});

test("curlArgs omits an empty custom header rather than sending a broken one", () => {
  const args = curlArgs({ ...SOURCE, auth: { kind: "header", name: "", value: "v" } }, SOURCE.url);
  assert.ok(!args.join(" ").includes(": v"));
});

test("a CCTray run states no duration rather than inventing one", () => {
  // The feed publishes one timestamp, so neither a finished nor a running
  // build has an elapsed time that can honestly be shown.
  const [done, building] = parseCCTray(FEED).map((p) => toRun(p, SOURCE));
  assert.equal(durationMs(done), null);
  assert.equal(durationMs(building), null);
  assert.equal(formatDuration(durationMs(done)), "");
});
