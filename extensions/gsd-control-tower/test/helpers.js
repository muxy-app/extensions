/** Test helpers: an in-memory FileSource over a fixture tree + factories. */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

/**
 * A GSD FileSource backed by a directory on disk.
 * @param {string} rootDir
 */
export function fsSource(rootDir) {
  return {
    async read(path) {
      try {
        return await readFile(join(rootDir, path), "utf8");
      } catch (e) {
        if (e.code === "ENOENT" || e.code === "EISDIR") return null;
        throw e;
      }
    },
    async list(path) {
      const target = join(rootDir, path);
      let entries;
      try {
        entries = await readdir(target, { withFileTypes: true });
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
      return entries.map((e) => ({ name: e.name, path: e.name, isDirectory: e.isDirectory() }));
    },
  };
}

/** Minimal project factory for reducer/selectors tests. */
export function makeProject(overrides = {}) {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "project-one",
    path: overrides.path ?? "/tmp/project-one",
    isActive: overrides.isActive ?? false,
    worktreesEnabled: true,
  };
}

export function makeWorktree(overrides = {}) {
  return {
    id: overrides.id ?? "w1",
    name: overrides.name ?? "main",
    path: overrides.path ?? "/tmp/project-one",
    branch: overrides.branch ?? "main",
    isPrimary: overrides.isPrimary ?? true,
  };
}

/** Seed a store with one recognized workstream. */
export function seedWorkstream(state, { projectId = "p1", projectName = "project-one", gsd, agent, git } = {}) {
  state.projects.push(makeProject({ id: projectId, name: projectName }));
  state.workstreams.set(`${projectId}::root`, {
    key: `${projectId}::root`,
    projectId,
    projectName,
    projectPath: `/tmp/${projectId}`,
    worktreeId: null,
    worktreePath: `/tmp/${projectId}`,
    isActiveWorktree: true,
    isGsd: !!gsd,
    gsd,
    agent: agent ?? { runtimeState: "unavailable" },
    git,
    controlState: "idle",
    refreshedAt: new Date().toISOString(),
    freshness: "refreshed",
  });
  return state;
}

/** Minutes ago → ISO. */
export function minutesAgo(min) {
  return new Date(Date.now() - min * 60_000).toISOString();
}
