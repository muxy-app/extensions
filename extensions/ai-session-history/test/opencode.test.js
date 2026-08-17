import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostFs } from "../src/lib/host-fs.js";
import { listOpenCode } from "../src/lib/sessions/scan/opencode.js";
import {
  renameSessionJs,
  deleteSessionJs,
} from "../src/lib/sessions/manage/index.js";

const SID = "ses_aaaaaaaaaaaaaaaa";
const SID2 = "ses_bbbbbbbbbbbbbbbb";
const SID_CHILD = "ses_cccccccccccccccc";
const PROJ = "/tmp/muxy-opencode-proj";
const OTHER = "/tmp/muxy-opencode-other";

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

describe("listOpenCode", () => {
  let home;
  let prevHome;
  let prevXdg;
  let prevDb;
  let dataDir;
  let dbPath;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "oc-scan-"));
    dataDir = join(home, ".local", "share", "opencode");
    mkdirSync(dataDir, { recursive: true });
    dbPath = join(dataDir, "opencode.db");
    prevHome = process.env.HOME;
    prevXdg = process.env.XDG_DATA_HOME;
    prevDb = process.env.OPENCODE_DB;
    process.env.HOME = home;
    delete process.env.XDG_DATA_HOME;
    delete process.env.OPENCODE_DB;

    spawnSync(
      "/usr/bin/sqlite3",
      [
        dbPath,
        `CREATE TABLE session (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          parent_id TEXT,
          slug TEXT NOT NULL,
          directory TEXT NOT NULL,
          title TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1',
          cost REAL NOT NULL DEFAULT 0,
          tokens_input INTEGER NOT NULL DEFAULT 0,
          tokens_output INTEGER NOT NULL DEFAULT 0,
          tokens_reasoning INTEGER NOT NULL DEFAULT 0,
          tokens_cache_read INTEGER NOT NULL DEFAULT 0,
          tokens_cache_write INTEGER NOT NULL DEFAULT 0,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER
        );
        INSERT INTO session (
          id, project_id, parent_id, slug, directory, title,
          time_created, time_updated, time_archived
        ) VALUES
          (${q(SID)}, 'proj1', NULL, 'slug-a', ${q(PROJ)}, 'OpenCode Main',
           1700000000000, 1700000005000, NULL),
          (${q(SID2)}, 'proj1', NULL, 'slug-b', ${q(OTHER)}, 'Other Project',
           1700000000000, 1700000006000, NULL),
          (${q(SID_CHILD)}, 'proj1', ${q(SID)}, 'slug-c', ${q(PROJ)}, 'Child Session',
           1700000000000, 1700000007000, NULL),
          ('ses_dddddddddddddddd', 'proj1', NULL, 'slug-d', ${q(PROJ)}, 'Archived',
           1700000000000, 1700000001000, 1700000009000);
        `,
      ],
      { encoding: "utf8" },
    );
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDb === undefined) delete process.env.OPENCODE_DB;
    else process.env.OPENCODE_DB = prevDb;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists root sessions for cwd and skips children/other/archived", async () => {
    const fs = createHostFs(realExec);
    const rows = await listOpenCode(fs, PROJ, { home, dataDir, dbPath });
    const ids = rows.map((r) => r.id);
    assert.deepEqual(ids, [SID]);
    assert.equal(rows[0].title, "OpenCode Main");
    assert.equal(rows[0].cli, "opencode");
    assert.equal(rows[0].cwd, PROJ);
  });

  it("returns empty when no matching cwd", async () => {
    const fs = createHostFs(realExec);
    const rows = await listOpenCode(fs, "/tmp/nope", { home, dataDir, dbPath });
    assert.equal(rows.length, 0);
  });
});

describe("manage OpenCode", () => {
  let home;
  let prevHome;
  let prevXdg;
  let dataDir;
  let dbPath;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "oc-manage-"));
    dataDir = join(home, ".local", "share", "opencode");
    mkdirSync(dataDir, { recursive: true });
    dbPath = join(dataDir, "opencode.db");
    prevHome = process.env.HOME;
    prevXdg = process.env.XDG_DATA_HOME;
    process.env.HOME = home;
    delete process.env.XDG_DATA_HOME;

    spawnSync(
      "/usr/bin/sqlite3",
      [
        dbPath,
        `CREATE TABLE session (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          parent_id TEXT,
          slug TEXT NOT NULL,
          directory TEXT NOT NULL,
          title TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1',
          cost REAL NOT NULL DEFAULT 0,
          tokens_input INTEGER NOT NULL DEFAULT 0,
          tokens_output INTEGER NOT NULL DEFAULT 0,
          tokens_reasoning INTEGER NOT NULL DEFAULT 0,
          tokens_cache_read INTEGER NOT NULL DEFAULT 0,
          tokens_cache_write INTEGER NOT NULL DEFAULT 0,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER
        );
        INSERT INTO session (
          id, project_id, parent_id, slug, directory, title,
          time_created, time_updated
        ) VALUES (
          ${q(SID)}, 'proj1', NULL, 'slug-a', ${q(PROJ)}, 'Old Title',
          1700000000000, 1700000005000
        );`,
      ],
      { encoding: "utf8" },
    );
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(home, { recursive: true, force: true });
  });

  it("renames title in opencode.db", async () => {
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "opencode", SID, "Fresh Title");
    const out = spawnSync(
      "/usr/bin/sqlite3",
      [dbPath, `SELECT title FROM session WHERE id=${q(SID)}`],
      { encoding: "utf8" },
    );
    assert.equal(out.stdout.trim(), "Fresh Title");
  });

  it("deletes session row", async () => {
    const fs = createHostFs(realExec);
    await deleteSessionJs(fs, "opencode", SID);
    const out = spawnSync(
      "/usr/bin/sqlite3",
      [dbPath, `SELECT COUNT(*) FROM session WHERE id=${q(SID)}`],
      { encoding: "utf8" },
    );
    assert.equal(out.stdout.trim(), "0");
  });
});
