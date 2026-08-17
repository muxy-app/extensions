import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("file opener creates a new editor tab for each file", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const opener = manifest.muxy.fileOpeners.find((item) => item.id === "editor");

  assert.ok(opener);
  assert.equal(opener.tabType, "code-editor");
  assert.equal(opener.singleton, false);
});

test("quick open creates a new editor tab for the selected file", async () => {
  const source = await readFile(new URL("../scripts/quick-open.js", import.meta.url), "utf8");
  let modalOptions = null;
  let openedTab = null;
  const muxy = {
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

  vm.runInNewContext(source, { console, muxy });
  modalOptions.onSelect({ id: "src/main.js" });

  assert.deepEqual(JSON.parse(JSON.stringify(openedTab.extension)), {
    id: "files",
    tabType: "code-editor",
    singleton: false,
    data: { filePath: "src/main.js", replaceable: false },
  });
});
