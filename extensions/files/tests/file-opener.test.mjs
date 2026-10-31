import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { FileIndex, score_path } from "../scripts/quick-open/search.js";

// The palette script exactly as the build ships it: one bundled plain script.
const QUICK_OPEN = buildSync({
  entryPoints: [new URL("../scripts/quick-open.js", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
}).outputFiles[0].text;

function run_quick_open({ files = ["src/main.js"], editors = {} } = {}) {
  const opened = [];
  const switched = [];
  const storage = new Map(Object.entries(editors));
  let modal = null;
  const muxy = {
    extensionID: "files",
    modal: { open: (options) => void (modal = options) },
    exec: (argv) => {
      if (argv[0] === "pwd") return { exitCode: 0, stdout: "/p\n" };
      return { exitCode: 0, stdout: files.join("\0") };
    },
    storage: {
      keys: () => [...storage.keys()],
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => void storage.set(key, value),
      delete: (key) => void storage.delete(key),
    },
    tabs: {
      open: (request) => void opened.push(request),
      switchTo: (pane) => {
        switched.push(pane);
        if (!String(pane).startsWith("live")) throw new Error("tab not found");
      },
    },
  };
  vm.runInNewContext(QUICK_OPEN, { console, muxy, Date });
  return { modal, opened, switched, storage };
}

test("the file opener opens a new editor tab per file", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const opener = manifest.muxy.fileOpeners.find((item) => item.id === "editor");
  assert.equal(opener.tabType, "code-editor");
  assert.equal(opener.singleton, false);
});

test("quick open opens a new editor tab for a file that isn't open", () => {
  const { modal, opened } = run_quick_open();
  modal.onSelect({ id: "src/main.js" });
  assert.equal(opened.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(opened[0].extension)), {
    id: "files",
    tabType: "code-editor",
    data: { filePath: "src/main.js" },
  });
});

test("quick open focuses the tab already showing the file", () => {
  const now = Date.now();
  const { modal, opened, switched } = run_quick_open({
    editors: {
      "editor:dead": { root: "/p", path: "src/main.js", at: now },
      "editor:live-7": { root: "/p", path: "src/main.js", at: now - 1000 },
      "editor:live-other": { root: "/elsewhere", path: "src/main.js", at: now },
    },
  });
  modal.onSelect({ id: "src/main.js" });
  assert.deepEqual(switched, ["dead", "live-7"]);
  assert.equal(opened.length, 0);
});

test("quick open ranks file-name matches first and is fuzzy", () => {
  const { modal } = run_quick_open({ files: ["docs/domain.md", "src/lib/main.js", "main.go", "src/models/user_account.rb"] });
  const ids = (query) => JSON.parse(JSON.stringify(modal.onQuery(query).map((item) => item.id)));
  assert.deepEqual(ids("main"), ["main.go", "src/lib/main.js", "docs/domain.md"]);
  assert.deepEqual(ids("usracc"), ["src/models/user_account.rb"]);
  const first = modal.onQuery("main")[1];
  assert.equal(first.title, "main.js");
  assert.equal(first.subtitle, "src/lib");
});

test("narrowing a query re-scans only the previous matches", () => {
  const index = new FileIndex(["a/alpha.js", "b/beta.js", "c/alphabet.txt"]);
  assert.deepEqual(index.search("alp"), ["a/alpha.js", "c/alphabet.txt"]);
  // "alpha." still fuzzy-matches alphabet.txt, but the exact name ranks first.
  assert.deepEqual(index.search("alpha."), ["a/alpha.js", "c/alphabet.txt"]);
  assert.deepEqual(index.last.matches.length, 2);
  assert.deepEqual(index.search("be"), ["b/beta.js", "c/alphabet.txt"]);
  assert.equal(score_path("src/x.js", 4, "zz"), -1);
});
