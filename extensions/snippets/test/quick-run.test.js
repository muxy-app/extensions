// Quick run (native picker + prompts), driven the way Muxy runs a runScript:
// modal.open returns right away and reports the choice through onSelect.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/lib/core.js";
import { sample } from "./fixtures.js";
import { quickRun, pickerItems, askVariables } from "../src/quick-run/quick-run.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function scriptMuxy({ answers = [] } = {}) {
  const store = { state: C.normalize(sample()) };
  const log = [];
  let picker = null;
  globalThis.muxy = {
    storage: { get: (k) => (k in store ? structuredClone(store[k]) : null), set: (k, v) => void (store[k] = structuredClone(v)) },
    panes: {
      list: () => [{ id: "p1", title: "zsh", workingDirectory: "~/projects/web-app", isFocused: true }],
      send: (id, text) => void log.push(["send", id, text]),
    },
    tabs: { open: (req) => (log.push(["tab", req]), "t1") },
    toast: (t) => void log.push(["toast", t.title, t.body]),
    modal: {
      open(options) {
        picker = options;
      },
    },
    dialog: {
      prompt(options) {
        log.push(["prompt", options.title, options.placeholder]);
        return answers.length ? answers.shift() : null;
      },
    },
  };
  return {
    store,
    log,
    sends: () => log.filter((l) => l[0] === "send"),
    picker: () => picker,
    async choose(name) {
      await tick();
      const item = picker.items.find((i) => i.title === name);
      picker.onSelect(item ?? null);
    },
  };
}

test("picker items list every snippet with group and command", () => {
  const items = pickerItems(C.normalize(sample()));
  assert.equal(items.length, 12);
  const rebuild = items.find((i) => i.title === "Rebuild and start");
  assert.equal(rebuild.subtitle, "Docker · docker compose up -d --build");
  const multi = items.find((i) => i.title === "Clean merged branches");
  assert.match(multi.subtitle, /^Git · git remote prune origin ⏎ git branch/);
});

test("runs a snippet without variables using its default action", async () => {
  const m = scriptMuxy();
  const done = quickRun();
  await m.choose("Rebuild and start");
  const res = await done;
  assert.equal(res.snippet.name, "Rebuild and start");
  assert.equal(m.picker().placeholder, "Run a snippet…");
  assert.deepEqual(m.sends(), [["send", "p1", "docker compose up -d --build\r"]]);
  assert.ok(m.log.some((l) => l[0] === "toast" && l[1] === "Ran “Rebuild and start”"));
  assert.ok(m.store.state.snippets.find((s) => s.name === "Rebuild and start").updatedAt > 0);
});

test("asks for variables with native prompts and remembers them", async () => {
  const m = scriptMuxy({ answers: ["staging"] });
  const done = quickRun();
  await m.choose("Pods in namespace");
  await done;
  assert.deepEqual(m.log.find((l) => l[0] === "prompt"), ["prompt", "Pods in namespace: namespace", "required"]);
  assert.deepEqual(m.sends(), [["send", "p1", "kubectl -n staging get pods -o wide\r"]]);
  assert.equal(m.store.state.snippets.find((s) => s.name === "Pods in namespace").lastVars.namespace, "staging");
});

test("empty answers fall back to defaults; tab snippets open a new tab", async () => {
  const m = scriptMuxy({ answers: ["prod", "api", ""] });
  const done = quickRun();
  await m.choose("Port-forward service");
  await done;
  const prompts = m.log.filter((l) => l[0] === "prompt");
  assert.equal(prompts[2][2], "8080 (leave empty to use)");
  assert.deepEqual(m.log.find((l) => l[0] === "tab"), ["tab", { kind: "terminal", command: "kubectl -n prod port-forward svc/api 8080:80" }]);
});

test("cancelling the picker or a prompt sends nothing", async () => {
  let m = scriptMuxy();
  let done = quickRun();
  await tick();
  m.picker().onSelect(null);
  assert.equal(await done, null);

  m = scriptMuxy({ answers: [] }); // prompt returns null = cancelled
  done = quickRun();
  await m.choose("SSH to host");
  assert.equal(await done, null);
  assert.deepEqual(m.sends(), []);
});

test("a required variable left empty is reported, not sent", async () => {
  const m = scriptMuxy({ answers: [""] });
  const done = quickRun();
  await m.choose("Pods in namespace");
  assert.equal(await done, null);
  assert.deepEqual(m.sends(), []);
  assert.deepEqual(m.log.find((l) => l[0] === "toast"), ["toast", "Snippet not sent", "Missing: namespace"]);
});

test("askVariables uses remembered values as the fallback", async () => {
  const snippet = { name: "SSH", command: "ssh {{user:ubuntu}}@{{host}}", lastVars: { host: "10.0.0.5" } };
  const asked = [];
  const values = await askVariables(snippet, async (o) => (asked.push(o.placeholder), ""));
  assert.deepEqual(values, { user: "ubuntu", host: "10.0.0.5" });
  assert.deepEqual(asked, ["ubuntu (leave empty to use)", "10.0.0.5 (leave empty to use)"]);
});

test("page-style picker (Promise) works too", async () => {
  const m = scriptMuxy();
  globalThis.muxy.modal.open = async (options) => options.items.find((i) => i.title === "Disk usage");
  await quickRun();
  assert.deepEqual(m.sends(), [["send", "p1", "df -h && du -sh * | sort -h\r"]]);
});
