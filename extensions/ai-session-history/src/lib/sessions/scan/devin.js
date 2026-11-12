import { joinPath, chain, expandUserPath, sqlQuote } from "../../host-fs.js";
import {
  PER_GROUP_CAP,
  normPath,
  sessionRow,
  isoToMs,
} from "./helpers.js";

const DEVIN_ID_RE = /^[0-9a-zA-Z][0-9a-zA-Z._-]{5,127}$/;
/** Cap on message_nodes rows scanned backwards per session for previews. */
const PREVIEW_ROW_LIMIT = 400;
/** SQL-side truncation of message content (chars) to keep exec output small. */
const PREVIEW_CONTENT_CHARS = 500;

/**
 * Resolve the Devin CLI data dir (~/.local/share/devin/cli).
 * Honors XDG_DATA_HOME like other CLIs; opts.dataDir/dbPath win for tests.
 * @param {*} fs
 * @param {{ home?: string, dataDir?: string }} [opts]
 */
export function resolveDevinCliDir(fs, opts = {}) {
  if (opts.dataDir) return opts.dataDir;
  return chain(fs.env("XDG_DATA_HOME"), (xdg) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    return chain(homeP, (home) => {
      if (xdg) {
        const base = expandUserPath(xdg, home) || xdg;
        return joinPath(base, "devin", "cli");
      }
      return joinPath(home, ".local", "share", "devin", "cli");
    });
  });
}

/**
 * @param {*} fs
 * @param {string} cliDir
 */
export function resolveDevinDbPath(fs, cliDir) {
  return joinPath(cliDir, "sessions.db");
}

/**
 * Soft sqlite query: missing table/db → [] instead of throwing.
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
 * Soft sqlite query returning null on ANY failure — previews are best-effort.
 * @param {*} fs
 * @param {string} dbPath
 * @param {string} sql
 */
function sqliteQueryOrNull(fs, dbPath, sql) {
  try {
    const v = sqliteQuerySoft(fs, dbPath, sql);
    const fallback = (err) => {
      const msg = String(err?.message || err);
      if (/no such table|unable to open/i.test(msg)) return [];
      return null;
    };
    if (v != null && typeof v.then === "function") {
      return v.then((rows) => rows, fallback);
    }
    return v;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/no such table|unable to open/i.test(msg)) return [];
    return null;
  }
}

/**
 * Extract last user prompt + last assistant reply previews from
 * pre-projected message_nodes rows (newest first). Rows may carry either
 * { role, content, created_at } (JSON1 projection) or a raw chat_message blob.
 * @param {Array<{ role?: string, content?: string, chat_message?: string, created_at?: number }>} rows
 * @returns {{ lastUser: { text: string, at: number } | null, lastAssistant: { text: string, at: number } | null }}
 */
export function devinPreviewsFromRows(rows) {
  let lastUser = null;
  let lastAssistant = null;
  for (const r of rows || []) {
    if (lastUser && lastAssistant) break;
    if (!r || typeof r !== "object") continue;
    let role = typeof r.role === "string" ? r.role.toLowerCase() : "";
    let content = typeof r.content === "string" ? r.content : "";
    if (!role || !content) {
      // Fallback shape: parse the raw chat_message JSON blob.
      if (typeof r.chat_message !== "string") continue;
      let rec;
      try {
        rec = JSON.parse(r.chat_message);
      } catch {
        continue;
      }
      if (!rec || typeof rec !== "object") continue;
      role = String(rec.role || "").toLowerCase();
      content = typeof rec.content === "string" ? rec.content : "";
    }
    if (!content.trim()) continue;
    const at = isoToMs(r.created_at) || 0;
    const text = content.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!text) continue;
    if (role === "user" && !lastUser) {
      lastUser = { text, at };
    } else if (role === "assistant" && !lastAssistant) {
      lastAssistant = { text, at };
    }
  }
  return { lastUser, lastAssistant };
}

/**
 * List Devin sessions for cwd from sessions.db.
 * Returns plain array when fs is sync; Promise when exec is async.
 * @param {*} fs
 * @param {string} cwd
 * @param {{ home?: string, dataDir?: string, dbPath?: string, sqliteAvailable?: boolean }} [opts]
 */
export function listDevin(fs, cwd, opts = {}) {
  if (opts.sqliteAvailable === false) {
    throw new Error(
      "devin: /usr/bin/sqlite3 is required to read session stores on this host",
    );
  }

  return chain(resolveDevinCliDir(fs, opts), (cliDir) => {
    const dbPathP =
      opts.dbPath != null ? opts.dbPath : resolveDevinDbPath(fs, cliDir);

    return chain(dbPathP, (dbPath) => {
      if (!dbPath) return [];
      return chain(fs.isFile(dbPath), (ok) => {
        if (!ok) return [];

        const sql =
          `SELECT id, title, working_directory, last_activity_at ` +
          `FROM sessions WHERE COALESCE(hidden, 0) = 0 ` +
          `ORDER BY last_activity_at DESC LIMIT 300`;

        return chain(sqliteQuerySoft(fs, dbPath, sql), (rows) => {
          const target = normPath(cwd);
          const matched = [];
          for (const r of rows || []) {
            const sid = r.id;
            if (typeof sid !== "string" || !DEVIN_ID_RE.test(sid)) continue;
            const dir = typeof r.working_directory === "string" ? r.working_directory : "";
            if (!dir || normPath(dir) !== target) continue;
            matched.push(r);
            if (matched.length >= PER_GROUP_CAP) break;
          }
          if (!matched.length) return [];

          // Enrich each session with last user/assistant previews.
          // JSON1 projection keeps exec output tiny (raw chat_message blobs
          // can be hundreds of KB each).
          const enrichOne = (r) => {
            const sid = r.id;
            const q =
              `SELECT json_extract(chat_message, '$.role') AS role, ` +
              `substr(COALESCE(json_extract(chat_message, '$.content'), ''), 1, ${PREVIEW_CONTENT_CHARS}) AS content, ` +
              `created_at FROM message_nodes ` +
              `WHERE session_id = ${sqlQuote(sid)} ` +
              `ORDER BY row_id DESC LIMIT ${PREVIEW_ROW_LIMIT}`;
            return chain(sqliteQueryOrNull(fs, dbPath, q), (mrows) => {
              const { lastUser, lastAssistant } = devinPreviewsFromRows(mrows);
              const title =
                typeof r.title === "string" && r.title.trim() ? r.title : "(untitled)";
              const updated = isoToMs(r.last_activity_at) || 0;
              return sessionRow("devin", sid, title, updated, null, r.working_directory, {
                lastUser,
                lastAssistant,
              });
            });
          };

          // Sequential chain keeps sync exec returning a plain array.
          const out = [];
          let idx = 0;
          const step = () => {
            if (idx >= matched.length) return out;
            const r = matched[idx++];
            return chain(enrichOne(r), (row) => {
              out.push(row);
              return step();
            });
          };
          return step();
        });
      });
    });
  });
}
