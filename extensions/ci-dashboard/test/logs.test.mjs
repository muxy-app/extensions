import test from "node:test";
import assert from "node:assert/strict";

import { stripAnsi, parseLogLines, excerpt, likelyCause, failureCount, analyze } from "../src/logs.js";

const ESC = "";

test("stripAnsi removes CSI sequences but keeps GitHub's ##[error] markers", () => {
  assert.equal(stripAnsi(`${ESC}[36;1mhello${ESC}[0m`), "hello");
  assert.equal(stripAnsi("##[error]boom"), "##[error]boom");
  assert.equal(stripAnsi("plain [bracketed] text"), "plain [bracketed] text");
});

test("parseLogLines splits gh's job/step/timestamp columns", () => {
  const raw = "Build\tRun tests\t2026-08-26T13:32:53.3595016Z npm test failed";
  assert.deepEqual(parseLogLines(raw), [
    { job: "Build", step: "Run tests", text: "npm test failed" },
  ]);
});

test("parseLogLines handles a plain log with no columns", () => {
  assert.deepEqual(parseLogLines("just a line"), [{ job: "", step: "", text: "just a line" }]);
});

test("excerpt centres on the first error and drops group/env noise", () => {
  const rows = parseLogLines([
    "##[group]Run npm test",
    "env:",
    "context line",
    "##[error]Process completed with exit code 1.",
  ].join("\n"));
  const lines = excerpt(rows);
  assert.ok(lines.includes("context line"));
  assert.ok(lines.includes("Process completed with exit code 1."));
  assert.ok(!lines.some((l) => l.includes("##[group]")));
});

test("excerpt falls back to the tail when nothing is marked as an error", () => {
  const rows = parseLogLines(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
  assert.deepEqual(excerpt(rows, { max: 5 }), ["line 35", "line 36", "line 37", "line 38", "line 39"]);
});

test("likelyCause reads a TypeScript compiler location", () => {
  const rows = parseLogLines("##[error]src/auth/session.ts:84:12 - error TS2345: Argument of type 'string'");
  assert.deepEqual(likelyCause(rows), {
    file: "src/auth/session.ts",
    line: 84,
    column: 12,
    text: "src/auth/session.ts:84:12 - error TS2345: Argument of type 'string'",
  });
});

test("likelyCause reads a node stack frame", () => {
  const cause = likelyCause(parseLogLines("    at Object.<anonymous> (/repo/src/index.js:12:3)"));
  assert.equal(cause.file, "/repo/src/index.js");
  assert.equal(cause.line, 12);
  assert.equal(cause.column, 3);
});

test("likelyCause reads python and rust locations", () => {
  assert.equal(likelyCause(parseLogLines('  File "app/main.py", line 42, in handler')).file, "app/main.py");
  const rust = likelyCause(parseLogLines("  --> src/lib.rs:19:9"));
  assert.equal(rust.file, "src/lib.rs");
  assert.equal(rust.line, 19);
});

test("likelyCause skips vendored paths and non-source files", () => {
  const rows = parseLogLines([
    "at foo (/repo/node_modules/lib/index.js:1:1)",
    "at bar (/repo/src/real.js:7:2)",
  ].join("\n"));
  assert.equal(likelyCause(rows).file, "/repo/src/real.js");
  assert.equal(likelyCause(parseLogLines("downloaded package-1.2.3:99")), null);
});

test("likelyCause prefers a flagged error line over an earlier incidental match", () => {
  const rows = parseLogLines([
    "compiling src/warmup.ts:3:1",
    "##[error]src/broken.ts:88:4 - error TS1005",
  ].join("\n"));
  assert.equal(likelyCause(rows).file, "src/broken.ts");
});

test("failureCount picks up the common test-runner phrasings", () => {
  assert.equal(failureCount(parseLogLines("Tests: 14 failed, 3 passed")), 14);
  assert.equal(failureCount(parseLogLines("  7 failing")), 7);
  assert.equal(failureCount(parseLogLines("Failures: 2")), 2);
  assert.equal(failureCount(parseLogLines("0 failing")), null);
  assert.equal(failureCount(parseLogLines("all good")), null);
});

test("analyze narrows a multi-job log to one job", () => {
  const raw = [
    "build\tcompile\t2026-01-01T00:00:00Z fine here",
    "test\trun\t2026-01-01T00:00:01Z ##[error]src/a.ts:1:1 - broke",
  ].join("\n");
  const a = analyze(raw, { job: "test" });
  assert.equal(a.likelyCause.file, "src/a.ts");
  assert.ok(!a.lines.some((l) => l.includes("fine here")));
});

test("analyze on a realistic failing jest log", () => {
  const raw = [
    `${ESC}[2mBuild${ESC}[0m\tRun tests\t2026-08-26T13:32:53.3595016Z ##[group]Run npm test`,
    "Build\tRun tests\t2026-08-26T13:32:53.3596109Z FAIL src/auth/session.test.ts",
    "Build\tRun tests\t2026-08-26T13:32:54.0000000Z   ● session > refreshes",
    "Build\tRun tests\t2026-08-26T13:32:54.1000000Z     at Object.<anonymous> (src/auth/session.ts:84:19)",
    "Build\tRun tests\t2026-08-26T13:32:55.0000000Z Tests: 14 failed, 22 passed",
    "Build\tRun tests\t2026-08-26T13:32:55.5000000Z ##[error]Process completed with exit code 1.",
  ].join("\n");
  const a = analyze(raw);
  assert.equal(a.failures, 14);
  assert.equal(a.likelyCause.file, "src/auth/session.ts");
  assert.equal(a.likelyCause.line, 84);
  assert.deepEqual(a.errors, ["Process completed with exit code 1."]);
});

test("analyze survives an empty or missing log", () => {
  const a = analyze("");
  assert.deepEqual(a.lines, []);
  assert.equal(a.likelyCause, null);
  assert.equal(a.failures, null);
});

test("excerpt keeps a short log whole, including the failing test's name", () => {
  const rows = parseLogLines([
    "FAIL src/auth/session.test.ts",
    "  expected a token, received null",
    "##[error]Process completed with exit code 1.",
  ].join("\n"));
  const lines = excerpt(rows);
  assert.equal(lines[0], "FAIL src/auth/session.test.ts");
  assert.equal(lines.length, 3);
});

test("excerpt never starts a window past the end of a long log", () => {
  const rows = parseLogLines([
    ...Array.from({ length: 30 }, (_, i) => `line ${i}`),
    "##[error]boom",
  ].join("\n"));
  const lines = excerpt(rows, { max: 6, lead: 4 });
  assert.equal(lines.length, 6);
  assert.equal(lines.at(-1), "boom");
});
