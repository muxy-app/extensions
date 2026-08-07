import { joinPath, chain, expandUserPath } from "../../host-fs.js";
import {
  PER_GROUP_CAP,
  normPath,
  sessionRow,
  tryChain,
  isoToMs,
} from "./helpers.js";

const SES_ID_RE = /^ses_[0-9a-zA-Z._-]{4,120}$/;

/**
 * Resolve OpenCode data directory (XDG_DATA_HOME/opencode or ~/.local/share/opencode).
 * @param {*} fs
 * @param {{ home?: string, dataDir?: string }} [opts]
 */
export function resolveOpenCodeDataDir(fs, opts = {}) {
  if (opts.dataDir) return opts.dataDir;
  return chain(fs.env("XDG_DATA_HOME"), (xdg) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (xdg) {
      return chain(homeP, (home) => {
        const base = expandUserPath(xdg, home) || xdg;
        return joinPath(base, "opencode");
      });
    }
    return chain(homeP, (home) => joinPath(home, ".local", "share", "opencode"));
  });
}

/**
 * Pick the channel DB under the data dir (prefer opencode.db).
 * @param {*} fs
 * @param {string} dataDir
 * @param {string | null} [openCodeDbEnv]
 */
export function resolveOpenCodeDbPath(fs, dataDir, openCodeDbEnv = null) {
  if (openCodeDbEnv) {
    if (openCodeDbEnv === ":memory:") return null;
    if (openCodeDbEnv.startsWith("/")) return openCodeDbEnv;
    return joinPath(dataDir, openCodeDbEnv);
  }
  const primary = joinPath(dataDir, "opencode.db");
  return chain(fs.isFile(primary), (ok) => {
    if (ok) return primary;
    return chain(tryChain(() => fs.listDir(dataDir), []), (names) => {
      const candidates = (names || [])
        .filter((n) => /^opencode(-[A-Za-z0-9._-]+)?\.db$/.test(n))
        .map((n) => joinPath(dataDir, n));
      return pickFirstFile(fs, candidates, 0);
    });
  });
}

/**
 * @param {*} fs
 * @param {string[]} candidates
 * @param {number} i
 */
function pickFirstFile(fs, candidates, i) {
  if (i >= candidates.length) return null;
  return chain(fs.isFile(candidates[i]), (ok) => {
    if (ok) return candidates[i];
    return pickFirstFile(fs, candidates, i + 1);
  });
}

/**
 * @param {*} fs
 * @param {string} dbPath
 * @param {string} sql
 */
function sqliteQuerySoft(fs, dbPath, sql) {
  try {
    const v = fs.sqliteQuery(dbPath, sql);
    if (v != null && typeof v.then === "function") {
      return v.then(
        (rows) => rows,
        (err) => {
          const msg = String(err?.message || err);
          if (/no such table|unable to open/i.test(msg)) return [];
          throw err;
        },
      );
    }
    return v;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/no such table|unable to open/i.test(msg)) return [];
    throw err;
  }
}

/**
 * List OpenCode sessions for cwd from opencode.db.
 * Returns plain array when fs is sync; Promise when exec is async.
 * @param {*} fs
 * @param {string} cwd
 * @param {{ home?: string, dataDir?: string, dbPath?: string, sqliteAvailable?: boolean }} [opts]
 */
export function listOpenCode(fs, cwd, opts = {}) {
  if (opts.sqliteAvailable === false) {
    throw new Error(
      "opencode: /usr/bin/sqlite3 is required to read session stores on this host",
    );
  }

  return chain(resolveOpenCodeDataDir(fs, opts), (dataDir) => {
    const dbPathP =
      opts.dbPath != null
        ? opts.dbPath
        : chain(fs.env("OPENCODE_DB"), (envDb) =>
            resolveOpenCodeDbPath(fs, dataDir, envDb),
          );

    return chain(dbPathP, (dbPath) => {
      if (!dbPath) return [];

      const sql =
        `SELECT id, title, directory, time_updated, time_archived, parent_id ` +
        `FROM session ` +
        `WHERE (parent_id IS NULL OR parent_id = '') ` +
        `AND (time_archived IS NULL) ` +
        `ORDER BY time_updated DESC LIMIT 200`;

      return chain(sqliteQuerySoft(fs, dbPath, sql), (rows) => {
        const target = normPath(cwd);
        const out = [];
        for (const r of rows || []) {
          const sid = r.id;
          if (typeof sid !== "string" || !SES_ID_RE.test(sid)) continue;
          const dir = typeof r.directory === "string" ? r.directory : "";
          if (!dir || normPath(dir) !== target) continue;
          const title =
            typeof r.title === "string" && r.title.trim() ? r.title : "(untitled)";
          let updated = 0;
          if (typeof r.time_updated === "number") {
            updated = isoToMs(r.time_updated) || Math.trunc(r.time_updated) || 0;
          } else if (r.time_updated != null) {
            updated = isoToMs(r.time_updated) || 0;
          }
          out.push(sessionRow("opencode", sid, title, updated, null, dir));
          if (out.length >= PER_GROUP_CAP) break;
        }
        return out;
      });
    });
  });
}
