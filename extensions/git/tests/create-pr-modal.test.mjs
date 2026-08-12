import assert from "node:assert/strict";
import test from "node:test";

import {
    branchOptions,
    canSubmitCreatePr,
    createPrFieldLocks,
    createPrShortcut,
    isDefaultBranch,
    repositoryHint,
} from "../src/create-pr/model.js";

test("recognizes when pull request creation needs a new branch", () => {
    assert.equal(isDefaultBranch("main", "main"), true);
    assert.equal(isDefaultBranch("feature/pr", "main"), false);
    assert.equal(isDefaultBranch("", "main"), false);
});

test("requires a new branch before creating from the default branch", () => {
    const state = {
        ready: true,
        busy: false,
        currentBranch: "main",
        defaultBranch: "main",
        newBranch: "",
        title: "Add command modals",
    };
    assert.equal(canSubmitCreatePr(state), false);
    assert.equal(canSubmitCreatePr({ ...state, newBranch: "add-command-modals" }), true);
    assert.equal(canSubmitCreatePr({ ...state, currentBranch: "feature/modals" }), true);
});

test("keeps pull request metadata editable after branch preparation", () => {
    assert.deepEqual(createPrFieldLocks(false, true), {
        metadata: false,
        sourceBranch: true,
    });
    assert.deepEqual(createPrFieldLocks(true, false), {
        metadata: true,
        sourceBranch: true,
    });
});

test("builds unique target branch options without the source branch", () => {
    assert.deepEqual(
        branchOptions(["feature/pr", "main", "develop", "main"], "feature/pr", "release"),
        ["release", "main", "develop"],
    );
});

test("maps command-enter to create pull request", () => {
    assert.equal(createPrShortcut({ metaKey: true, ctrlKey: false, shiftKey: false, key: "Enter" }), true);
    assert.equal(createPrShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, key: "Enter" }), false);
    assert.equal(createPrShortcut({ metaKey: false, ctrlKey: false, shiftKey: false, key: "Enter" }), false);
});

test("explains how working tree changes are handled", () => {
    assert.equal(repositoryHint(0), "The branch will be pushed before creating the pull request");
    assert.equal(repositoryHint(1), "1 changed file will be committed with this title");
    assert.equal(repositoryHint(4), "4 changed files will be committed with this title");
});
