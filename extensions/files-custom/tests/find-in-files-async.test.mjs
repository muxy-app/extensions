import assert from "node:assert/strict";
import test from "node:test";

import { execAsyncFromSync, openRunScript, runModalQuery } from "./find-in-files-test-utils.mjs";

test("Find in Files runScript reuses cached results for repeated query changes", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      calls.push(options.stdin.trim());
      return { exitCode: 0, stdout: "src/main.js:7:needle once\n" };
    }),
  };

  try {
    await openRunScript("coalesce-query-change");

    const first = await runModalQuery(modalOptions, "needle");
    const second = await runModalQuery(modalOptions, "needle");

    assert.equal(first.emittedItems[0].title, "needle once");
    assert.equal(second.emittedItems[0].title, "needle once");

    assert.deepEqual(calls, ["needle"]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript emits each distinct query result asynchronously", async () => {
  let modalOptions = null;
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      const query = options.stdin.trim();
      calls.push(query);
      return { exitCode: 0, stdout: `src/${query}.js:2:${query} result\n` };
    }),
  };

  try {
    await openRunScript("stale-result");

    const alpha = await runModalQuery(modalOptions, "alpha");
    const beta = await runModalQuery(modalOptions, "beta");

    assert.equal(alpha.emittedItems[0].title, "alpha result");
    assert.equal(beta.emittedItems[0].title, "beta result");
    assert.deepEqual(calls, ["alpha", "beta"]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files does not run shell search on the query callback stack", async () => {
  let modalOptions = null;
  let execCount = 0;
  const fedItems = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      execCount += 1;
      return { exitCode: 0, stdout: `src/main.js:7:${options.stdin.trim()} async\n` };
    }),
  };

  try {
    await openRunScript("query-stack-nonblocking");

    const immediate = modalOptions.onQuery("needle", (items) => {
      fedItems.push(...items);
    });

    assert.equal(typeof immediate?.then, "function");
    assert.equal(execCount, 0);

    await immediate;

    assert.equal(execCount, 1);
    assert.equal(fedItems[0].title, "needle async");
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files emits asynchronously when setTimeout is unavailable", async () => {
  let modalOptions = null;
  let execCount = 0;
  const fedItems = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      execCount += 1;
      return { exitCode: 0, stdout: `src/main.js:7:${options.stdin.trim()} fallback\n` };
    }),
  };

  try {
    delete globalThis.setTimeout;
    delete globalThis.clearTimeout;
    await openRunScript("query-stack-no-timeout");

    const immediate = modalOptions.onQuery("needle", (items) => {
      fedItems.push(...items);
    });

    assert.equal(typeof immediate?.then, "function");
    assert.equal(execCount, 0);

    await immediate;

    assert.equal(execCount, 1);
    assert.equal(fedItems[0].title, "needle fallback");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.muxy;
  }
});

test("Find in Files emits cached results asynchronously", async () => {
  let modalOptions = null;
  let execCount = 0;
  const fedItems = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      execCount += 1;
      return { exitCode: 0, stdout: `src/main.js:7:${options.stdin.trim()} cached\n` };
    }),
  };

  try {
    await openRunScript("cached-query-stack-nonblocking");

    await runModalQuery(modalOptions, "needle");
    const immediate = modalOptions.onQuery("needle", (items) => {
      fedItems.push(...items);
    });

    assert.equal(typeof immediate?.then, "function");
    assert.equal(execCount, 1);
    assert.equal(fedItems.length, 0);

    await immediate;

    assert.equal(execCount, 1);
    assert.equal(fedItems[0].title, "needle cached");
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files cache hits cancel pending stale searches", async () => {
  let modalOptions = null;
  const calls = [];
  const emissions = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv, options) => {
      const query = options.stdin.trim();
      calls.push(query);
      return { exitCode: 0, stdout: `src/${query}.js:2:${query} result\n` };
    }),
  };

  try {
    await openRunScript("cached-hit-cancels-pending");

    await runModalQuery(modalOptions, "needle");
    const stale = modalOptions.onQuery("alpha", (items) => {
      emissions.push({ query: "alpha", title: items[0]?.title });
    });
    const cached = modalOptions.onQuery("needle", (items) => {
      emissions.push({ query: "needle", title: items[0]?.title });
    });

    await Promise.all([stale, cached]);

    assert.deepEqual(calls, ["needle"]);
    assert.deepEqual(emissions, [{ query: "needle", title: "needle result" }]);
  } finally {
    delete globalThis.muxy;
  }
});
