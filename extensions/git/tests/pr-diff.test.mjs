import assert from "node:assert/strict";
import test from "node:test";

const calls = [];
let nativeDiff;
let nativeError;
let fallbackDiff;

globalThis.muxy = {
    git: {
        pr: {
            diff: async (input) => {
                calls.push(["native", input]);
                if (nativeError)
                    throw nativeError;
                return nativeDiff;
            },
        },
    },
    exec: async (argv) => {
        calls.push(["exec", argv]);
        return { exitCode: 0, stdout: fallbackDiff, stderr: "" };
    },
};

const { prDiff } = await import("../src/lib/forge/gh.js");

function reset() {
    calls.length = 0;
    nativeDiff = { diff: "", truncated: false };
    nativeError = null;
    fallbackDiff = "fallback patch";
}

test("uses the native pull request diff when it contains changes", async () => {
    reset();
    nativeDiff = { diff: "native patch", truncated: true };

    assert.deepEqual(await prDiff(10), nativeDiff);
    assert.deepEqual(calls, [["native", { number: 10 }]]);
});

test("falls back to gh when the native diff is empty", async () => {
    reset();

    assert.deepEqual(await prDiff(10), { diff: "fallback patch", truncated: false });
    assert.deepEqual(calls, [
        ["native", { number: 10 }],
        ["exec", ["gh", "pr", "diff", "10", "--color", "never"]],
    ]);
});

test("falls back to gh when the native diff fails", async () => {
    reset();
    nativeError = new Error("native failure");

    assert.deepEqual(await prDiff(10), { diff: "fallback patch", truncated: false });
    assert.equal(calls[1][0], "exec");
});
