// UI tests: load the real panel module in jsdom against a mocked
// Muxy API. Run with `npm run test:ui` (needs `npm install` and @muxy/ui).
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as C from "../src/lib/core.js";
import { sample } from "./fixtures.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let instance = 0;

function mockMuxy(initialState) {
  const store = initialState ? { state: C.normalize(initialState) } : {};
  const log = [];
  const muxy = {
    storage: {
      get: async (k) => (k in store ? structuredClone(store[k]) : null),
      set: async (k, v) => void (store[k] = structuredClone(v)),
    },
    panes: {
      list: async () => [{ id: "p1", title: "zsh", workingDirectory: "~/projects/web-app", isFocused: true }],
      send: async (id, text) => void log.push(["send", id, text]),
    },
    tabs: { open: async (req) => (log.push(["tab", req]), "t1") },
    toast: async (t) => void log.push(["toast", t.title]),
    dialog: { confirm: async (o) => o.buttons[0] },
    onFocus: () => {},
    modal: { closeWebview: () => void log.push(["close"]) },
  };
  return { muxy, store, log, sends: () => log.filter((l) => l[0] === "send") };
}

async function mount(entry, initialState) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const mock = mockMuxy(initialState);
  window.muxy = mock.muxy;
  for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent", "KeyboardEvent", "localStorage"]) {
    Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
  }
  globalThis.muxy = mock.muxy;
  const errors = [];
  process.on("unhandledRejection", (e) => errors.push(e));
  await import(new URL(`../src/${entry}/main.js?i=${++instance}`, import.meta.url));
  await sleep(30);

  const d = window.document;
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => Array.from(d.querySelectorAll(sel));
  return {
    ...mock,
    window,
    d,
    $,
    $$,
    errors,
    click(target) {
      const el = typeof target === "string" ? $(target) : target;
      assert.ok(el, `missing element ${target}`);
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 }));
      return sleep(30);
    },
    type(target, value) {
      const el = typeof target === "string" ? $(target) : target;
      assert.ok(el, `missing element ${target}`);
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
      return sleep(10);
    },
    key(target, key, opts = {}) {
      const el = typeof target === "string" ? $(target) : target;
      el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
      return sleep(30);
    },
    contextMenu(row) {
      row.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
      return sleep(10);
    },
    row: (name) => $$(".sn-snippet").find((r) => r.querySelector(".sn-name-text").textContent === name),
  };
}

test("fresh install shows the empty state and stores nothing", async () => {
  const p = await mount("panel");
  assert.equal(p.$$(".sn-snippet").length, 0);
  assert.ok(p.$('.mx-empty [data-act="new"]'));
  assert.ok(!("state" in p.store));
});

test("panel lists groups and runs a snippet without variables", async () => {
  const p = await mount("panel", sample());
  assert.equal(p.$$(".sn-snippet").length, 12);
  assert.equal(p.$$(".sn-section").length, 5);
  await p.click(p.row("Rebuild and start").querySelector('[data-act="run"]'));
  assert.deepEqual(p.sends().at(-1), ["send", "p1", "docker compose up -d --build\r"]);
});

test("search, group filter and variables form", async () => {
  const p = await mount("panel", sample());
  await p.type("#q", "redis");
  assert.equal(p.$$(".sn-snippet").length, 1);
  await p.type("#q", "");
  const filter = p.$("#group-filter");
  filter.value = "g_k8s";
  filter.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  await sleep(10);
  assert.equal(p.$$(".sn-snippet").length, 3);

  await p.click(p.row("Pods in namespace").querySelector('[data-act="run"]'));
  assert.ok(p.$("#vars-form"), "variables form is shown");
  await p.click('[data-act="var-go"][data-action="run"]');
  assert.match(p.$("#vars-error").textContent, /namespace/);
  await p.type('[data-var="namespace"]', "staging");
  assert.equal(p.$("#vars-preview").textContent, "kubectl -n staging get pods -o wide");
  await p.click('[data-act="var-go"][data-action="run"]');
  assert.deepEqual(p.sends().at(-1), ["send", "p1", "kubectl -n staging get pods -o wide\r"]);
  const saved = p.store.state.snippets.find((s) => s.name === "Pods in namespace");
  assert.equal(saved.lastVars.namespace, "staging");
});

test("multi-line insert joins lines without running them", async () => {
  const p = await mount("panel", sample());
  await p.click(p.row("Clean merged branches").querySelector('[data-act="insert"]'));
  assert.deepEqual(p.sends().at(-1), ["send", "p1", "git remote prune origin && git branch --merged main | grep -v main | xargs git branch -d"]);
});

test("editor saves a new snippet into a new group and warns about secrets", async () => {
  const p = await mount("panel", sample());
  await p.click('[data-act="new"]');
  await p.type("#f-name", "Tail log");
  await p.type("#f-cmd", "cd /var/log\ntail -f app.log | grep {{id}}");
  assert.equal(p.$$("#vars-detected .mx-badge").length, 1);
  const group = p.$("#f-group");
  group.value = "__new";
  group.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  await p.type("#f-newgroup", "Logs");
  await p.click('[data-act="set-action"][data-value="insert"]');
  assert.ok(p.$('[data-value="insert"]').classList.contains("is-active"));
  await p.click('[data-act="save"]');
  const saved = p.store.state.snippets.find((s) => s.name === "Tail log");
  assert.equal(saved.action, "insert");
  assert.equal(p.store.state.groups.find((g) => g.id === saved.groupId).name, "Logs");

  await p.click('[data-act="new"]');
  await p.type("#f-cmd", "mysql -uroot -pabc123");
  assert.ok(p.$("#secret-slot .sn-warn"));
});

test("right-click menu: delete, duplicate, Escape", async () => {
  const p = await mount("panel", sample());
  await p.contextMenu(p.row("Disk usage"));
  const items = p.$$(".mx-menu [data-menu]").map((b) => b.dataset.menu);
  assert.deepEqual(items, ["run", "insert", "tab", "edit", "duplicate", "copy", "delete"]);
  assert.ok(p.$(".mx-menu .mx-menu-item.is-danger"));
  await p.click('.mx-menu [data-menu="delete"]');
  assert.ok(!p.$(".mx-menu"));
  assert.ok(!p.row("Disk usage"));
  assert.ok(!p.store.state.snippets.some((s) => s.name === "Disk usage"));

  await p.contextMenu(p.row("SSH to host"));
  await p.click('.mx-menu [data-menu="duplicate"]');
  assert.ok(p.row("SSH to host copy"));

  await p.contextMenu(p.row("SSH to host"));
  await p.key(".mx-menu [data-menu]", "Escape");
  assert.ok(!p.$(".mx-menu"));
});

test("groups manager and import / export views", async () => {
  const p = await mount("panel", sample());
  await p.click('[data-act="groups"]');
  assert.equal(p.$$(".sn-group-row").length, 5);
  await p.click('[data-act="group-color"][data-id="g_git"][data-color="#f7768e"]');
  assert.equal(p.store.state.groups.find((g) => g.id === "g_git").color, "#f7768e");
  await p.click('[data-act="back"]');
  await p.click('[data-act="io"]');
  assert.match(p.$("#io-export").value, /"snippets"/);
  assert.deepEqual(p.errors, []);
});
