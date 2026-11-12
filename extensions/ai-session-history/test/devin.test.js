import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostFs } from "../src/lib/host-fs.js";
import { listDevin } from "../src/lib/sessions/scan/devin.js";
import {
  renameSessionJs,
  deleteSessionJs,
} from "../src/lib/sessions/manage/index.js";

const SID = "peppermint-fragrance";
const SID2 = "dirt-grape";
const PROJ = "/tmp/muxy-devin-proj";
const OTHER = "/tmp/muxy-devin-other";

function realExec(argv, opts = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    input: opts.stdin,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 20000,
    env: process.env,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function q(v) {
  if (v == null) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function msg(role, content, ts) {
  return JSON.stringify({
    message_id: `m-${role}-${ts}`,
    role,
    content,
    created_at: new Date(ts * 1000).toISOString(),
  });
}

function seedDb(dbPath) {
  spawnSync(
    "/usr/bin/sqlite3",
    [
      dbPath,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        working_directory TEXT NOT NULL,
        backend_type TEXT NOT NULL DEFAULT 'local',
        model TEXT NOT NULL DEFAULT 'swe-2',
        agent_mode TEXT NOT NULL DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        title TEXT,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE message_nodes (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        node_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        chat_message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE prompt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        is_shell INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO sessions (id, working_directory, created_at, last_activity_at, title) VALUES
        (${q(SID)}, ${q(PROJ)}, 1700000000, 1700000100, 'Devin Main'),
        (${q(SID2)}, ${q(OTHER)}, 1700000000, 1700000200, 'Other Project'),
        ('hidden-one', ${q(PROJ)}, 1700000000, 1700000300, 'Hidden');
      UPDATE sessions SET hidden = 1 WHERE id = 'hidden-one';
      INSERT INTO message_nodes (session_id, node_id, chat_message, created_at) VALUES
        (${q(SID)}, 1, ${q(msg("user", "fix the flaky test", 1700000010))}, 1700000010),
        (${q(SID)}, 2, ${q(msg("assistant", "", 1700000011))}, 1700000011),
        (${q(SID)}, 3, ${q(msg("assistant", "Patched the retry logic.", 1700000090))}, 1700000090),
        (${q(SID)}, 4, ${q(msg("user", "now run the suite", 1700000095))}, 1700000095),
        (${q(SID)}, 5, ${q(msg("assistant", "All green, 42 tests pass.", 1700000100))}, 1700000100);
      `,
    ],
    { encoding: "utf8" },
  );
}

describe("listDevin", () => {
  let home;
  let prevHome;
  let prevXdg;
  let cliDir;
  let dbPath;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "devin-scan-"));
    cliDir = join(home, ".local", "share", "devin", "cli");
    mkdirSync(cliDir, { recursive: true });
    dbPath = join(cliDir, "sessions.db");
    seedDb(dbPath);
    prevHome = process.env.HOME;
    prevXdg = process.env.XDG_DATA_HOME;
    process.env.HOME = home;
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists sessions for cwd with last user/assistant previews", async () => {
    const fs = createHostFs(realExec);
    const rows = await listDevin(fs, PROJ, { home, dataDir: cliDir, dbPath });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, SID);
    assert.equal(row.cli, "devin");
    assert.equal(row.title, "Devin Main");
    assert.equal(row.cwd, PROJ);
    assert.equal(row.updatedAt, 1700000100 * 1000);
    assert.equal(row.lastUser.text, "now run the suite");
    assert.equal(row.lastUser.at, 1700000095 * 1000);
    assert.equal(row.lastAssistant.text, "All green, 42 tests pass.");
    assert.equal(row.lastAssistant.at, 1700000100 * 1000);
  });

  it("returns empty when no matching cwd", async () => {
    const fs = createHostFs(realExec);
    const rows = await listDevin(fs, "/tmp/nope", { home, dataDir: cliDir, dbPath });
    assert.equal(rows.length, 0);
  });
});

describe("manage Devin", () => {
  let home;
  let prevHome;
  let prevXdg;
  let cliDir;
  let dbPath;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "devin-manage-"));
    cliDir = join(home, ".local", "share", "devin", "cli");
    mkdirSync(join(cliDir, "transcripts"), { recursive: true });
    dbPath = join(cliDir, "sessions.db");
    seedDb(dbPath);
    prevHome = process.env.HOME;
    prevXdg = process.env.XDG_DATA_HOME;
    process.env.HOME = home;
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(home, { recursive: true, force: true });
  });

  it("renames title in sessions.db", async () => {
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "devin", SID, "Fresh Title");
    const out = spawnSync(
      "/usr/bin/sqlite3",
      [dbPath, `SELECT title FROM sessions WHERE id=${q(SID)}`],
      { encoding: "utf8" },
    );
    assert.equal(out.stdout.trim(), "Fresh Title");
  });

  it("deletes session and its message rows", async () => {
    const fs = createHostFs(realExec);
    await deleteSessionJs(fs, "devin", SID);
    const out = spawnSync(
      "/usr/bin/sqlite3",
      [
        dbPath,
        `SELECT (SELECT COUNT(*) FROM sessions WHERE id=${q(SID)}) || '|' ||
                (SELECT COUNT(*) FROM message_nodes WHERE session_id=${q(SID)});`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(out.stdout.trim(), "0|0");
  });
});
