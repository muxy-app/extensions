import { joinPath, sqlQuote, chain, expandUserPath } from "../../host-fs.js";
import {
  UUID_RE,
  CODEX_ROLLOUT_RE,
  PER_GROUP_CAP,
  ENRICH_SLACK,
  CODEX_MAX_DIRS_WALKED,
  isoToMs,
  sessionRow,
  mapSeq,
  tryChain,
  normPath,
  pathMatchesCwd,
} from "./helpers.js";

/**
 * cwd forms for SQL equality (DB may store trailing slash / double-slash variants).
 * @param {string} cwd
 * @returns {string[]}
 */
function cwdSqlForms(cwd) {
  const cwdNorm = normPath(cwd);
  const forms = new Set();
  if (cwdNorm) forms.add(cwdNorm);
  if (cwd) forms.add(String(cwd));
  if (cwdNorm && cwdNorm !== "/") forms.add(`${cwdNorm}/`);
  return [...forms].filter(Boolean);
}

/**
 * @param {*} fs
 * @param {{ home?: string, codexHome?: string | null }} [opts]
 */
function resolveCodexHome(fs, opts = {}) {
  if (opts.codexHome) return opts.codexHome;
  return chain(fs.env("CODEX_HOME"), (envHome) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (envHome) {
      return chain(homeP, (home) => expandUserPath(envHome, home) || envHome);
    }
    return chain(homeP, (home) => joinPath(home, ".codex"));
  });
}

/**
 * @param {*} fs
 * @param {string} home
 * @param {string} cwd
 * @returns {Array|null | Promise<Array|null>}
 */
function listCodexDb(fs, home, cwd) {
  return chain(tryChain(() => fs.listDirDetailed(home), null), (entries) => {
    if (!entries) return null;
    const candidates = [];
    for (const e of entries) {
      if (e.kind !== "file") continue;
      const m = /^state_(\d+)\.sqlite$/.exec(e.name);
      if (!m) continue;
      candidates.push({ n: Number(m[1]), path: joinPath(home, e.name) });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.n - a.n);
    const dbPath = candidates[0].path;

    return chain(tryChain(() => fs.sqliteTableColumns(dbPath, "threads"), null), (cols) => {
      if (!cols) return null;
      const required = ["id", "source", "cwd"];
      if (!required.every((c) => cols.has(c))) return null;

      let updatedCol = null;
      if (cols.has("updated_at_ms")) updatedCol = "updated_at_ms";
      else if (cols.has("updated_at")) updatedCol = "updated_at";
      if (!updatedCol) return null;

      const titleCol = cols.has("title") ? "title" : "''";
      const firstCol = cols.has("first_user_message") ? "first_user_message" : "''";
      const branchCol = cols.has("git_branch") ? "git_branch" : "NULL";

      const forms = cwdSqlForms(cwd);
      if (!forms.length) return [];
      const cwdPred = forms.map((p) => `cwd = ${sqlQuote(p)}`).join(" OR ");

      const sql =
        `SELECT id, ${updatedCol} AS updated, ${titleCol} AS title, ` +
        `${firstCol} AS first_user, ${branchCol} AS git_branch, cwd AS row_cwd ` +
        `FROM threads WHERE (${cwdPred}) ` +
        `AND source IN ('cli', 'vscode') ` +
        `ORDER BY ${updatedCol} DESC LIMIT ${PER_GROUP_CAP}`;

      return chain(tryChain(() => fs.sqliteQuery(dbPath, sql), null), (rows) => {
        if (!rows) return null;
        const out = [];
        for (const r of rows) {
          const sid = r.id;
          if (typeof sid !== "string" || !UUID_RE.test(sid)) continue;
          // Re-check with pathMatchesCwd for any residual spelling drift.
          if (r.row_cwd != null && !pathMatchesCwd(String(r.row_cwd), cwd)) continue;
          const rawTitle = r.title;
          const firstUser = r.first_user;
          const title =
            typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : firstUser;
          const updated = isoToMs(r.updated) || 0;
          const git = typeof r.git_branch === "string" ? r.git_branch : null;
          out.push(
            sessionRow(
              "codex",
              sid,
              title ? String(title) : "(untitled)",
              updated,
              git,
            ),
          );
        }
        return out;
      });
    });
  });
}

/**
 * JSONL rollout fallback (skip .zst). Bounded walk + mtime-ranked reads.
 * @param {*} fs
 * @param {string} home
 * @param {string} cwd
 */
function listCodexFiles(fs, home, cwd) {
  const root = joinPath(home, "sessions");
  return chain(fs.isDir(root), (ok) => {
    if (!ok) return [];

    /** @type {Array<{ path: string, sidFromName: string, mtimeMs: number }>} */
    const fileCandidates = [];
    const stack = [root];
    let dirsWalked = 0;

    function walkNext() {
      if (!stack.length || dirsWalked >= CODEX_MAX_DIRS_WALKED) {
        fileCandidates.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
        const toRead = fileCandidates.slice(0, PER_GROUP_CAP + ENRICH_SLACK);
        return chain(
          mapSeq(toRead, (c) => {
            return chain(
              tryChain(() => fs.readHead(c.path, { maxBytes: 64_000 }), null),
              (head) => {
                if (head == null) return null;
                let payload = null;
                for (const line of head.split("\n").slice(0, 20)) {
                  try {
                    const rec = JSON.parse(line);
                    if (
                      rec &&
                      typeof rec === "object" &&
                      rec.type === "session_meta" &&
                      rec.payload &&
                      typeof rec.payload === "object"
                    ) {
                      payload = rec.payload;
                      break;
                    }
                  } catch {
                    /* continue */
                  }
                }
                if (!payload || !pathMatchesCwd(payload.cwd, cwd)) return null;
                if (
                  payload.source != null &&
                  payload.source !== "cli" &&
                  payload.source !== "vscode"
                ) {
                  return null;
                }
                const sid = payload.id || c.sidFromName;
                if (typeof sid !== "string" || !UUID_RE.test(sid)) return null;
                let branch = null;
                if (
                  payload.git &&
                  typeof payload.git === "object" &&
                  typeof payload.git.branch === "string"
                ) {
                  branch = payload.git.branch;
                }
                return sessionRow("codex", sid, "(untitled)", c.mtimeMs || 0, branch);
              },
            );
          }),
          (rows) => {
            const out = rows.filter(Boolean);
            out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            return out.slice(0, PER_GROUP_CAP);
          },
        );
      }

      const dir = stack.pop();
      dirsWalked++;
      return chain(tryChain(() => fs.listDirDetailed(dir), []), (entries) => {
        for (const e of entries || []) {
          const path = joinPath(dir, e.name);
          if (e.kind === "dir") {
            stack.push(path);
            continue;
          }
          if (e.kind !== "file") continue;
          if (e.name.endsWith(".zst")) continue;
          const m = CODEX_ROLLOUT_RE.exec(e.name);
          if (!m) continue;
          fileCandidates.push({
            path,
            sidFromName: m[1],
            mtimeMs: e.mtimeMs || 0,
          });
        }
        return walkNext();
      });
    }

    return walkNext();
  });
}

/**
 * @param {*} fs
 * @param {string} cwd
 * @param {{ home?: string, codexHome?: string | null, sqliteAvailable?: boolean }} [opts]
 */
export function listCodex(fs, cwd, opts = {}) {
  return chain(resolveCodexHome(fs, opts), (home) => {
    if (opts.sqliteAvailable === false) {
      return listCodexFiles(fs, home, cwd);
    }
    return chain(listCodexDb(fs, home, cwd), (dbRows) => {
      // null → DB missing / unusable → always JSONL fallback
      if (dbRows == null) return listCodexFiles(fs, home, cwd);
      // Successful empty query: still try JSONL when sessions/ exists
      // (empty/newer state_N.sqlite must not hide rollouts-only installs).
      if (dbRows.length === 0) {
        return chain(fs.isDir(joinPath(home, "sessions")), (hasSessions) => {
          if (hasSessions) return listCodexFiles(fs, home, cwd);
          return dbRows;
        });
      }
      return dbRows;
    });
  });
}

export { resolveCodexHome };
