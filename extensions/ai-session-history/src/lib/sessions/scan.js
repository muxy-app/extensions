import { oneLine, isSafeSessionId } from "../sanitize.js";
import {
  createHostFs,
  ensureHostTools,
  resetHostToolsProbe,
  hasSqlite3,
  chain,
} from "../host-fs.js";
import { listSessionsJs } from "./scan/index.js";
import { toPromise } from "./scan/helpers.js";

function normalizeSession(raw, cli) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id;
  if (!isSafeSessionId(id)) return null;
  return {
    id,
    title: oneLine(raw.title) || "(untitled)",
    updatedAt: Number(raw.updatedAt) || 0,
    branch: typeof raw.branch === "string" ? raw.branch : null,
    cwd: typeof raw.cwd === "string" && raw.cwd ? raw.cwd : null,
    cli,
  };
}

/** @type {boolean | null} */
let sqliteAvailableCache = null;

export function resetSqliteProbe() {
  sqliteAvailableCache = null;
}

/**
 * Probe host for required tools once per panel lifetime.
 * @param {Function} exec
 */
export async function ensureHostToolsReady(exec) {
  return Boolean(await toPromise(ensureHostTools(exec)));
}

export { resetHostToolsProbe };

/**
 * Probe (and cache) whether /usr/bin/sqlite3 is available.
 * @param {Function} exec
 * @returns {Promise<boolean>}
 */
export async function resolveSqliteAvailable(exec) {
  if (sqliteAvailableCache != null) return sqliteAvailableCache;
  try {
    sqliteAvailableCache = Boolean(await toPromise(hasSqlite3(exec)));
  } catch {
    sqliteAvailableCache = false;
  }
  return sqliteAvailableCache;
}

/**
 * List sessions for one CLI + cwd via pure JS scanners + host-fs.
 * @param {string} cli
 * @param {string} cwd
 * @param {{
 *   exec?: Function,
 *   fs?: object,
 *   home?: string,
 *   sqliteAvailable?: boolean,
 *   claudeConfigDir?: string | null,
 *   codexHome?: string | null,
 *   copilotHome?: string | null,
 * }} [opts]
 */
export async function listSessionsForCli(cli, cwd, opts = {}) {
  const exec = opts.exec ?? ((argv, options) => muxy.exec(argv, options));
  const fs = opts.fs ?? createHostFs(exec);
  const sqliteAvailable =
    opts.sqliteAvailable !== undefined
      ? Boolean(opts.sqliteAvailable)
      : await resolveSqliteAvailable(exec);
  try {
    // listSessionsJs is chain-based: plain array (sync exec) or Promise (async exec).
    const rows = await toPromise(
      listSessionsJs(fs, cli, cwd, {
        sqliteAvailable,
        home: opts.home,
        claudeConfigDir: opts.claudeConfigDir,
        codexHome: opts.codexHome,
        copilotHome: opts.copilotHome,
      }),
    );
    return (rows || [])
      .map((item) => normalizeSession(item, cli))
      .filter(Boolean);
  } catch (err) {
    // Soft-fail message for sqlite-dependent CLIs
    if (
      (cli === "codex" || cli === "copilot" || cli === "opencode") &&
      !sqliteAvailable &&
      /sqlite/i.test(String(err?.message || err))
    ) {
      throw new Error(
        `${cli}: /usr/bin/sqlite3 is required to read session stores on this host`,
      );
    }
    throw err;
  }
}

/**
 * Synchronous variant for runScript (sync muxy.exec → plain arrays).
 * Prefer the resume-picker IIFE; this is for tests / advanced callers.
 *
 * **Important:** always returns a plain `Array` — never a Promise.
 * If the underlying exec function returns Promises (async exec), this
 * function throws immediately; use {@link listSessionsForCli} instead.
 *
 * @param {string} cli
 * @param {string} cwd
 * @param {Function | { exec?: Function, fs?: object, home?: string, sqliteAvailable?: boolean }} [execOrOpts]
 * @returns {Array}
 * @throws {Error} when exec is async and resolves to a Promise
 */
export function listSessionsForCliSync(cli, cwd, execOrOpts = muxy.exec) {
  const opts =
    typeof execOrOpts === "function" ? { exec: execOrOpts } : execOrOpts ?? {};
  const exec = opts.exec ?? muxy.exec;
  const fs = opts.fs ?? createHostFs(exec);
  const sqliteAvailable =
    opts.sqliteAvailable !== undefined ? Boolean(opts.sqliteAvailable) : true;
  const rows = listSessionsJs(fs, cli, cwd, {
    sqliteAvailable,
    home: opts.home,
    claudeConfigDir: opts.claudeConfigDir,
    codexHome: opts.codexHome,
    copilotHome: opts.copilotHome,
  });
  if (rows != null && typeof rows.then === "function") {
    throw new Error(
      "listSessionsForCliSync: exec returned Promises; use listSessionsForCli",
    );
  }
  return (rows || [])
    .map((item) => normalizeSession(item, cli))
    .filter(Boolean);
}

// re-export chain for tests
export { chain };
