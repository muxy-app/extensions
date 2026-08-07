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
} from "./helpers.js";

/**
 * List Cursor Agent sessions for cwd.
 * Returns plain array when fs is sync; Promise when exec is async.
 * @param {*} fs  HostFs
 * @param {string} cwd
 * @param {{ home?: string }} [opts]
 */
export function listCursor(fs, cwd, opts = {}) {
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

      return chain(
        mapSeq(candidates, (entry) => {
          const name = entry.name;
          const child = joinPath(root, name);
          const metaPath = joinPath(child, "meta.json");
          return chain(tryChain(() => fs.readText(metaPath), null), (text) => {
            let title = "(untitled)";
            let updated = entry.mtimeMs || 0;
            let branch = null;
            if (text) {
              try {
                const data = JSON.parse(text);
                if (data && typeof data === "object") {
                  title = data.title || data.name || title;
                  updated =
                    isoToMs(data.updatedAtMs || data.updatedAt || data.updated_at) ||
                    updated;
                  if (typeof data.branch === "string") branch = data.branch;
                }
              } catch {
                /* missing or invalid meta */
              }
            }
            return sessionRow("cursor", name, String(title), updated, branch);
          });
        }),
        (rows) => {
          const out = rows.filter(Boolean);
          out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return out.slice(0, PER_GROUP_CAP);
        },
      );
    });
  });
}
