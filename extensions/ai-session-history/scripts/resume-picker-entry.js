/**
 * Palette command entry: multi-provider session resume modal.
 * Built to a single IIFE via esbuild (see copy-manifest.mjs).
 *
 * runScript context — muxy.* is synchronous (no await). Scanners are chain-based
 * so host-fs + sync muxy.exec returns plain arrays. Stream rows via modal items(emit).
 */

import { createHostFs, ensureHostTools, hasSqlite3 } from "../src/lib/host-fs.js";
import { listSessionsJs } from "../src/lib/sessions/scan/index.js";
import { isSafeSessionId } from "../src/lib/sanitize.js";

const PROVIDERS = [
  { id: "grok", displayName: "Grok", binaries: ["grok"] },
  { id: "claude", displayName: "Claude", binaries: ["claude"] },
  { id: "codex", displayName: "Codex", binaries: ["codex"] },
  { id: "copilot", displayName: "Copilot", binaries: ["copilot"] },
  { id: "cursor", displayName: "Cursor", binaries: ["cursor-agent", "cursor"] },
  { id: "opencode", displayName: "OpenCode", binaries: ["opencode"] },
];

const RESUME = {
  grok: (id) => "grok --resume " + shellQuote(id),
  claude: (id) => "claude --resume " + shellQuote(id),
  codex: (id) => "codex resume " + shellQuote(id),
  copilot: (id) => "copilot --resume=" + shellQuote(id),
  cursor: (id) => "cursor-agent --resume " + shellQuote(id),
  opencode: (id) => "opencode --session " + shellQuote(id),
};

/** Soft cap for non–cwd-complete providers in the multi-CLI palette. */
const GLOBAL_CAP = 80;
/** Providers that must stream the full project-scoped list (no room slice). */
const UNCAPPED_PROVIDERS = { copilot: true };

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function relativeTime(ms) {
  if (!ms) return "";
  const delta = Date.now() - ms;
  if (delta < 0) return "just now";
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 48) return hr + "h ago";
  const day = Math.floor(hr / 24);
  if (day < 30) return day + "d ago";
  return Math.floor(day / 30) + "mo ago";
}

function notify(body) {
  try {
    muxy.notifications.notify({ title: "AI Sessions", body: body });
  } catch (e) {
    /* ignore */
  }
}

function activeCwd() {
  try {
    const worktrees = muxy.worktrees.list();
    const wt = worktrees.find(function (w) {
      return w.isActive;
    });
    if (wt && wt.path) return wt.path;
  } catch (e) {
    /* ignore */
  }
  const projects = muxy.projects.list();
  const active = projects.find(function (p) {
    return p.isActive;
  });
  return active ? active.path : null;
}

function detectInstalled() {
  // One bash -lc probes all candidate binaries (single argvPrefix for consent).
  const allNames = [];
  for (let i = 0; i < PROVIDERS.length; i++) {
    const bins = PROVIDERS[i].binaries;
    for (let j = 0; j < bins.length; j++) {
      if (allNames.indexOf(bins[j]) < 0) allNames.push(bins[j]);
    }
  }
  const list = allNames
    .map(function (n) {
      return "'" + n + "'";
    })
    .join(" ");
  const script =
    "for c in " +
    list +
    '; do p=$(command -v "$c" 2>/dev/null) || continue; printf \'%s=%s\\n\' "$c" "$p"; done';
  /** @type {Record<string, string>} */
  const found = {};
  try {
    const result = muxy.exec(["bash", "-lc", script], { timeoutMs: 8000 });
    const stdout = String(result.stdout || "");
    const lines = stdout.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const path = line.slice(eq + 1).trim();
      if (name && path) found[name] = path;
    }
  } catch (e) {
    /* no CLIs */
  }
  const installed = [];
  for (let i = 0; i < PROVIDERS.length; i++) {
    const provider = PROVIDERS[i];
    for (let j = 0; j < provider.binaries.length; j++) {
      if (found[provider.binaries[j]]) {
        installed.push(provider);
        break;
      }
    }
  }
  return installed;
}

/**
 * Sync scan one CLI. Throws if host-fs unexpectedly returns a Promise.
 * @returns {Array}
 */
function listRowsSync(fs, providerId, cwd, opts) {
  const rows = listSessionsJs(fs, providerId, cwd, opts);
  if (rows != null && typeof rows.then === "function") {
    throw new Error("scan returned Promise in runScript (expected sync host-fs)");
  }
  return rows || [];
}

function main() {
  const cwd = activeCwd();
  if (!cwd) {
    notify("No active project folder");
    return;
  }
  const installed = detectInstalled();
  if (!installed.length) {
    notify("No AI CLIs found on PATH");
    return;
  }

  const exec = function (argv, options) {
    return muxy.exec(argv, options);
  };

  let toolsOk = false;
  try {
    toolsOk = Boolean(ensureHostTools(exec));
  } catch (e) {
    toolsOk = false;
  }
  if (!toolsOk) {
    notify("Host tools (cat, ls, stat, …) are required to read CLI session stores");
    return;
  }

  const fs = createHostFs(exec);
  let home;
  try {
    home = fs.homeDir();
  } catch (e) {
    home = undefined;
  }
  if (home != null && typeof home.then === "function") {
    notify("Host filesystem is async in runScript; cannot list sessions");
    return;
  }

  let sqliteAvailable = true;
  try {
    sqliteAvailable = Boolean(hasSqlite3(exec));
  } catch (e) {
    sqliteAvailable = false;
  }
  if (typeof sqliteAvailable.then === "function") {
    sqliteAvailable = true;
  }

  const scanOpts = { sqliteAvailable: Boolean(sqliteAvailable), home: home };

  muxy.modal.open({
    placeholder: "Resume AI session…",
    emptyLabel: "No resumable sessions for this folder",
    noMatchLabel: "No matches",
    /**
     * Sync producer: scan every installed CLI, stream batches as they finish
     * so the modal fills instead of blocking on the slowest provider (e.g. Copilot).
     */
    items: function (emit) {
      /** @type {string[]} */
      const softErrors = [];
      /** Count of capped (non-uncapped) rows emitted toward GLOBAL_CAP. */
      let cappedTotal = 0;

      for (let i = 0; i < installed.length; i++) {
        const provider = installed[i];
        const uncapped = Boolean(UNCAPPED_PROVIDERS[provider.id]);
        // Skip remaining capped providers once their shared budget is spent;
        // still scan uncapped providers (e.g. full Copilot project list).
        if (!uncapped && cappedTotal >= GLOBAL_CAP) continue;
        try {
          const rows = listRowsSync(fs, provider.id, cwd, scanOpts);
          /** @type {Array<{ id: string, title: string, subtitle: string, _updatedAt: number }>} */
          const batch = [];
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            if (!row || !isSafeSessionId(row.id)) continue;
            batch.push({
              id: provider.id + ":" + row.id,
              title: String(row.title || "(untitled)")
                .replace(/\s+/g, " ")
                .slice(0, 120),
              subtitle: [
                provider.displayName,
                relativeTime(Number(row.updatedAt) || 0),
                row.branch || "",
              ]
                .filter(Boolean)
                .join(" · "),
              _updatedAt: Number(row.updatedAt) || 0,
            });
          }
          // Stream this provider’s rows immediately (newest first within provider).
          if (batch.length) {
            batch.sort(function (a, b) {
              return (b._updatedAt || 0) - (a._updatedAt || 0);
            });
            // Cwd-complete providers (Copilot): emit full project set.
            // Others share GLOBAL_CAP among themselves.
            const slice = uncapped
              ? batch
              : batch.slice(0, Math.max(0, GLOBAL_CAP - cappedTotal));
            if (!uncapped) cappedTotal += slice.length;
            if (slice.length) {
              emit(
                slice.map(function (item) {
                  return {
                    id: item.id,
                    title: item.title,
                    subtitle: item.subtitle,
                  };
                }),
              );
            }
          }
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          softErrors.push(provider.displayName + ": " + msg);
        }
      }

      // Soft-fail visibility: other providers still listed; surface failures.
      if (softErrors.length) {
        notify(
          softErrors.slice(0, 3).join("; ") +
            (softErrors.length > 3 ? "…" : ""),
        );
      }
    },
    onSelect: function (choice) {
      if (!choice) return;
      const parts = String(choice.id).split(":");
      if (parts.length < 2) return;
      const cli = parts[0];
      const sessionId = parts.slice(1).join(":");
      if (!isSafeSessionId(sessionId) || !RESUME[cli]) return;
      muxy.tabs.open({
        kind: "terminal",
        directory: ".",
        command: RESUME[cli](sessionId),
      });
    },
  });
}

// Fully synchronous entry — no floating promises.
try {
  main();
} catch (e) {
  notify(e && e.message ? e.message : String(e));
}
