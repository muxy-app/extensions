import assert from "node:assert/strict";
import test from "node:test";

import {
    changedFileCount,
    changesLabel,
    commitShortcut,
    errorMessage,
} from "../src/commit/model.js";

test("counts every changed path once across staged and unstaged files", () => {
    assert.equal(changedFileCount({
        stagedFiles: [{ path: "src/app.js" }, { path: "README.md" }],
        unstagedFiles: [{ path: "src/app.js" }, { path: "new-file.txt" }],
    }), 3);
});

test("describes the files that the commit will stage", () => {
    assert.equal(changesLabel(0), "No changes to commit");
    assert.equal(changesLabel(1), "1 file will be staged");
    assert.equal(changesLabel(3), "3 files will be staged");
});

test("maps commit keyboard shortcuts", () => {
    assert.equal(commitShortcut({ metaKey: true, ctrlKey: false, shiftKey: false, key: "Enter" }), "commit");
    assert.equal(commitShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, key: "Enter" }), "commit-and-push");
    assert.equal(commitShortcut({ metaKey: false, ctrlKey: true, shiftKey: false, key: "Enter" }), "commit");
    assert.equal(commitShortcut({ metaKey: false, ctrlKey: false, shiftKey: false, key: "Enter" }), null);
});

test("normalizes thrown commit errors", () => {
    assert.equal(errorMessage(new Error("push rejected")), "push rejected");
    assert.equal(errorMessage("permission denied"), "permission denied");
    assert.equal(errorMessage(null), "Unknown error");
});
