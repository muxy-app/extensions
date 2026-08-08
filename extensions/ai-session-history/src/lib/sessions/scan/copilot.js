import { joinPath, chain, sqlQuote, expandUserPath } from "../../host-fs.js";
import { isSafeSessionId, isCopilotStubId } from "../../sanitize.js";
import {
  COPILOT_MAX_STATE_DIRS,
  isoToMs,
  sessionRow,
  parseSimpleYaml,
  pathMatchesCwd,
  normPath,
  firstUserMessageFromEvents,
  pickDisplayTitle,
  resolveTitleLikeColumn,
  mapSeq,
  tryChain,
} from "./helpers.js";

/**
 * Soft warning when sqlite3 is missing but session-state dirs exist.
 * Turns-only sessions need the DB; residual FS still lists events-backed ones.
 * Attached as `rows.softError` on the list result (non-element property).
 */
export const COPILOT_SQLITE_SOFT_ERROR =
  "Install sqlite3 to list turns-only Copilot sessions";

/** Path-like columns allowed after PRAGMA discovery (never free-form SQL). */
const PATH_COL_CANDIDATES = [
  "cwd",
  "path",
  "workspace_path",
  "workspacePath",
  "directory",
  "workspace",
];

const UPDATED_COL_CANDIDATES = [
  "updated_at",
  "updatedAt",
  "updated_at_ms",
  "last_active_at",
  "created_at",
  "mtime",
];

/** Session row primary key preference (sessions / workspaces tables). */
const SESSION_SID_COL_CANDIDATES = ["id", "session_id", "sessionId"];
/** Turn/event rows: prefer session_id over local row id. */
const TURN_SID_COL_CANDIDATES = ["session_id", "sessionId", "id"];

/**
 * @param {*} fs
 * @param {{ home?: string, copilotHome?: string | null }} [opts]
 */
function resolveCopilotHome(fs, opts = {}) {
  if (opts.copilotHome) return opts.copilotHome;
  return chain(fs.env("COPILOT_HOME"), (envHome) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (envHome) {
      return chain(homeP, (home) => expandUserPath(envHome, home) || envHome);
    }
    return chain(homeP, (home) => joinPath(home, ".copilot"));
  });
}

/**
 * Session ids with at least one turn row.
 * @param {*} fs
 * @param {string} home
 * @returns {Set<string> | Promise<Set<string>>}
 */
function loadCopilotTurnIds(fs, home) {
  const found = new Set();
  const dbNames = ["session-store.db", "data.db"];
  return chain(
    mapSeq(dbNames, (dbName) => {
      const dbPath = joinPath(home, dbName);
      return chain(fs.isFile(dbPath), (isFile) => {
        if (!isFile) return null;
        return chain(tryChain(() => fs.sqliteTables(dbPath), null), (tables) => {
          if (!tables || !tables.has("turns")) return null;
          return chain(
            tryChain(() => fs.sqliteTableColumns(dbPath, "turns"), null),
            (cols) => {
              if (!cols) return null;
              const sidCol = TURN_SID_COL_CANDIDATES.find((c) => cols.has(c));
              if (!sidCol) return null;
              return chain(
                tryChain(
                  () =>
                    fs.sqliteQuery(
                      dbPath,
                      `SELECT DISTINCT ${sidCol} AS sid FROM turns WHERE ${sidCol} IS NOT NULL`,
                    ),
                  [],
                ),
                (rows) => {
                  for (const r of rows || []) {
                    if (typeof r.sid === "string" && r.sid) found.add(r.sid);
                  }
                  return null;
                },
              );
            },
          );
        });
      });
    }),
    () => found,
  );
}

function mergeCopilotSession(store, sid, fields) {
  if (!isSafeSessionId(sid)) return;
  const entry = store[sid] ?? {
    db_title: null,
    yaml_name: null,
    meta_title: null,
    first_user: null,
    cwd: null,
    branch: null,
    updated: 0,
    resumable: false,
  };
  if (fields.db_title != null && entry.db_title == null) entry.db_title = fields.db_title;
  if (fields.yaml_name != null && entry.yaml_name == null) entry.yaml_name = fields.yaml_name;
  if (fields.meta_title != null && entry.meta_title == null) {
    entry.meta_title = fields.meta_title;
  }
  if (fields.first_user != null && entry.first_user == null) {
    entry.first_user = fields.first_user;
  }
  if (fields.cwd_val && !entry.cwd) entry.cwd = fields.cwd_val;
  if (fields.branch && !entry.branch) entry.branch = fields.branch;
  if (fields.updated && fields.updated > (entry.updated || 0)) {
    entry.updated = fields.updated;
  }
  if (fields.resumable) entry.resumable = true;
  store[sid] = entry;
}

/**
 * Collect session ids for a cwd from allowlisted path columns in sessions/workspaces.
 * DB is an index only — callers must re-check cwd on the FS.
 * @param {*} fs
 * @param {string} home
 * @param {string} cwd
 * @returns {Set<string> | Promise<Set<string>>}
 */
function discoverCopilotSidsForCwd(fs, home, cwd) {
  /** @type {Set<string>} */
  const found = new Set();
  const cwdNorm = normPath(cwd);
  if (!cwdNorm) return found;

  const dbNames = ["session-store.db", "data.db"];
  // Match common path spellings (DB is an index only; FS re-checks with normPath).
  const cwdForms = new Set([cwdNorm, String(cwd)]);
  if (cwdNorm && cwdNorm !== "/") cwdForms.add(`${cwdNorm}/`);
  const cwdLits = new Set([...cwdForms].map((p) => sqlQuote(p)));

  return chain(
    mapSeq(dbNames, (dbName) => {
      const dbPath = joinPath(home, dbName);
      return chain(fs.isFile(dbPath), (isFile) => {
        if (!isFile) return null;
        return chain(tryChain(() => fs.sqliteTables(dbPath), null), (tables) => {
          if (!tables) return null;

          const loadTable = (table) => {
            if (!tables.has(table)) return null;
            return chain(
              tryChain(() => fs.sqliteTableColumns(dbPath, table), null),
              (cols) => {
                if (!cols) return null;
                // sessions: prefer id; workspaces: prefer session_id over local row id.
                const sidPrefs =
                  table === "workspaces"
                    ? TURN_SID_COL_CANDIDATES
                    : SESSION_SID_COL_CANDIDATES;
                const sidCol = sidPrefs.find((c) => cols.has(c));
                const pathCol = PATH_COL_CANDIDATES.find((c) => cols.has(c));
                if (!sidCol || !pathCol) return null;
                // Column names only from PRAGMA allowlist; values via sqlQuote.
                const pathPred = [...cwdLits]
                  .map((lit) => `${pathCol} = ${lit}`)
                  .join(" OR ");
                const sql =
                  `SELECT DISTINCT ${sidCol} AS sid FROM ${table} ` +
                  `WHERE ${sidCol} IS NOT NULL AND (${pathPred})`;
                return chain(
                  tryChain(() => fs.sqliteQuery(dbPath, sql), []),
                  (rows) => {
                    for (const r of rows || []) {
                      if (typeof r.sid === "string" && r.sid) found.add(r.sid);
                    }
                    return null;
                  },
                );
              },
            );
          };

          return chain(loadTable("sessions"), () => loadTable("workspaces"));
        });
      });
    }),
    () => found,
  );
}

/**
 * Enrich titles from data.db / session-store.db for already-resumable sessions.
 * @param {*} fs
 * @param {string} home
 * @param {Record<string, any>} store
 */
function readCopilotDataDb(fs, home, store) {
  const dbNames = ["data.db", "session-store.db"];
  return mapSeq(dbNames, (dbName) => {
    const dbPath = joinPath(home, dbName);
    return chain(fs.isFile(dbPath), (isFile) => {
      if (!isFile) return null;
      return chain(tryChain(() => fs.sqliteTables(dbPath), null), (tables) => {
        if (!tables) return null;

        if (tables.has("sessions")) {
          return chain(
            tryChain(() => fs.sqliteTableColumns(dbPath, "sessions"), null),
            (scols) => {
              if (!scols || !scols.has("id")) {
                return readFallbackTables(fs, dbPath, tables, store);
              }
              const titleExpr = resolveTitleLikeColumn(scols) || "NULL";
              const updatedExpr =
                [
                  "updated_at",
                  "updatedAt",
                  "updated_at_ms",
                  "last_active_at",
                  "created_at",
                ].find((c) => scols.has(c)) || "NULL";
              const sessPathCol = PATH_COL_CANDIDATES.find((c) => scols.has(c));
              const sessBranchCol = ["branch", "git_branch"].find((c) => scols.has(c));

              /** @type {Record<string, [string|null, string|null]>} */
              const wsBySid = {};

              const loadWs = tables.has("workspaces")
                ? chain(
                    tryChain(() => fs.sqliteTableColumns(dbPath, "workspaces"), null),
                    (wcols) => {
                      if (!wcols) return null;
                      const sidCol = TURN_SID_COL_CANDIDATES.find((c) =>
                        wcols.has(c),
                      );
                      const pathCol = PATH_COL_CANDIDATES.find((c) => wcols.has(c));
                      const branchCol = ["branch", "git_branch"].find((c) =>
                        wcols.has(c),
                      );
                      if (!sidCol) return null;
                      const sel = [
                        `${sidCol} AS sid`,
                        pathCol ? `${pathCol} AS wpath` : "NULL AS wpath",
                        branchCol ? `${branchCol} AS wbranch` : "NULL AS wbranch",
                      ];
                      return chain(
                        tryChain(
                          () =>
                            fs.sqliteQuery(
                              dbPath,
                              `SELECT ${sel.join(", ")} FROM workspaces LIMIT 500`,
                            ),
                          [],
                        ),
                        (wrows) => {
                          for (const w of wrows || []) {
                            if (typeof w.sid === "string") {
                              wsBySid[w.sid] = [
                                typeof w.wpath === "string" ? w.wpath : null,
                                typeof w.wbranch === "string" ? w.wbranch : null,
                              ];
                            }
                          }
                          return null;
                        },
                      );
                    },
                  )
                : null;

              return chain(loadWs, () => {
                const sql =
                  `SELECT id AS sid, ${titleExpr} AS title, ${updatedExpr} AS updated, ` +
                  `${sessPathCol ? `${sessPathCol} AS sess_path` : "NULL AS sess_path"}, ` +
                  `${sessBranchCol ? `${sessBranchCol} AS sess_branch` : "NULL AS sess_branch"} ` +
                  `FROM sessions ORDER BY rowid DESC LIMIT 300`;
                return chain(
                  tryChain(() => fs.sqliteQuery(dbPath, sql), []),
                  (srows) => {
                    for (const row of srows || []) {
                      const sid = row.sid;
                      if (typeof sid !== "string" || !(sid in store)) continue;
                      const [wpath, wbranch] = wsBySid[sid] || [null, null];
                      const pathVal =
                        wpath ||
                        (typeof row.sess_path === "string" ? row.sess_path : null);
                      const branchVal =
                        wbranch ||
                        (typeof row.sess_branch === "string" ? row.sess_branch : null);
                      mergeCopilotSession(store, sid, {
                        db_title: row.title,
                        cwd_val: pathVal,
                        branch: branchVal,
                        updated: isoToMs(row.updated) || 0,
                        resumable: false,
                      });
                    }
                    return null;
                  },
                );
              });
            },
          );
        }

        return readFallbackTables(fs, dbPath, tables, store);
      });
    });
  });
}

/**
 * @param {*} fs
 * @param {string} dbPath
 * @param {Set<string>} tables
 * @param {Record<string, any>} store
 */
function readFallbackTables(fs, dbPath, tables, store) {
  const tableList = ["session", "session_docs", "chronicle", "sessions"];
  return mapSeq(tableList, (table) => {
    if (!tables.has(table)) return null;
    return chain(
      tryChain(() => fs.sqliteTableColumns(dbPath, table), null),
      (cols) => {
        if (!cols) return null;
        const idCol = SESSION_SID_COL_CANDIDATES.find((c) => cols.has(c));
        if (!idCol) return null;
        const titleCol = resolveTitleLikeColumn(cols);
        const updatedCol = UPDATED_COL_CANDIDATES.find((c) => cols.has(c));
        const pathCol = PATH_COL_CANDIDATES.find((c) => cols.has(c));
        const sql =
          `SELECT ${idCol} AS sid, ` +
          `${titleCol ? `${titleCol} AS title` : "NULL AS title"}, ` +
          `${updatedCol ? `${updatedCol} AS updated` : "NULL AS updated"}, ` +
          `${pathCol ? `${pathCol} AS path_val` : "NULL AS path_val"} ` +
          `FROM ${table} ORDER BY rowid DESC LIMIT 200`;
        return chain(tryChain(() => fs.sqliteQuery(dbPath, sql), []), (rows) => {
          for (const row of rows || []) {
            if (typeof row.sid !== "string" || !row.sid || !(row.sid in store)) continue;
            mergeCopilotSession(store, row.sid, {
              db_title: row.title,
              cwd_val: typeof row.path_val === "string" ? row.path_val : null,
              updated: isoToMs(row.updated) || 0,
              resumable: false,
            });
          }
          return null;
        });
      },
    );
  });
}

/**
 * Build the FS probe set: DB-indexed sids present under session-state, plus a
 * residual mtime wave over unprobed dirs (budget = COPILOT_MAX_STATE_DIRS).
 * Never uses global mtime top-N as the sole admission gate before cwd match.
 *
 * @param {Array<{ name: string, kind?: string, mtimeMs?: number }>} stateEntries
 * @param {Set<string>} dbSids
 * @returns {Array<{ name: string, kind?: string, mtimeMs?: number }>}
 */
function buildCopilotProbeEntries(stateEntries, dbSids) {
  /** @type {Map<string, { name: string, kind?: string, mtimeMs?: number }>} */
  const byName = new Map();
  for (const e of stateEntries || []) {
    if (!e || e.kind !== "dir") continue;
    const name = e.name;
    if (!isSafeSessionId(name) || isCopilotStubId(name)) continue;
    byName.set(name, e);
  }

  /** @type {Array<{ name: string, kind?: string, mtimeMs?: number }>} */
  const probe = [];
  /** @type {Set<string>} */
  const selected = new Set();

  // 1) DB candidates that still have a session-state dir.
  for (const sid of dbSids || []) {
    const entry = byName.get(sid);
    if (!entry || selected.has(sid)) continue;
    selected.add(sid);
    probe.push(entry);
  }

  // 2) Residual: newest unprobed dirs first. Full budget when no DB index hits
  // (sqlite off / no path columns); smaller residual when DB already selected
  // candidates so multi-project foreign flood stays cheap (#31 spirit).
  const residual = [...byName.values()]
    .filter((e) => !selected.has(e.name))
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const residualBudget =
    selected.size > 0
      ? Math.min(20, COPILOT_MAX_STATE_DIRS)
      : Math.max(0, COPILOT_MAX_STATE_DIRS);
  for (let i = 0; i < residual.length && i < residualBudget; i++) {
    probe.push(residual[i]);
  }

  return probe;
}

/**
 * Probe one session-state dir for cwd match + resume evidence.
 * @param {*} fs
 * @param {string} state
 * @param {{ name: string, mtimeMs?: number }} entry
 * @param {string} cwd
 * @param {Set<string>} turnIds
 * @param {Record<string, any>} store
 */
function probeCopilotStateDir(fs, state, entry, cwd, turnIds, store) {
  const sid = entry.name;
  const child = joinPath(state, sid);
  const wsPath = joinPath(child, "workspace.yaml");
  const metaPath = joinPath(child, "meta.json");
  const eventsPath = joinPath(child, "events.jsonl");

  // One listDirDetailed for events size (avoids dual-stat fileSize) + capped heads.
  return chain(tryChain(() => fs.listDirDetailed(child), []), (childEntries) => {
    const byName = new Map((childEntries || []).map((e) => [e.name, e]));
    const eventsMeta = byName.get("events.jsonl");
    // When size is unknown (null), still treat a file-kind entry as present.
    const eventsLikely =
      eventsMeta &&
      eventsMeta.kind === "file" &&
      (eventsMeta.size == null || eventsMeta.size > 0);
    const hasTurns = turnIds.has(sid);

    // Cheap admission: need turns or an events file before reading yaml/meta.
    if (!eventsLikely && !hasTurns) return null;

    const yamlP = byName.has("workspace.yaml")
      ? tryChain(() => fs.readHead(wsPath, { maxBytes: 64_000 }), null)
      : null;
    const metaP = byName.has("meta.json")
      ? tryChain(() => fs.readHead(metaPath, { maxBytes: 64_000 }), null)
      : null;

    return chain(yamlP, (yamlText) => {
      let sessionCwd = null;
      let branch = null;
      let yamlName = null;
      if (yamlText) {
        try {
          const yamlData = parseSimpleYaml(yamlText);
          sessionCwd = yamlData.cwd || yamlData.path || null;
          branch = yamlData.branch || yamlData.git_branch || null;
          yamlName = yamlData.name || yamlData.title || null;
        } catch {
          /* ignore */
        }
      }

      return chain(metaP, (metaText) => {
        let metaTitle = null;
        if (metaText) {
          try {
            const data = JSON.parse(metaText);
            if (data && typeof data === "object") {
              metaTitle = data.title || data.name || null;
              if (!sessionCwd && typeof data.cwd === "string") {
                sessionCwd = data.cwd;
              }
              if (!branch && typeof data.branch === "string") {
                branch = data.branch;
              }
            }
          } catch {
            /* ignore */
          }
        }

        // FS re-check: DB path columns are an index only.
        if (!sessionCwd || !pathMatchesCwd(sessionCwd, cwd)) return null;

        const sizeKnown = eventsMeta?.size;
        const hasEventsFinal =
          eventsMeta?.kind === "file" &&
          (sizeKnown == null ? true : sizeKnown > 0);
        if (!hasEventsFinal && !hasTurns) return null;

        const firstUserP = hasEventsFinal
          ? chain(
              tryChain(() => fs.readHead(eventsPath, { maxBytes: 256_000 }), null),
              (head) => (head != null ? firstUserMessageFromEvents(head) : null),
            )
          : null;

        return chain(firstUserP, (firstUser) => {
          const updated = entry.mtimeMs || 0;
          mergeCopilotSession(store, sid, {
            yaml_name: yamlName,
            meta_title: metaTitle,
            first_user: firstUser,
            cwd_val: sessionCwd,
            branch,
            updated,
            resumable: true,
          });
          return null;
        });
      });
    });
  });
}

/**
 * List CLI-resumable Copilot sessions for the active worktree.
 * Returns **all** resumable sessions for cwd (newest first), not capped at 25.
 * Discovery is cwd-complete via DB index + residual FS budget — never global
 * mtime top-N as the sole gate before cwd match.
 *
 * Returns plain array when fs is sync; Promise when exec is async.
 *
 * When `sqliteAvailable === false` and session-state dirs exist, the array may
 * carry a non-index property `softError` ({@link COPILOT_SQLITE_SOFT_ERROR}).
 * Callers must read it before `map`/`filter`/`slice` (those drop non-element props).
 *
 * @param {*} fs
 * @param {string} cwd
 * @param {{ home?: string, copilotHome?: string | null, sqliteAvailable?: boolean }} [opts]
 * @returns {Array | Promise<Array>} session rows; optional `softError` string property
 */
export function listCopilot(fs, cwd, opts = {}) {
  return chain(resolveCopilotHome(fs, opts), (home) => {
    /** @type {Record<string, any>} */
    const store = {};

    const turnIdsP =
      opts.sqliteAvailable === false
        ? new Set()
        : tryChain(() => loadCopilotTurnIds(fs, home), new Set());

    return chain(turnIdsP, (turnIds) => {
      const state = joinPath(home, "session-state");
      return chain(tryChain(() => fs.listDirDetailed(state), []), (stateEntries) => {
        const hasStateDirs = (stateEntries || []).some(
          (e) => e && e.kind === "dir" && isSafeSessionId(e.name),
        );
        const dbSidsP =
          opts.sqliteAvailable === false
            ? new Set()
            : tryChain(() => discoverCopilotSidsForCwd(fs, home, cwd), new Set());

        return chain(dbSidsP, (dbSids) => {
          const children = buildCopilotProbeEntries(stateEntries, dbSids || new Set());

          return chain(
            mapSeq(children, (entry) =>
              probeCopilotStateDir(fs, state, entry, cwd, turnIds, store),
            ),
            () => {
              const enrichP =
                opts.sqliteAvailable === false
                  ? null
                  : tryChain(() => readCopilotDataDb(fs, home, store), null);

              return chain(enrichP, () => {
                const out = [];
                for (const [sid, meta] of Object.entries(store)) {
                  if (!meta.resumable) continue;
                  const title = pickDisplayTitle(sid, {
                    db_title: meta.db_title,
                    yaml_name: meta.yaml_name,
                    meta_title: meta.meta_title,
                    first_user: meta.first_user,
                    cwd: meta.cwd,
                    branch: meta.branch,
                  });
                  out.push(
                    sessionRow(
                      "copilot",
                      sid,
                      title,
                      Math.trunc(meta.updated || 0),
                      meta.branch,
                      meta.cwd,
                    ),
                  );
                }
                out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                // Project-complete: no silent PER_GROUP_CAP for Copilot.
                // Soft-error (not throw): keep residual FS sessions, warn about turns-only.
                if (opts.sqliteAvailable === false && hasStateDirs) {
                  out.softError = COPILOT_SQLITE_SOFT_ERROR;
                }
                return out;
              });
            },
          );
        });
      });
    });
  });
}

export {
  resolveCopilotHome,
  loadCopilotTurnIds,
  discoverCopilotSidsForCwd,
  buildCopilotProbeEntries,
};
