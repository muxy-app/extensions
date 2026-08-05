import assert from "node:assert/strict";
import test from "node:test";

import { execAsyncFromSync, openRunScript, runModalQuery } from "./find-in-files-test-utils.mjs";

const NUL = "\0";

test("Find in Files runScript strips the ./ prefix ripgrep adds to every match", async () => {
  let modalOptions = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => ({
      exitCode: 0,
      stdout: `./src/main.js${NUL}12:const needle = 1;\n`,
    })),
  };

  try {
    await openRunScript("rg-dot-slash");

    const result = await runModalQuery(modalOptions, "needle");

    assert.deepEqual(result.emittedItems, [
      {
        id: JSON.stringify({ filePath: "src/main.js", lineNumber: 12 }),
        title: "const needle = 1;",
        subtitle: "src/main.js:12",
      },
    ]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript gives rg and grep hits the same identity for one file", async () => {
  const emitted = [];
  for (const stdout of [`./src/main.js${NUL}12:const needle = 1;\n`, "src/main.js:12:const needle = 1;\n"]) {
    let modalOptions = null;
    globalThis.muxy = {
      modal: {
        open(options) {
          modalOptions = options;
        },
      },
      execAsync: execAsyncFromSync(() => ({ exitCode: 0, stdout })),
    };

    try {
      await openRunScript(`identity-${emitted.length}`);
      const result = await runModalQuery(modalOptions, "needle");
      emitted.push(result.emittedItems[0]);
    } finally {
      delete globalThis.muxy;
    }
  }

  // A cache keyed on the id must not split just because grep answered instead of rg.
  assert.deepEqual(emitted[0], emitted[1]);
});

test("Find in Files runScript keeps colons in ripgrep paths out of the line number", async () => {
  let modalOptions = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => ({
      exitCode: 0,
      stdout: `./a:b/f.js${NUL}1:needle here\n`,
    })),
  };

  try {
    await openRunScript("colon-path");

    const result = await runModalQuery(modalOptions, "needle");

    assert.deepEqual(result.emittedItems, [
      {
        id: JSON.stringify({ filePath: "a:b/f.js", lineNumber: 1 }),
        title: "needle here",
        subtitle: "a:b/f.js:1",
      },
    ]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript keeps a matched line that itself starts with digits and a colon", async () => {
  let modalOptions = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync(() => ({
      exitCode: 0,
      stdout: `./src/main.js${NUL}3:42: needle answer\n`,
    })),
  };

  try {
    await openRunScript("digit-content");

    const result = await runModalQuery(modalOptions, "needle");

    assert.deepEqual(result.emittedItems, [
      {
        id: JSON.stringify({ filePath: "src/main.js", lineNumber: 3 }),
        title: "42: needle answer",
        subtitle: "src/main.js:3",
      },
    ]);
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files runScript asks ripgrep for NUL-delimited paths", async () => {
  let modalOptions = null;
  let searchArgv = null;
  globalThis.muxy = {
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    execAsync: execAsyncFromSync((argv) => {
      searchArgv = argv;
      return { exitCode: 0, stdout: "" };
    }),
  };

  try {
    await openRunScript("null-flag");

    await runModalQuery(modalOptions, "needle");

    assert.ok(searchArgv.includes("--null"));
  } finally {
    delete globalThis.muxy;
  }
});
