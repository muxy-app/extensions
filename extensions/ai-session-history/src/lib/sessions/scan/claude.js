import { joinPath, chain, expandUserPath } from "../../host-fs.js";
import {
  UUID_RE,
  PER_GROUP_CAP,
  ENRICH_SLACK,
  slugify,
  normPath,
  claudeTitleFromJsonl,
  sessionRow,
  mapSeq,
  tryChain,
} from "./helpers.js";

/**
 * Collect UUID .jsonl file candidates under one project dir.
 * @param {*} fs
 * @param {string} project
 */
function collectJsonlCandidates(fs, project) {
  return chain(tryChain(() => fs.listDirDetailed(project), []), (files) => {
    /** @type {Array<{ path: string, stem: string, project: string, mtimeMs: number }>} */
    const out = [];
    for (const f of files || []) {
      if (f.kind !== "file") continue;
      if (!f.name.endsWith(".jsonl")) continue;
      const stem = f.name.replace(/\.jsonl$/, "");
      if (!UUID_RE.test(stem)) continue;
      out.push({
        path: joinPath(project, f.name),
        stem,
        project,
        mtimeMs: f.mtimeMs || 0,
      });
    }
    return out;
  });
}

/**
 * @param {*} fs
 * @param {Array<{ path: string, stem: string, project: string, mtimeMs: number }>} toEnrich
 * @param {string} cwd
 * @param {string} expected
 * @param {Set<string>} seen
 */
function enrichClaudeCandidates(fs, toEnrich, cwd, expected, seen) {
  return chain(
    mapSeq(toEnrich, (c) => {
      if (seen.has(c.stem)) return null;
      return chain(tryChain(() => fs.readHead(c.path, { maxBytes: 256_000 }), null), (head) => {
        if (head == null) return null;
        const { title, cwd: storedCwd, branch } = claudeTitleFromJsonl(head);
        if (storedCwd && normPath(storedCwd) !== normPath(cwd)) return null;
        if (!storedCwd && c.project !== expected) return null;
        seen.add(c.stem);
        return sessionRow("claude", c.stem, title, c.mtimeMs || 0, branch);
      });
    }),
    (rows) => rows.filter(Boolean),
  );
}

/**
 * List Claude Code sessions for cwd.
 * Metadata-first: list project dirs + jsonl mtimes, then readHead only top candidates.
 * Returns plain array when fs is sync; Promise when exec is async.
 * @param {*} fs
 * @param {string} cwd
 * @param {{ home?: string, claudeConfigDir?: string | null }} [opts]
 */
export function listClaude(fs, cwd, opts = {}) {
  const baseP = (() => {
    if (opts.claudeConfigDir) return opts.claudeConfigDir;
    return chain(fs.env("CLAUDE_CONFIG_DIR"), (envDir) => {
      const homeP = opts.home != null ? opts.home : fs.homeDir();
      if (envDir) {
        return chain(homeP, (home) => expandUserPath(envDir, home) || envDir);
      }
      return chain(homeP, (home) => joinPath(home, ".claude"));
    });
  })();

  return chain(baseP, (base) => {
    const projects = joinPath(base, "projects");
    return chain(tryChain(() => fs.listDirDetailed(projects), []), (projectEntries) => {
      if (!projectEntries.length) return [];

      const expected = joinPath(projects, slugify(cwd));
      const dirEntries = projectEntries.filter((e) => e.kind === "dir");
      const foreignProjects = dirEntries
        .filter((e) => joinPath(projects, e.name) !== expected)
        .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
        .map((e) => joinPath(projects, e.name));

      const seen = new Set();
      const expectedExists = dirEntries.some(
        (e) => joinPath(projects, e.name) === expected,
      );

      const phase1 = expectedExists
        ? chain(collectJsonlCandidates(fs, expected), (local) => {
            local.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
            const toEnrich = local.slice(0, PER_GROUP_CAP + ENRICH_SLACK);
            return enrichClaudeCandidates(fs, toEnrich, cwd, expected, seen);
          })
        : [];

      return chain(phase1, (out) => {
        if (out.length >= PER_GROUP_CAP) {
          out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return out.slice(0, PER_GROUP_CAP);
        }

        const remaining = PER_GROUP_CAP + ENRICH_SLACK - out.length;
        return chain(
          collectForeignCandidates(fs, foreignProjects, remaining * 4),
          (foreignCandidates) => {
            foreignCandidates.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
            const toEnrich = foreignCandidates.slice(0, remaining);
            return chain(
              enrichClaudeCandidates(fs, toEnrich, cwd, expected, seen),
              (more) => {
                const merged = out.concat(more);
                merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                return merged.slice(0, PER_GROUP_CAP);
              },
            );
          },
        );
      });
    });
  });
}

/**
 * @param {*} fs
 * @param {string[]} foreignProjects
 * @param {number} maxCandidates
 */
function collectForeignCandidates(fs, foreignProjects, maxCandidates) {
  /** @type {Array<{ path: string, stem: string, project: string, mtimeMs: number }>} */
  const acc = [];
  return chain(
    mapSeq(foreignProjects, (project) => {
      if (acc.length >= maxCandidates) return null;
      return chain(collectJsonlCandidates(fs, project), (part) => {
        for (const c of part) {
          acc.push(c);
          if (acc.length >= maxCandidates) break;
        }
        return null;
      });
    }),
    () => acc,
  );
}
