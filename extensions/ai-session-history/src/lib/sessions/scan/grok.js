import { joinPath, chain } from "../../host-fs.js";
import {
  UUID_RE,
  PER_GROUP_CAP,
  ENRICH_SLACK,
  pathQuote,
  isoToMs,
  sessionRow,
  mapSeq,
  tryChain,
  takeRecent,
} from "./helpers.js";

/**
 * List Grok sessions for cwd.
 * Returns plain array when fs is sync (runScript); Promise when exec is async.
 * @param {*} fs
 * @param {string} cwd
 * @param {{ home?: string }} [opts]
 */
export function listGrok(fs, cwd, opts = {}) {
  const homeP = opts.home != null ? opts.home : fs.homeDir();
  return chain(homeP, (home) => {
    const root = joinPath(home, ".grok", "sessions", pathQuote(cwd));
    return chain(tryChain(() => fs.listDirDetailed(root), []), (entries) => {
      if (!entries.length) return [];

      const candidates = takeRecent(entries, {
        limit: PER_GROUP_CAP + ENRICH_SLACK,
        kind: "dir",
        nameOk: (name) => UUID_RE.test(name),
      });

      return chain(
        mapSeq(candidates, (entry) => {
          const name = entry.name;
          const child = joinPath(root, name);
          const summary = joinPath(child, "summary.json");
          return chain(tryChain(() => fs.readText(summary), null), (text) => {
            let title = "(untitled)";
            let updated = entry.mtimeMs || 0;
            let sid = name;
            if (text) {
              try {
                const data = JSON.parse(text);
                if (data && typeof data === "object") {
                  const info =
                    data.info && typeof data.info === "object" ? data.info : {};
                  if (typeof info.id === "string") sid = info.id;
                  title =
                    data.generated_title ||
                    data.session_summary ||
                    data.agent_name ||
                    title;
                  updated =
                    isoToMs(data.updated_at || data.last_active_at) || updated;
                  return sessionRow("grok", sid, String(title), updated, null);
                }
              } catch {
                /* missing or invalid summary — use dir mtime */
              }
            }
            return sessionRow("grok", name, title, updated, null);
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
