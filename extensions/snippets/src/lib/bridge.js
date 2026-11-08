// Everything that talks to the Muxy page API lives here.
// When `window.muxy` is missing (a page opened through `npm run dev` or straight
// in a browser), a small mock backed by localStorage stands in so the UI still runs.
import * as Core from "./core.js";

const STORAGE_KEY = "state";

let mock = null;

// Resolved on every call so the API Muxy injects is always the one used.
function api() {
  if (typeof globalThis.muxy === "object" && globalThis.muxy !== null) return globalThis.muxy;
  return (mock ??= createMock());
}

export const isMock = () => api() === mock;

function createMock() {
  const panes = [
    { id: "mock-1", title: "zsh", workingDirectory: "~/projects/web-app", isFocused: true },
    { id: "mock-2", title: "dev server", workingDirectory: "~/projects/web-app", isFocused: false },
  ];
  const ls = {
    get(key) {
      try {
        const value = localStorage.getItem("snippets:" + key);
        return value == null ? null : JSON.parse(value);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("snippets:" + key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
  };
  applyDevTheme();
  console.info("[snippets] window.muxy not found — running with a browser mock.");
  return {
    mock: true,
    storage: { get: async (k) => ls.get(k), set: async (k, v) => ls.set(k, v) },
    panes: {
      list: async () => panes,
      send: async (id, text) => console.log("[mock] send to", id, JSON.stringify(text)),
    },
    tabs: { open: async (req) => (console.log("[mock] tabs.open", req), "mock-tab") },
    toast: async (t) => console.log("[mock] toast", t.title, "—", t.body),
    dialog: {
      confirm: async (o) => (globalThis.confirm(`${o.title}\n\n${o.message || ""}`) ? (o.buttons || ["OK"])[0] : null),
    },
    onFocus: (fn) => globalThis.addEventListener("focus", fn),
  };
}

// Muxy injects the --muxy-* theme variables. Outside Muxy, supply a dark theme
// so the shared UI primitives render the same way during development.
function applyDevTheme() {
  if (typeof document === "undefined") return;
  const vars = {
    "--muxy-background": "#1e1f29",
    "--muxy-foreground": "#d4d6e4",
    "--muxy-foreground-muted": "#8e92a8",
    "--muxy-surface": "#262837",
    "--muxy-surface-solid": "#262837",
    "--muxy-border": "#33364a",
    "--muxy-hover": "#2d3042",
    "--muxy-accent": "#7aa2f7",
    "--muxy-accent-foreground": "#1e1f29",
    "--muxy-accent-soft": "#2c3550",
    "--muxy-diff-add": "#9ece6a",
    "--muxy-diff-remove": "#f7768e",
    "--muxy-diff-hunk": "#7dcfff",
    "--muxy-topbar-height": "32px",
  };
  for (const [name, value] of Object.entries(vars)) document.documentElement.style.setProperty(name, value);
}

export async function load() {
  const raw = await api().storage.get(STORAGE_KEY);
  // First run starts empty — no example snippets.
  return raw == null ? Core.emptyState() : Core.normalize(raw);
}

export async function save(state) {
  await api().storage.set(STORAGE_KEY, Core.normalize(state));
}

export async function listPanes() {
  try {
    return (await api().panes.list()) || [];
  } catch (err) {
    console.warn("[snippets] panes.list failed", err);
    return [];
  }
}

/** target: "focused" or a pane id. Returns the pane or null. */
export async function resolvePane(target) {
  const panes = await listPanes();
  if (target && target !== "focused") {
    const pane = panes.find((p) => p.id === target);
    if (pane) return pane;
  }
  return panes.find((p) => p.isFocused) || null;
}

/**
 * Sends a snippet to a terminal.
 * action: "run" (type + Enter per line) | "insert" (type only) | "tab" (new terminal tab).
 * Throws a user-facing Error when there is nowhere to send.
 */
export async function execute(snippet, values, action, target) {
  const command = Core.fill(snippet.command, values);
  if (action === "tab") {
    await api().tabs.open({ kind: "terminal", command: Core.toTabCommand(command) });
    return { where: "a new terminal tab" };
  }
  const pane = await resolvePane(target);
  if (!pane) {
    throw new Error("No terminal to send to. Click a terminal pane first, or pick one at the bottom of the panel.");
  }
  if (action === "insert") {
    await api().panes.send(pane.id, Core.toInsertText(command));
  } else {
    for (const line of Core.splitLines(command)) await api().panes.send(pane.id, line + "\r");
  }
  return { where: pane.title || "terminal", pane };
}

export async function toast(title, body = "") {
  try {
    if (typeof api().toast === "function") await api().toast({ title, body });
    else if (api().notifications) await api().notifications.notify({ title, body });
  } catch (err) {
    console.warn("[snippets] toast failed", err);
  }
}

export async function confirm(title, message, okLabel = "OK") {
  try {
    const res = await api().dialog.confirm({ title, message, buttons: [okLabel, "Cancel"], default: okLabel, cancel: "Cancel" });
    return res === okLabel;
  } catch {
    return globalThis.confirm(`${title}\n\n${message}`);
  }
}

export function onFocus(fn) {
  try {
    if (typeof api().onFocus === "function") return api().onFocus(fn);
  } catch {
    /* fall through */
  }
  globalThis.addEventListener("focus", fn);
}

/**
 * Muxy's native searchable picker. Resolves to the chosen item or null.
 * Pages get a Promise back; scripts return right away and report through onSelect.
 */
export function pick(options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (item) => {
      if (settled) return;
      settled = true;
      resolve(item ?? null);
    };
    const result = api().modal.open({ ...options, onSelect: finish });
    if (result && typeof result.then === "function") result.then(finish, () => finish(null));
  });
}

/** Native text prompt. Resolves to the text, or null when cancelled. */
export async function prompt(options) {
  return (await api().dialog.prompt(options)) ?? null;
}
