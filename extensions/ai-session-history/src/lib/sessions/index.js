import { buildGroups, filterGroups, flattenSessions } from "@/lib/sessions/group";
import { createHostFs } from "@/lib/host-fs";
import {
  ensureHostToolsReady,
  listSessionsForCli,
  resolveSqliteAvailable,
} from "@/lib/sessions/scan";
import { detectInstalled } from "@/lib/sessions/which";
import { providerById } from "@/lib/sessions/providers";
import { toPromise } from "@/lib/sessions/scan/helpers";

const GLOBAL_CAP = 80;
/** Soft per-provider cap for providers that still use PER_GROUP_CAP-style listing. */
const PER_PROVIDER_CAP = 25;
/** Providers that return a cwd-complete list — do not silently re-cap. */
const UNCAPPED_PROVIDERS = new Set(["copilot"]);

/**
 * Load all sessions for installed CLIs at cwd.
 * @param {string} cwd
 * @param {{ exec?: Function, fs?: object, home?: string, sqliteAvailable?: boolean }} [opts]
 * @returns {Promise<{ installed, groups, sessionsByCli, errorsByCli, hostToolsMissing?: boolean }>}
 */
export async function listAll(cwd, opts = {}) {
  const exec = opts.exec ?? ((argv, options) => muxy.exec(argv, options));
  const installed = await detectInstalled();
  const sessionsByCli = {};
  const errorsByCli = {};

  if (!cwd) {
    return { installed, groups: [], sessionsByCli, errorsByCli };
  }

  const hasTools = await ensureHostToolsReady(exec);
  if (!hasTools) {
    return {
      installed,
      groups: [],
      sessionsByCli,
      errorsByCli: {
        _host:
          "Host tools (cat, ls, stat, tee, …) are required to read CLI session stores. Install coreutils/Xcode CLT and refresh.",
      },
      hostToolsMissing: true,
    };
  }

  // One host-fs + home + sqlite probe shared across all CLI scanners.
  const fs = opts.fs ?? createHostFs(exec);
  let home = opts.home;
  if (home == null) {
    try {
      home = await toPromise(fs.homeDir());
    } catch {
      home = undefined;
    }
  }
  const sqliteAvailable =
    opts.sqliteAvailable !== undefined
      ? Boolean(opts.sqliteAvailable)
      : await resolveSqliteAvailable(exec);

  const results = await Promise.allSettled(
    installed.map(async (provider) => {
      const sessions = await listSessionsForCli(provider.id, cwd, {
        exec,
        fs,
        home,
        sqliteAvailable,
      });
      return { id: provider.id, sessions };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const provider = installed[i];
    const result = results[i];
    if (result.status === "fulfilled") {
      const sessions = result.value.sessions;
      // Copilot (and future cwd-complete providers): keep full project set.
      sessionsByCli[provider.id] = UNCAPPED_PROVIDERS.has(provider.id)
        ? sessions
        : sessions.slice(0, PER_PROVIDER_CAP);
    } else {
      sessionsByCli[provider.id] = [];
      errorsByCli[provider.id] =
        result.reason?.message || String(result.reason) || "Failed to load sessions";
    }
  }

  // Soft cap for *non–cwd-complete* providers only (GLOBAL_CAP). Uncapped
  // providers (Copilot) keep the full project set so filter chips and All
  // view never drop them. GLOBAL_CAP is never reduced by uncapped size — so
  // a large Copilot project does not empty Claude/Codex/… chips.
  let groups = buildGroups(installed, sessionsByCli, errorsByCli);
  const otherFlat = flattenSessions(groups)
    .filter((s) => !UNCAPPED_PROVIDERS.has(s.cli))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const otherSlots = GLOBAL_CAP;
  if (otherFlat.length > otherSlots) {
    const keep = new Set(
      otherFlat.slice(0, otherSlots).map((s) => `${s.cli}:${s.id}`),
    );
    for (const g of groups) {
      if (UNCAPPED_PROVIDERS.has(g.cli)) continue;
      g.sessions = g.sessions.filter((s) => keep.has(`${s.cli}:${s.id}`));
    }
    groups = groups.filter((g) => g.sessions.length || g.error);
  }

  return { installed, groups, sessionsByCli, errorsByCli };
}

export { filterGroups, flattenSessions, providerById, detectInstalled };
