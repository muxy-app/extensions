import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCombined, untrackedPatch, looksBinary } from "@/diff/patch";
import { diffKind } from "@/shared/diff-tabs";

test("untrackedPatch builds a new-file diff with correct hunk counts", () => {
  assert.equal(untrackedPatch("a.txt", "x\ny\n"), "diff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+x\n+y\n");
  assert.match(untrackedPatch("b", "z"), /\+z\n\\ No newline at end of file\n$/);
  assert.equal(untrackedPatch("e", ""), "diff --git a/e b/e\nnew file mode 100644\n");
});

test("splitCombined drops conflict diffs and keeps regular ones", () => {
  const patch = "diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\ndiff --cc c.js\n@@@ -1,1 -1,1 +1,1 @@@\ndiff --git a/d b/d\n+x\n";
  const { patch: kept, combined } = splitCombined(patch);
  assert.deepEqual(combined, ["c.js"]);
  assert.ok(kept.includes("diff --git a/a b/a") && kept.includes("diff --git a/d b/d") && !kept.includes("--cc"));
});

test("looksBinary and diffKind", () => {
  assert.equal(looksBinary("ab\u0000c"), true);
  assert.equal(looksBinary("abc"), false);
  assert.equal(diffKind({ source: "pr" }), "pr");
  assert.equal(diffKind({}), "working");
});
