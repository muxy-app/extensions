import { joinPath, chain } from "../../host-fs.js";
import {
  PER_GROUP_CAP,
  ENRICH_SLACK,
  md5Hex,
  isoToMs,
  sessionRow,
  mapSeq,
  tryChain,
  takeRecent,
  isWeakCursorTitle,
  shortId,
  parseCursorStoreMeta,
  cursorTitleFromUserBlob,
  isEmptyCursorRootBlob,
} from "./helpers.js";

/** Soft warning when sqlite3 is missing; store-only parents cannot be listed. */
export const CURSOR_SQLITE_SOFT_ERROR =
  "Install sqlite3 to list store.db Cursor sessions";

const META_SQL = "SELECT value FROM meta WHERE key = '0' LIMIT 1";
const BLOB_SQL =
  "SELECT CAST(substr(data, 1, 16384) AS TEXT) AS text FROM blobs WHERE substr(data, 1, 1) = x'7b' LIMIT 40";

/** Max leftover weak parents per scan that read first-user blobs. */
const BLOB_FALLBACK_CAP = 5;

function parseSidecar(text) {
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function firstStrongTitle(sid, ...cands) {
  for (const cand of cands) {
    if (cand == null) continue;
    if (!isWeakCursorTitle(cand, sid)) return String(cand);
  }
  return null;
}

function titleFromBlobRows(sid, rows) {
  for (const row of rows || []) {
    const t = cursorTitleFromUserBlob(row && row.text);
    if (t && !isWeakCursorTitle(t, sid)) return t;
  }
  return null;
}

/**
 * List Cursor Agent sessions for cwd.
 * Returns plain array when fs is sync; Promise when exec is async.
 * @param {*} fs  HostFs
 * @param {string} cwd
 * @param {{ home?: string, sqliteAvailable?: boolean }} [opts]
 */
export function listCursor(fs, cwd, opts = {}) {
  const sqliteAvailable = opts.sqliteAvailable !== false;
  const homeP = opts.home != null ? opts.home : fs.homeDir();
  return chain(homeP, (home) => {
    const hash = md5Hex(cwd);
    const root = joinPath(home, ".cursor", "chats", hash);

    return chain(tryChain(() => fs.listDirDetailed(root), []), (entries) => {
      if (!entries.length) return [];

      const candidates = takeRecent(entries, {
        limit: PER_GROUP_CAP + ENRICH_SLACK,
        kind: "dir",
      });

      const blobBudget = { used: 0 };

      return chain(
        mapSeq(candidates, (entry) => {
          const name = entry.name;
          const child = joinPath(root, name);
          const metaPath = joinPath(child, "meta.json");
          const dbPath = joinPath(child, "store.db");
          // Cap title metadata reads — huge/corrupt meta.json must not full-cat.
          return chain(
            tryChain(() => fs.readHead(metaPath, { maxBytes: 64_000 }), null),
            (text) => {
              const sidecar = parseSidecar(text);
              if (sidecar) {
                if (sidecar.isSubagent === true) return null;
                if (sidecar.hasConversation === false) return null;
              }

              const sidecarTitle = sidecar
                ? sidecar.title || sidecar.name || null
                : null;
              const needStore =
                sqliteAvailable &&
                (!sidecar || isWeakCursorTitle(sidecarTitle, name));

              const storeP = needStore
                ? tryChain(() => fs.sqliteQuery(dbPath, META_SQL), null)
                : null;

              return chain(storeP, (metaRows) => {
                const rawVal =
                  metaRows && metaRows[0] != null ? metaRows[0].value : null;
                const storeMeta =
                  rawVal != null ? parseCursorStoreMeta(rawVal) : null;

                if (storeMeta && storeMeta.subagentInfo) return null;
                if (
                  storeMeta &&
                  isEmptyCursorRootBlob(storeMeta.latestRootBlobId) &&
                  !(sidecar && sidecar.hasConversation === true)
                ) {
                  return null;
                }

                // Hide dirs we cannot confirm as parent chats (no sidecar, no store meta).
                if (!sidecar && !storeMeta) return null;

                let title = firstStrongTitle(
                  name,
                  sidecar && sidecar.title,
                  sidecar && sidecar.name,
                  storeMeta && storeMeta.name,
                );

                let updated =
                  isoToMs(
                    (sidecar &&
                      (sidecar.updatedAtMs ||
                        sidecar.updatedAt ||
                        sidecar.updated_at)) ||
                      null,
                  ) ||
                  isoToMs(storeMeta && storeMeta.createdAt) ||
                  entry.mtimeMs ||
                  0;
                const branch =
                  sidecar && typeof sidecar.branch === "string"
                    ? sidecar.branch
                    : null;

                const lastResort = `Cursor · ${shortId(name)}`;
                const needBlob =
                  !title &&
                  sqliteAvailable &&
                  storeMeta &&
                  blobBudget.used < BLOB_FALLBACK_CAP;

                if (needBlob) {
                  blobBudget.used += 1;
                  return chain(
                    tryChain(() => fs.sqliteQuery(dbPath, BLOB_SQL), []),
                    (blobRows) => {
                      const fromBlob = titleFromBlobRows(name, blobRows);
                      return sessionRow(
                        "cursor",
                        name,
                        fromBlob || lastResort,
                        updated,
                        branch,
                      );
                    },
                  );
                }

                return sessionRow(
                  "cursor",
                  name,
                  title || lastResort,
                  updated,
                  branch,
                );
              });
            },
          );
        }),
        (rows) => {
          const out = rows.filter(Boolean);
          out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const sliced = out.slice(0, PER_GROUP_CAP);
          if (sqliteAvailable === false && candidates.length) {
            sliced.softError = CURSOR_SQLITE_SOFT_ERROR;
          }
          return sliced;
        },
      );
    });
  });
}
