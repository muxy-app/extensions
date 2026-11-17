import assert from "node:assert/strict";
import test from "node:test";

import { execAsyncFromSync, openRunScript, runModalQuery } from "./find-in-files-test-utils.mjs";

test("Find in Files runScript searches Korean query after composition has two characters", async () => {
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
      return { exitCode: 0, stdout: "src/main.js:1:한글\n" };
    }),
  };

  try {
    await openRunScript("korean-query");

    const result = await runModalQuery(modalOptions, "한글");

    assert.deepEqual(result.emittedItems, [
      {
        id: JSON.stringify({ filePath: "src/main.js", lineNumber: 1 }),
        title: "한글",
        subtitle: "src/main.js:1",
      },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.stdin, "한글\n한글\n한글\n한글\n");
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript reuses cached results across prefix retype cycles", async () => {
  let modalOptions = null;
  const searchedQueries = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      const query = options.stdin.trim();
      searchedQueries.push(query);
      return { exitCode: 0, stdout: `src/main.js:7:${query} cached\n` };
    }),
  };

  try {
    await openRunScript("prefix-retype-cache");

    const test1 = await runModalQuery(modalOptions, "test");
    assert.equal(test1.emittedItems[0].title, "test cached");
    assert.deepEqual(modalOptions.onQuery(""), []);
    const tes1 = await runModalQuery(modalOptions, "tes");
    const test2 = await runModalQuery(modalOptions, "test");
    assert.equal(tes1.emittedItems[0].title, "tes cached");
    assert.equal(test2.emittedItems[0].title, "test cached");
    assert.deepEqual(modalOptions.onQuery(""), []);
    const tes2 = await runModalQuery(modalOptions, "tes");
    const test3 = await runModalQuery(modalOptions, "test");
    assert.equal(tes2.emittedItems[0].title, "tes cached");
    assert.equal(test3.emittedItems[0].title, "test cached");
    assert.deepEqual(searchedQueries, ["test", "tes"]);
  } finally {
    delete globalThis.muxy;
  }
});
