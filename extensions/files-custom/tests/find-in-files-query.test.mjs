import assert from "node:assert/strict";
import test from "node:test";

import { execAsyncFromSync, openRunScript, runModalQuery } from "./find-in-files-test-utils.mjs";

test("Find in Files runScript does not run shell search when modal emit is unavailable", async () => {
  let modalOptions = null;
  let execCount = 0;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => {
      execCount += 1;
      return { exitCode: 0, stdout: "src/main.js:12:const needle = true;\n" };
    }),
  };

  try {
    await openRunScript("without-feed");

    assert.deepEqual(modalOptions.onQuery("needle"), []);
    assert.equal(execCount, 0);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript returns query results from onQuery", async () => {
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
      assert.ok(Array.isArray(argv), "muxy.exec receives argv array");
      assert.equal(argv[0], "sh");
      assert.ok(argv.includes("rg"));
      assert.ok(argv[2].includes("head -n 120"));
      assert.equal(options.stdin, "needle\n");
      assert.equal("maxLines" in options, false);
      return { exitCode: 0, stdout: "src/main.js:12:const needle = true;\n" };
    }),
  };

  try {
    await openRunScript("return-query");

    const result = await runModalQuery(modalOptions, "needle");

    assert.equal(typeof result.immediateItems?.then, "function");
    assert.deepEqual(result.emittedItems, [
      {
        id: JSON.stringify({ filePath: "src/main.js", lineNumber: 12 }),
        title: "const needle = true;",
        subtitle: "src/main.js:12",
      },
    ]);
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript passes search options and stdin to muxy.exec", async () => {
  let modalOptions = null;
  let searchRequest = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      searchRequest = { argv, options };
      return { exitCode: 0, stdout: "" };
    }),
  };

  try {
    await openRunScript("options");

    const result = await runModalQuery(modalOptions, "needle", {
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    });

    assert.equal(typeof result.immediateItems?.then, "function");
    assert.deepEqual(result.emittedItems, []);

    assert.ok(searchRequest.argv.includes("-w"));
    assert.equal(searchRequest.argv.includes("-i"), false);
    assert.equal(searchRequest.argv.includes("-F"), false);
    assert.equal(searchRequest.options.stdin, "needle\n");
    assert.equal("maxLines" in searchRequest.options, false);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript skips shell search for short Korean composition input", async () => {
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
      return { exitCode: 0, stdout: "" };
    }),
  };

  try {
    await openRunScript("short-korean");

    assert.deepEqual(modalOptions.onQuery("ㅎ"), []);
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript skips shell search for short English input", async () => {
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
      return { exitCode: 0, stdout: "" };
    }),
  };

  try {
    await openRunScript("short-english");

    assert.deepEqual(modalOptions.onQuery("to"), []);
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript bounds common English searches", async () => {
  let modalOptions = null;
  let searchRequest = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      searchRequest = { argv, options };
      return { exitCode: 0, stdout: "" };
    }),
  };

  try {
    await openRunScript("bounded-english");

    const result = await runModalQuery(modalOptions, "the");

    assert.equal(typeof result.immediateItems?.then, "function");
    assert.deepEqual(result.emittedItems, []);

    assert.ok(searchRequest.argv.includes("--max-count"));
    assert.ok(searchRequest.argv.includes("3"));
    assert.ok(searchRequest.argv.includes("--threads"));
    assert.ok(searchRequest.argv.includes("2"));
    assert.ok(searchRequest.argv.includes("!.omo/**"));
    assert.ok(searchRequest.argv.includes("!**/package-lock.json"));
    assert.ok(searchRequest.argv[2].includes("head -n 120"));
    assert.equal("maxLines" in searchRequest.options, false);
    assert.equal(searchRequest.options.timeoutMs, 350);
  } finally {
    delete globalThis.muxy;
  }
});
