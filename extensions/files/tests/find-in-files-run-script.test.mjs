import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { openRunScript } from "./find-in-files-test-utils.mjs";

test("Find in Files runScript opens the modal before the script returns", async () => {
  const calls = [];
  globalThis.muxy = {
    modal: {
      open(options) {
        calls.push(options);
      },
    },
  };

  try {
    await openRunScript("open");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].placeholder, "Find in files...");
    assert.equal(calls[0].searchToolbar, true);
    assert.equal(typeof calls[0].onQuery, "function");
    assert.equal("onQueryChange" in calls[0], false);
    assert.equal(typeof calls[0].onSelect, "function");
  } finally {
    delete globalThis.muxy;
  }
});

test("Find in Files command opens through runScript", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const command = manifest.muxy.commands.find((item) => item.id === "files-find-in-files");

  assert.deepEqual(command.action, { kind: "runScript", script: "scripts/find-in-files.js" });
  assert.equal("background" in manifest.muxy, false);
});

test("Find in Files runScript opens selected result in the code editor", async () => {
  let modalOptions = null;
  let openedTab = null;
  globalThis.muxy = {
    extensionID: "files",
    modal: {
      open(options) {
        modalOptions = options;
      },
    },
    tabs: {
      open(tab) {
        openedTab = tab;
      },
    },
  };

  try {
    await openRunScript("select");

    modalOptions.onSelect({
      id: JSON.stringify({ filePath: "src/main.js", lineNumber: 12 }),
    });

    assert.deepEqual(openedTab.extension.data, {
      filePath: "src/main.js",
      line: 12,
      replaceable: false,
    });
  } finally {
    delete globalThis.muxy;
  }
});
