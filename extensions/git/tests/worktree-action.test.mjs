import assert from "node:assert/strict";
import test from "node:test";

import { runInWorktree } from "../src/lib/worktree-action.js";

test("does not switch when the target worktree is already active", async () => {
    const switchedTo = [];
    const result = await runInWorktree("/projects/app/", "/projects/app", async (path) => switchedTo.push(path), async () => "checked out");

    assert.equal(result, "checked out");
    assert.deepEqual(switchedTo, []);
});

test("keeps the target worktree active after a successful action", async () => {
    const switchedTo = [];
    const result = await runInWorktree("/projects/app", "/projects/feature", async (path) => switchedTo.push(path), async () => "checked out");

    assert.equal(result, "checked out");
    assert.deepEqual(switchedTo, ["/projects/app"]);
});

test("restores the previous worktree when the action fails", async () => {
    const switchedTo = [];
    const failure = new Error("checkout failed");

    await assert.rejects(
        runInWorktree("/projects/app", "/projects/feature", async (path) => switchedTo.push(path), async () => {
            throw failure;
        }),
        (err) => err === failure,
    );
    assert.deepEqual(switchedTo, ["/projects/app", "/projects/feature"]);
});

test("preserves the action error when restoring the previous worktree also fails", async () => {
    const failure = new Error("checkout failed");
    let switchCount = 0;

    await assert.rejects(
        runInWorktree("/projects/app", "/projects/feature", async () => {
            switchCount += 1;
            if (switchCount === 2)
                throw new Error("restore failed");
        }, async () => {
            throw failure;
        }),
        (err) => err === failure,
    );
});
