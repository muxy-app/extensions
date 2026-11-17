import assert from "node:assert/strict";
import test from "node:test";
import { install_storage } from "./support/dom-stubs.mjs";

install_storage();
const { ACTIVE_KEY, ENTRY_PREFIX, GOTO_KEY, EditorRegistration, editors_for, open_file, project_root } = await import("@/shared/editors");

function fake_muxy({ root = "/p", livePanes = [] } = {}) {
  const calls = { switched: [], opened: [], stored: new Map() };
  globalThis.muxy = {
    extensionID: "files",
    tabInstanceID: "self",
    exec: async () => ({ exitCode: 0, stdout: `${root}\n` }),
    tabs: {
      switchTo: async (id) => {
        calls.switched.push(id);
        if (!livePanes.includes(id)) throw new Error(`tab not found ${id}`);
      },
      open: async (request) => void calls.opened.push(request),
    },
    storage: {
      set: async (key, value) => void calls.stored.set(key, value),
      delete: async (key) => void calls.stored.delete(key),
      get: async (key) => calls.stored.get(key) ?? null,
    },
  };
  return calls;
}

function register(pane, entry) {
  localStorage.setItem(ENTRY_PREFIX + pane, JSON.stringify({ since: 1, at: Date.now(), ...entry }));
}

test("editors are matched by project root and path", async () => {
  localStorage.clear();
  fake_muxy();
  register("a", { root: "/p", path: "README.md" });
  register("b", { root: "/other", path: "README.md" });
  register("c", { root: "/p", path: "docs/README.md" });
  assert.deepEqual(editors_for("/p", "README.md").map((e) => e.pane), ["a"]);
  assert.deepEqual(editors_for(null, "README.md"), []);
});

test("open_file focuses the existing tab instead of opening another", async () => {
  localStorage.clear();
  const calls = fake_muxy({ livePanes: ["a"] });
  await project_root({ fresh: true });
  register("a", { root: "/p", path: "src/x.js" });
  await open_file("src/x.js", { line: 12, column: 3 });
  assert.deepEqual(calls.switched, ["a"]);
  assert.equal(calls.opened.length, 0);
  assert.equal(calls.stored.get(GOTO_KEY).pane, "a");
  assert.equal(calls.stored.get(GOTO_KEY).line, 12);
});

test("open_file forgets dead tabs and opens a new one", async () => {
  localStorage.clear();
  const calls = fake_muxy({ livePanes: [] });
  await project_root({ fresh: true });
  register("gone", { root: "/p", path: "src/x.js" });
  await open_file("src/x.js");
  assert.deepEqual(calls.switched, ["gone"]);
  assert.equal(localStorage.getItem(ENTRY_PREFIX + "gone"), null);
  assert.equal(calls.opened.length, 1);
  assert.deepEqual(calls.opened[0].extension, { id: "files", tabType: "code-editor", data: { filePath: "src/x.js" } });
});

test("stale registrations are pruned", async () => {
  localStorage.clear();
  fake_muxy();
  localStorage.setItem(ENTRY_PREFIX + "old", JSON.stringify({ root: "/p", path: "a", at: 0 }));
  assert.deepEqual(editors_for("/p", "a"), []);
  assert.equal(localStorage.getItem(ENTRY_PREFIX + "old"), null);
});

test("a quick second open focuses the tab the first one created", async () => {
  localStorage.clear();
  const calls = fake_muxy({ livePanes: ["tab-1"] });
  globalThis.muxy.tabs.open = async (request) => {
    calls.opened.push(request);
    return "tab-1";
  };
  await project_root({ fresh: true });
  await open_file("src/new.js");
  await open_file("src/new.js");
  assert.equal(calls.opened.length, 1);
  assert.deepEqual(calls.switched, ["tab-1"]);
});

// ---- Tab reuse ---------------------------------------------------------------

// Plays the editor page that owns `pane`: answers replace requests the way a
// real tab does, through a storage event in "another page".
function fake_editor(pane, answer) {
  const timer = setInterval(() => {
    const request = JSON.parse(localStorage.getItem("muxy.files.replace") ?? "null");
    if (!request || request.pane !== pane || request.answered) return;
    localStorage.setItem("muxy.files.replace", JSON.stringify({ ...request, answered: true }));
    const key = `muxy.files.replace-ack:${request.nonce}`;
    localStorage.setItem(key, JSON.stringify({ ok: answer(request) }));
    window.dispatchEvent({ type: "storage", key });
  }, 1);
  return () => clearInterval(timer);
}

function make_active(pane, { preview = true, path = "a.js" } = {}) {
  register(pane, { root: "/p", path, preview });
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ root: "/p", path, pane, preview, at: Date.now() }));
}

test("opening a file reuses the active preview tab when it agrees", async () => {
  localStorage.clear();
  const calls = fake_muxy({ livePanes: ["pane-1"] });
  await project_root({ fresh: true });
  make_active("pane-1");
  const requests = [];
  const stop = fake_editor("pane-1", (request) => (requests.push(request), true));
  await open_file("b.js", { line: 4 });
  stop();
  assert.equal(calls.opened.length, 0);
  assert.deepEqual(calls.switched, ["pane-1"]);
  assert.equal(requests[0].path, "b.js");
  assert.equal(requests[0].position.line, 4);
});

test("an edited (kept) tab is never replaced", async () => {
  localStorage.clear();
  const calls = fake_muxy({ livePanes: ["pane-1"] });
  await project_root({ fresh: true });
  make_active("pane-1", { preview: false });
  await open_file("b.js");
  assert.equal(calls.opened.length, 1);
  assert.equal(localStorage.getItem("muxy.files.replace"), null);
});

test("a tab that declines or never answers leaves the file to a new tab", async () => {
  localStorage.clear();
  let calls = fake_muxy({ livePanes: ["pane-1"] });
  await project_root({ fresh: true });
  make_active("pane-1");
  const stop = fake_editor("pane-1", () => false);
  await open_file("b.js");
  stop();
  assert.equal(calls.opened.length, 1);

  localStorage.clear();
  calls = fake_muxy({ livePanes: ["pane-1"] });
  make_active("pane-1");
  await open_file("c.js");
  assert.equal(calls.opened.length, 1);
});

test("turning tab reuse off always opens a new tab", async () => {
  localStorage.clear();
  const calls = fake_muxy({ livePanes: ["pane-1"] });
  await project_root({ fresh: true });
  make_active("pane-1");
  localStorage.setItem("muxy.files.editor.config", JSON.stringify({ reuseTab: false }));
  await open_file("b.js");
  assert.equal(calls.opened.length, 1);
  assert.equal(localStorage.getItem("muxy.files.replace"), null);
});

test("an editor answers replace requests addressed to its pane", async () => {
  localStorage.clear();
  fake_muxy();
  globalThis.muxy.tabInstanceID = "pane-9";
  const registration = new EditorRegistration();
  const seen = [];
  registration.onReplace = (request) => (seen.push(request.path), true);
  localStorage.setItem("muxy.files.replace", JSON.stringify({ nonce: "n1", pane: "pane-9", path: "x.md", at: Date.now() }));
  window.dispatchEvent({ type: "storage", key: "muxy.files.replace" });
  localStorage.setItem("muxy.files.replace", JSON.stringify({ nonce: "n2", pane: "other", path: "y.md", at: Date.now() }));
  window.dispatchEvent({ type: "storage", key: "muxy.files.replace" });
  registration.dispose();
  assert.deepEqual(seen, ["x.md"]);
  assert.deepEqual(JSON.parse(localStorage.getItem("muxy.files.replace-ack:n1")), { ok: true });
  assert.equal(localStorage.getItem("muxy.files.replace-ack:n2"), null);
});
