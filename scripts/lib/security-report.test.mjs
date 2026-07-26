import assert from "node:assert/strict";
import test from "node:test";

import {
  analyseExtensionData,
  COMMENT_MARKER,
  isScannableSourcePath,
  renderSecurityComment,
} from "./security-report.mjs";

test("isScannableSourcePath excludes hidden, dependency, and build files", () => {
  assert.equal(isScannableSourcePath("src/index.js"), true);
  assert.equal(isScannableSourcePath("popover/index.html"), true);
  assert.equal(isScannableSourcePath("dist/index.js"), false);
  assert.equal(isScannableSourcePath("node_modules/pkg/index.js"), false);
  assert.equal(isScannableSourcePath(".hidden/index.js"), false);
  assert.equal(isScannableSourcePath("assets/icon.svg"), false);
});

test("security analysis reports risky source without executing it", () => {
  const result = analyseExtensionData({
    name: "demo",
    packageJSON: {
      version: "1.0.0",
      muxy: {
        description: "Demo",
        permissions: ["files:read"],
      },
    },
    files: [
      {
        path: "index.js",
        content: "fetch('https://example.com'); eval('nope'); muxy.exec('id');",
      },
    ],
    skippedSourceFiles: 1,
  });

  assert.equal(result.highestRisk, "high");
  assert.ok(result.signals.some((signal) => signal.includes("network requests")));
  assert.ok(result.signals.some((signal) => signal.includes("eval")));
  assert.ok(result.signals.some((signal) => signal.includes("without declaring")));
  assert.ok(result.signals.some((signal) => signal.includes("Skipped 1")));
});

test("renderSecurityComment neutralizes Markdown and mention injection", () => {
  const extension = analyseExtensionData({
    name: "demo",
    packageJSON: {
      version: "1.0.0",
      muxy: {
        description:
          "hello\nMUXY_EOF\n@octocat [click](https://evil.example) <img>",
        permissions: ["unknown|@octocat"],
      },
    },
  });
  const report = renderSecurityComment([extension]);

  assert.ok(report.startsWith(COMMENT_MARKER));
  assert.doesNotMatch(report, /@octocat/);
  assert.doesNotMatch(report, /\[click\]\(https:/);
  assert.match(report, /MUXY\\_EOF/);
  assert.match(report, /@\u200boctocat/);
});
