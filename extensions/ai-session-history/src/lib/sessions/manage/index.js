import { joinPath, sqlQuote, expandUserPath } from "../../host-fs.js";
import { isSafeSessionId } from "../../sanitize.js";
import { slugify, toPromise, resolveTitleLikeColumn } from "../scan/helpers.js";

/**
 * @param {*} fs
 * @param {string} home
 * @param {string} sessionId
 */
async function findGrokSessionDir(fs, home, sessionId) {
  const root = joinPath(home, ".grok", "sessions");
  if (!(await toPromise(fs.isDir(root)))) return null;
  const projs = await toPromise(fs.listDir(root));
  for (const proj of projs) {
    const candidate = joinPath(root, proj, sessionId);
    if (await toPromise(fs.isDir(candidate))) return candidate;
  }
  return null;
}

/**
 * @param {*} fs
 * @param {string} home
 * @param {string} sessionId
 */
async function findCursorSessionDir(fs, home, sessionId) {
  const root = joinPath(home, ".cursor", "chats");
  if (!(await toPromise(fs.isDir(root)))) return null;
  const projs = await toPromise(fs.listDir(root));
  for (const proj of projs) {
    const projPath = joinPath(root, proj);
    if (!(await toPromise(fs.isDir(projPath)))) continue;
    const candidate = joinPath(projPath, sessionId);
    if (await toPromise(fs.isDir(candidate))) return candidate;
  }
  return null;
}

async function writeJsonAtomic(fs, path, data) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await toPromise(fs.writeAtomic(path, text));
}

/**
 * Set top-level name: in simple YAML; create if missing.
 * @param {*} fs
 * @param {string} path
 * @param {string} newTitle
 */
async function updateYamlName(fs, path, newTitle) {
  let lines = [];
  if (await toPromise(fs.isFile(path))) {
    try {
      lines = (await toPromise(fs.readText(path))).split("\n");
      // drop trailing empty from split
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
    } catch {
      lines = [];
    }
  }
  const keyRe = /^(\s*)name\s*:/;
  const userNamedRe = /^(\s*)user_named\s*:/;
  let replaced = false;
  let sawUserNamed = false;
  const outLines = [];
  const safe = newTitle.replace(/\n/g, " ").replace(/"/g, '\\"');
  for (const line of lines) {
    const m = keyRe.exec(line);
    if (m && !replaced) {
      outLines.push(`${m[1]}name: "${safe}"`);
      replaced = true;
      continue;
    }
    const um = userNamedRe.exec(line);
    if (um) {
      outLines.push(`${um[1]}user_named: true`);
      sawUserNamed = true;
      continue;
    }
    outLines.push(line);
  }
  if (!replaced) outLines.push(`name: "${safe}"`);
  if (!sawUserNamed) outLines.push(`user_named: true`);
  try {
    await toPromise(fs.writeAtomic(path, `${outLines.join("\n")}\n`));
    return true;
  } catch {
    return false;
  }
}

async function renameGrok(fs, home, sessionId, newTitle) {
  const sessionDir = await findGrokSessionDir(fs, home, sessionId);
  if (!sessionDir) throw new Error(`Grok session not found: ${sessionId}`);
  const summary = joinPath(sessionDir, "summary.json");
  let data = {};
  if (await toPromise(fs.isFile(summary))) {
    try {
      const loaded = JSON.parse(await toPromise(fs.readText(summary)));
      if (loaded && typeof loaded === "object") data = loaded;
    } catch {
      data = {};
    }
  }
  data.generated_title = newTitle;
  await writeJsonAtomic(fs, summary, data);
}

async function renameCursor(fs, home, sessionId, newTitle) {
  const sessionDir = await findCursorSessionDir(fs, home, sessionId);
  if (!sessionDir) throw new Error(`Cursor session not found: ${sessionId}`);
  const meta = joinPath(sessionDir, "meta.json");
  let data = {};
  if (await toPromise(fs.isFile(meta))) {
    try {
      const loaded = JSON.parse(await toPromise(fs.readText(meta)));
      if (loaded && typeof loaded === "object") data = loaded;
    } catch {
      data = {};
    }
  }
  data.title = newTitle;
  await writeJsonAtomic(fs, meta, data);
}

async function renameCodex(fs, home, sessionId, newTitle) {
  const envHome = await toPromise(fs.env("CODEX_HOME"));
  const codexHome = envHome
    ? expandUserPath(envHome, home) || envHome
    : joinPath(home, ".codex");

  if (!(await toPromise(fs.isDir(codexHome)))) {
    throw new Error("No Codex state database found");
  }
  const names = await toPromise(fs.listDir(codexHome));
  const candidates = [];
  for (const name of names) {
    const m = /^state_(\d+)\.sqlite$/.exec(name);
    if (!m) continue;
    const path = joinPath(codexHome, name);
    if (await toPromise(fs.isFile(path))) {
      candidates.push({ n: Number(m[1]), path });
    }
  }
  if (!candidates.length) throw new Error("No Codex state database found");
  candidates.sort((a, b) => b.n - a.n);
  const dbPath = candidates[0].path;

  const cols = await toPromise(fs.sqliteTableColumns(dbPath, "threads"));
  if (!cols.has("title")) {
    throw new Error("Codex database does not have a title column");
  }

  // Check existence first
  const existing = await toPromise(
    fs.sqliteQuery(
      dbPath,
      `SELECT id FROM threads WHERE id = ${sqlQuote(sessionId)} LIMIT 1`,
    ),
  );
  if (!existing.length) throw new Error(`Codex session not found: ${sessionId}`);

  await toPromise(
    fs.sqliteExec(
      dbPath,
      `UPDATE threads SET title = ${sqlQuote(newTitle)} WHERE id = ${sqlQuote(sessionId)}`,
    ),
  );
}

async function renameCopilot(fs, home, sessionId, newTitle) {
  const envHome = await toPromise(fs.env("COPILOT_HOME"));
  const copilotHome = envHome
    ? expandUserPath(envHome, home) || envHome
    : joinPath(home, ".copilot");

  let wrote = false;
  const errors = [];
  /** If a sessions row exists with a title-like column, UPDATE must succeed. */
  let authoritativeDbUpdateFailed = false;

  for (const dbName of ["session-store.db", "data.db"]) {
    const dbPath = joinPath(copilotHome, dbName);
    if (!(await toPromise(fs.isFile(dbPath)))) continue;
    try {
      const tables = await toPromise(fs.sqliteTables(dbPath));
      if (!tables.has("sessions")) continue;
      const cols = await toPromise(fs.sqliteTableColumns(dbPath, "sessions"));
      if (!cols.has("id")) continue;
      const titleCol = resolveTitleLikeColumn(cols);
      if (!titleCol) continue;
      const existing = await toPromise(
        fs.sqliteQuery(
          dbPath,
          `SELECT id FROM sessions WHERE id = ${sqlQuote(sessionId)} LIMIT 1`,
        ),
      );
      if (!existing.length) continue;
      try {
        await toPromise(
          fs.sqliteExec(
            dbPath,
            `UPDATE sessions SET ${titleCol} = ${sqlQuote(newTitle)} WHERE id = ${sqlQuote(sessionId)}`,
          ),
        );
        wrote = true;
      } catch (e) {
        authoritativeDbUpdateFailed = true;
        errors.push(`${dbName}: ${e?.message || e}`);
      }
    } catch (e) {
      errors.push(`${dbName}: ${e?.message || e}`);
    }
  }

  if (authoritativeDbUpdateFailed) {
    const detail = errors.length ? errors.join("; ") : "sessions UPDATE failed";
    throw new Error(`Could not rename Copilot session: ${detail}`);
  }

  const stateDir = joinPath(copilotHome, "session-state", sessionId);
  if (await toPromise(fs.isDir(stateDir))) {
    const ws = joinPath(stateDir, "workspace.yaml");
    if (await updateYamlName(fs, ws, newTitle)) wrote = true;
    const meta = joinPath(stateDir, "meta.json");
    try {
      let data = {};
      if (await toPromise(fs.isFile(meta))) {
        const loaded = JSON.parse(await toPromise(fs.readText(meta)));
        if (loaded && typeof loaded === "object") data = loaded;
      }
      data.title = newTitle;
      data.name = newTitle;
      await writeJsonAtomic(fs, meta, data);
      wrote = true;
    } catch (e) {
      errors.push(`meta.json: ${e?.message || e}`);
    }
  } else if (!wrote) {
    throw new Error(`Copilot session not found: ${sessionId}`);
  }

  if (!wrote) {
    const detail = errors.length ? errors.join("; ") : "no writable title targets";
    throw new Error(`Could not rename Copilot session: ${detail}`);
  }
}

async function deleteGrok(fs, home, sessionId) {
  const sessionDir = await findGrokSessionDir(fs, home, sessionId);
  if (!sessionDir) throw new Error(`Grok session not found: ${sessionId}`);
  const root = joinPath(home, ".grok", "sessions");
  await toPromise(fs.removePath(sessionDir, { root }));
}

async function deleteClaude(fs, home, sessionId, cwd) {
  const envBase = await toPromise(fs.env("CLAUDE_CONFIG_DIR"));
  const base = envBase
    ? expandUserPath(envBase, home) || envBase
    : joinPath(home, ".claude");
  const projects = joinPath(base, "projects");
  if (!(await toPromise(fs.isDir(projects)))) {
    throw new Error("Claude projects directory not found");
  }
  const searchDirs = [];
  if (cwd) {
    const expected = joinPath(projects, slugify(cwd));
    if (await toPromise(fs.isDir(expected))) searchDirs.push(expected);
  }
  const names = await toPromise(fs.listDir(projects));
  for (const name of names.slice().sort()) {
    const proj = joinPath(projects, name);
    if (searchDirs.includes(proj)) continue;
    if (await toPromise(fs.isDir(proj))) searchDirs.push(proj);
  }
  let target = null;
  for (const proj of searchDirs) {
    const candidate = joinPath(proj, `${sessionId}.jsonl`);
    if (await toPromise(fs.isFile(candidate))) {
      target = candidate;
      break;
    }
  }
  if (!target) throw new Error(`Claude session not found: ${sessionId}`);
  await toPromise(fs.removePath(target, { root: projects }));
}

async function deleteCursor(fs, home, sessionId) {
  const sessionDir = await findCursorSessionDir(fs, home, sessionId);
  if (!sessionDir) throw new Error(`Cursor session not found: ${sessionId}`);
  const root = joinPath(home, ".cursor", "chats");
  await toPromise(fs.removePath(sessionDir, { root }));
}

/**
 * Resolve OpenCode SQLite DB path (mirrors scan/opencode.js).
 * @param {*} fs
 * @param {string} home
 */
async function resolveOpenCodeDb(fs, home) {
  const xdg = await toPromise(fs.env("XDG_DATA_HOME"));
  const xdgAbs = xdg ? expandUserPath(xdg, home) || xdg : null;
  const dataDir = xdgAbs
    ? joinPath(xdgAbs, "opencode")
    : joinPath(home, ".local", "share", "opencode");
  const envDb = await toPromise(fs.env("OPENCODE_DB"));
  if (envDb && envDb !== ":memory:") {
    const abs = expandUserPath(envDb, home) || envDb;
    if (abs.startsWith("/")) return abs;
    return joinPath(dataDir, envDb);
  }
  const primary = joinPath(dataDir, "opencode.db");
  if (await toPromise(fs.isFile(primary))) return primary;
  try {
    const names = await toPromise(fs.listDir(dataDir));
    for (const n of names) {
      if (!/^opencode(-[A-Za-z0-9._-]+)?\.db$/.test(n)) continue;
      const path = joinPath(dataDir, n);
      if (await toPromise(fs.isFile(path))) return path;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function renameOpenCode(fs, home, sessionId, newTitle) {
  const dbPath = await resolveOpenCodeDb(fs, home);
  if (!dbPath) throw new Error("No OpenCode database found");
  const existing = await toPromise(
    fs.sqliteQuery(
      dbPath,
      `SELECT id FROM session WHERE id = ${sqlQuote(sessionId)} LIMIT 1`,
    ),
  );
  if (!existing.length) throw new Error(`OpenCode session not found: ${sessionId}`);
  const now = Date.now();
  await toPromise(
    fs.sqliteExec(
      dbPath,
      `UPDATE session SET title = ${sqlQuote(newTitle)}, time_updated = ${now} ` +
        `WHERE id = ${sqlQuote(sessionId)}`,
    ),
  );
}

async function deleteOpenCode(fs, home, sessionId) {
  const dbPath = await resolveOpenCodeDb(fs, home);
  if (!dbPath) throw new Error("No OpenCode database found");
  const existing = await toPromise(
    fs.sqliteQuery(
      dbPath,
      `SELECT id FROM session WHERE id = ${sqlQuote(sessionId)} LIMIT 1`,
    ),
  );
  if (!existing.length) throw new Error(`OpenCode session not found: ${sessionId}`);
  // CASCADE FK on messages when present; best-effort delete session row.
  await toPromise(
    fs.sqliteExec(dbPath, `DELETE FROM session WHERE id = ${sqlQuote(sessionId)}`),
  );
}

/**
 * Rename a session title via host-fs.
 * @param {*} fs
 * @param {string} cli
 * @param {string} sessionId
 * @param {string} newTitle
 */
export async function renameSessionJs(fs, cli, sessionId, newTitle) {
  if (!isSafeSessionId(sessionId)) throw new Error("Invalid session id");
  if (!newTitle || !String(newTitle).trim()) throw new Error("Title must not be empty");
  const home = await toPromise(fs.homeDir());
  const id = String(cli).toLowerCase();
  switch (id) {
    case "grok":
      return renameGrok(fs, home, sessionId, newTitle);
    case "codex":
      return renameCodex(fs, home, sessionId, newTitle);
    case "cursor":
      return renameCursor(fs, home, sessionId, newTitle);
    case "copilot":
      return renameCopilot(fs, home, sessionId, newTitle);
    case "opencode":
      return renameOpenCode(fs, home, sessionId, newTitle);
    default:
      throw new Error(`Rename not supported for CLI: ${cli}`);
  }
}

/**
 * Delete a session via host-fs.
 * @param {*} fs
 * @param {string} cli
 * @param {string} sessionId
 * @param {string} [cwd]
 */
export async function deleteSessionJs(fs, cli, sessionId, cwd) {
  if (!isSafeSessionId(sessionId)) throw new Error("Invalid session id");
  const home = await toPromise(fs.homeDir());
  const id = String(cli).toLowerCase();
  switch (id) {
    case "grok":
      return deleteGrok(fs, home, sessionId);
    case "claude":
      return deleteClaude(fs, home, sessionId, cwd);
    case "cursor":
      return deleteCursor(fs, home, sessionId);
    case "opencode":
      return deleteOpenCode(fs, home, sessionId);
    default:
      throw new Error(`Delete not supported for CLI: ${cli}`);
  }
}

