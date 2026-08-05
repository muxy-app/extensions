import assert from "node:assert/strict";
import test from "node:test";

import { execAsyncFromSync, openRunScript, runModalQuery } from "./find-in-files-test-utils.mjs";

test("Find in Files runScript reuses the previous result after clearing and retyping the same query", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      calls.push({ argv, options });
      return { exitCode: 0, stdout: "src/main.js:7:needle cached\n" };
    }),
  };

  try {
    await openRunScript("clear-research-cache");

    const first = await runModalQuery(modalOptions, "needle");
    assert.equal(first.emittedItems[0].title, "needle cached");
    assert.deepEqual(modalOptions.onQuery(""), []);
    const second = await runModalQuery(modalOptions, "needle");
    assert.equal(second.emittedItems[0].title, "needle cached");
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.muxy;
  }
});

function search_command(argv) {
  return argv.find((arg) => arg === "rg" || arg === "grep");
}

test("Find in Files reports an rg timeout without starting grep", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv) => {
      const command = search_command(argv);
      calls.push(command);
      if (command === "rg") throw new Error("timed out");
      return { exitCode: 0, stdout: "src/main.js:7:needle fallback\n" };
    }),
  };

  try {
    await openRunScript("rg-timeout-no-grep");

    const result = await runModalQuery(modalOptions, "needle");

    assert.equal(typeof result.immediateItems?.then, "function");
    assert.equal(result.emittedItems[0].title, "Search timed out");
    assert.deepEqual(calls, ["rg"]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript does not cache an rg execution failure", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv) => {
      calls.push(search_command(argv));
      if (calls.length === 1) throw new Error("timed out");
      return { exitCode: 0, stdout: "src/main.js:7:needle retry\n" };
    }),
  };

  try {
    await openRunScript("rg-timeout-retry");

    const failed = await runModalQuery(modalOptions, "needle");
    const retried = await runModalQuery(modalOptions, "needle");

    assert.equal(typeof failed.immediateItems?.then, "function");
    assert.equal(failed.emittedItems[0].title, "Search timed out");
    assert.equal(retried.emittedItems[0].title, "needle retry");
    assert.deepEqual(calls, ["rg", "rg"]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript falls back to grep when rg is unavailable", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      calls.push({ argv, options });
      if (search_command(argv) === "rg") {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "command not found\n__MUXY_FIND_IN_FILES_EXIT__=127\n",
        };
      }
      return { exitCode: 0, stdout: "src/main.js:7:needle fallback\n" };
    }),
  };

  try {
    await openRunScript("grep-fallback");

    const result = await runModalQuery(modalOptions, "needle");

    assert.equal(result.emittedItems[0].title, "needle fallback");
    assert.deepEqual(
      calls.map((call) => search_command(call.argv)),
      ["rg", "grep"],
    );
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files falls back to grep when the rg launch rejects", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv) => {
      const command = search_command(argv);
      calls.push(command);
      if (command === "rg") {
        const error = new Error("exec failed to launch: command not found: rg");
        error.code = "error";
        error.cancelled = false;
        throw error;
      }
      return { exitCode: 0, stdout: "src/main.js:7:needle fallback\n" };
    }),
  };

  try {
    await openRunScript("grep-launch-rejection-fallback");

    const result = await runModalQuery(modalOptions, "needle");

    assert.equal(result.emittedItems[0].title, "needle fallback");
    assert.deepEqual(calls, ["rg", "grep"]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files does not fall back after cancellation", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv) => {
      calls.push(search_command(argv));
      const error = new Error("exec cancelled");
      error.code = "cancelled";
      error.cancelled = true;
      throw error;
    }),
  };

  try {
    await openRunScript("cancel-no-fallback");

    const result = await runModalQuery(modalOptions, "needle");

    assert.deepEqual(result.emittedItems, []);
    assert.deepEqual(calls, ["rg"]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files reports an invalid regex from the wrapped command status", async () => {
  let modalOptions = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "regex parse error\n__MUXY_FIND_IN_FILES_EXIT__=2\n",
      timedOut: false,
    })),
  };

  try {
    await openRunScript("invalid-regex");

    const result = await runModalQuery(modalOptions, "(broken", { regex: true });

    assert.equal(result.emittedItems[0].id, "__error__");
    assert.equal(result.emittedItems[0].title, "Invalid pattern");
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files emits partial matches returned by a timed-out search", async () => {
  let modalOptions = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => ({
      exitCode: 15,
      stdout: "src/main.js:7:needle before timeout\n",
      stderr: "",
      timedOut: true,
    })),
  };

  try {
    await openRunScript("timeout-partial-results");

    const result = await runModalQuery(modalOptions, "needle");

    assert.equal(result.emittedItems.length, 1);
    assert.equal(result.emittedItems[0].title, "needle before timeout");
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files reports a non-regex command failure", async () => {
  let modalOptions = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => ({ exitCode: 2, stdout: "", stderr: "failed" })),
  };

  try {
    await openRunScript("search-failure");

    const result = await runModalQuery(modalOptions, "needle");

    assert.equal(result.emittedItems[0].id, "__error__");
    assert.equal(result.emittedItems[0].title, "Search failed");
  } finally {
    delete globalThis.muxy;
  }
});
