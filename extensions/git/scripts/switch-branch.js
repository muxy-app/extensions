import { rank } from "@/shared/picker";
import { exec, fail, notify, pick, tryExec } from "./lib/sync.js";

const DIRTY = /overwritten by checkout|commit your changes or stash them|would be overwritten/i;

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

let data = null;

function load() {
  if (data) return data;
  const current = safe(() => muxy.git.currentBranch(), null);
  const local = safe(() => muxy.git.branches(), []).map(String);
  const localSet = new Set(local);
  const items = local.map((name) => ({ id: `local:${name}`, title: name, subtitle: name === current ? "Current branch" : null }));
  items.sort((a, b) => (a.title === current ? -1 : b.title === current ? 1 : 0));
  for (const ref of safe(() => muxy.git.remoteBranches(), []).map(String)) {
    const short = ref.replace(/^[^/]+\//, "");
    if (!ref.endsWith("/HEAD") && !localSet.has(short)) items.push({ id: `remote:${ref}`, title: short, subtitle: ref });
  }
  data = { current, localSet, items };
  return data;
}

function run(argv, label) {
  try {
    exec(argv);
    notify(label);
    return true;
  } catch (err) {
    return err;
  }
}

function switchTo(name, remote) {
  const argv = remote ? ["git", "switch", "--track", remote] : ["git", "switch", name];
  const result = run(argv, `Switched to ${name}`);
  if (result === true) return;
  if (!DIRTY.test(String(result.message))) return fail("Could not switch branches", result);
  const choice = safe(() => muxy.dialog.confirm({ title: "Uncommitted changes", message: `Your changes conflict with “${name}”. Stash them, switch, and bring them back?`, buttons: ["Stash & Switch", "Cancel"], default: "Stash & Switch", cancel: "Cancel" }), null);
  if (choice !== "Stash & Switch") return;
  try {
    exec(["git", "stash", "push", "--include-untracked", "-m", `Switching to ${name}`]);
    exec(argv);
    exec(["git", "stash", "pop"]);
    notify(`Switched to ${name}`);
  } catch (err) {
    fail("Could not switch branches", err);
  }
}

function create(name) {
  if (!tryExec(["git", "check-ref-format", "--branch", name])) return fail("Invalid branch name", new Error(`“${name}” isn't a valid branch name.`));
  const result = run(["git", "switch", "-c", name], `Created ${name}`);
  if (result !== true) fail("Could not create the branch", result);
}

pick(
  {
    placeholder: "Switch to a branch, or type a new name…",
    emptyLabel: "No branches",
    noMatchLabel: "No matching branches",
    items: (emit) => emit(load().items.slice(0, 500)),
    onQuery: (query) => {
      const { localSet, items } = load();
      const q = query.trim();
      const extra = q && !localSet.has(q) ? [{ id: `create:${q}`, title: `Create branch “${q}”`, subtitle: "From the current commit" }] : [];
      return [...extra, ...rank(items, q)];
    },
  },
  (choice) => {
    const [kind, ...rest] = choice.id.split(":");
    const value = rest.join(":");
    if (kind === "create") create(value);
    else if (kind === "remote") switchTo(value.replace(/^[^/]+\//, ""), value);
    else if (value !== load().current) switchTo(value);
  },
);
