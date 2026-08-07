import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createHostFs } from "../src/lib/host-fs.js";
import { listGrok } from "../src/lib/sessions/scan/grok.js";
import { listCursor } from "../src/lib/sessions/scan/cursor.js";
import { listClaude } from "../src/lib/sessions/scan/claude.js";
import { listCodex } from "../src/lib/sessions/scan/codex.js";
import {
  listCopilot,
  buildCopilotProbeEntries,
} from "../src/lib/sessions/scan/copilot.js";
import {
  pathQuote,
  md5Hex,
  slugify,
  claudeTitleFromJsonl,
  pickDisplayTitle,
  takeRecent,
  COPILOT_MAX_STATE_DIRS,
} from "../src/lib/sessions/scan/helpers.js";

const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SID2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROJ = "/tmp/muxy-test-proj";
const OTHER = "/tmp/muxy-other-proj";

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

describe("scan helpers", () => {
  it("pathQuote matches percent-encoding for path separators", () => {
    assert.equal(pathQuote("/Users/a/b"), "%2FUsers%2Fa%2Fb");
  });

  it("pathQuote and md5Hex work without TextEncoder (runScript/JSC)", async () => {
    const { utf8Bytes } = await import("../src/lib/sessions/scan/helpers.js");
    // Non-ASCII path segment (UTF-8 multi-byte)
    assert.equal(pathQuote("/tmp/café"), "%2Ftmp%2Fcaf%C3%A9");
    assert.ok(utf8Bytes("café").length >= 5);
    // md5 of empty string is a known constant
    assert.equal(md5Hex(""), "d41d8cd98f00b204e9800998ecf8427e");
  });

  it("pathMatchesCwd is exact (no prefix false positive)", async () => {
    const { pathMatchesCwd } = await import("../src/lib/sessions/scan/helpers.js");
    assert.equal(pathMatchesCwd("/tmp/muxy-test-proj", "/tmp/muxy-test-proj"), true);
    assert.equal(pathMatchesCwd("/tmp/muxy-test-proj-extra", "/tmp/muxy-test-proj"), false);
    assert.equal(pathMatchesCwd("/tmp/muxy-test-proj/", "/tmp/muxy-test-proj"), true);
  });

  it("md5Hex matches node crypto", () => {
    const s = "/tmp/project";
    assert.equal(md5Hex(s), createHash("md5").update(s, "utf8").digest("hex"));
  });

  it("slugify replaces non-alnum", () => {
    assert.equal(slugify("/tmp/foo-bar"), "-tmp-foo-bar");
  });

  it("claudeTitleFromJsonl prefers custom-title", () => {
    const text = [
      JSON.stringify({ type: "user", message: { content: "first" }, cwd: PROJ }),
      JSON.stringify({ type: "ai-title", title: "AI" }),
      JSON.stringify({ type: "custom-title", title: "Custom" }),
    ].join("\n");
    const r = claudeTitleFromJsonl(text);
    assert.equal(r.title, "Custom");
    assert.equal(r.cwd, PROJ);
  });

  it("pickDisplayTitle prefers strong db title", () => {
    assert.equal(
      pickDisplayTitle(SID, {
        db_title: "Desktop DB Title",
        yaml_name: "Yaml Name",
        first_user: "first user line",
      }),
      "Desktop DB Title",
    );
  });

  it("takeRecent filters kind, sorts mtime desc, slices limit", () => {
    const entries = [
      { name: "a", kind: "dir", mtimeMs: 100 },
      { name: "b", kind: "file", mtimeMs: 300 },
      { name: "c", kind: "dir", mtimeMs: 200 },
    ];
    const dirs = takeRecent(entries, { limit: 1, kind: "dir" });
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0].name, "c");
  });
});

describe("listGrok", () => {
  let home;
  let prevHome;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-grok-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists sessions from summary.json", async () => {
    const root = join(home, ".grok", "sessions", pathQuote(PROJ));
    const sess = join(root, SID);
    mkdirSync(sess, { recursive: true });
    writeFileSync(
      join(sess, "summary.json"),
      JSON.stringify({
        generated_title: "Grok Session",
        updated_at: "2026-08-06T12:00:00Z",
        info: { id: SID },
      }),
    );
    const fs = createHostFs(realExec);
    const rows = await listGrok(fs, PROJ, { home });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, SID);
    assert.equal(rows[0].title, "Grok Session");
    assert.equal(rows[0].cli, "grok");
  });

  it("returns a plain array with sync exec (runScript dual-mode)", () => {
    const root = join(home, ".grok", "sessions", pathQuote(PROJ));
    const sess = join(root, SID);
    mkdirSync(sess, { recursive: true });
    writeFileSync(
      join(sess, "summary.json"),
      JSON.stringify({
        generated_title: "Sync Path",
        updated_at: "2026-08-06T12:00:00Z",
        info: { id: SID },
      }),
    );
    const fs = createHostFs(realExec);
    const rows = listGrok(fs, PROJ, { home });
    assert.equal(rows != null && typeof rows.then === "function", false);
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Sync Path");
  });
});

describe("listCursor", () => {
  let home;
  let prevHome;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-cursor-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists from md5(cwd)/meta.json", async () => {
    const hash = createHash("md5").update(PROJ, "utf8").digest("hex");
    const sess = join(home, ".cursor", "chats", hash, SID);
    mkdirSync(sess, { recursive: true });
    writeFileSync(
      join(sess, "meta.json"),
      JSON.stringify({ title: "Cursor Title", branch: "main", updatedAtMs: 1_700_000_000_000 }),
    );
    const fs = createHostFs(realExec);
    const rows = await listCursor(fs, PROJ, { home });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Cursor Title");
    assert.equal(rows[0].branch, "main");
  });
});

describe("listClaude", () => {
  let home;
  let prevHome;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-claude-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("filters by cwd and extracts title", async () => {
    const slug = slugify(PROJ);
    const projDir = join(home, ".claude", "projects", slug);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, `${SID}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          cwd: PROJ,
          gitBranch: "feat",
          message: { content: "hello claude" },
        }),
        JSON.stringify({ type: "custom-title", title: "My Claude" }),
      ].join("\n") + "\n",
    );
    // Wrong cwd session should be omitted
    writeFileSync(
      join(projDir, `${SID2}.jsonl`),
      JSON.stringify({ type: "user", cwd: OTHER, message: { content: "nope" } }) + "\n",
    );
    const fs = createHostFs(realExec);
    const rows = await listClaude(fs, PROJ, { home, claudeConfigDir: join(home, ".claude") });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, SID);
    assert.equal(rows[0].title, "My Claude");
    assert.equal(rows[0].branch, "feat");
  });
});

describe("listCodex", () => {
  let home;
  let prevHome;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-codex-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("reads highest state_N.sqlite", async () => {
    const codex = join(home, ".codex");
    mkdirSync(codex, { recursive: true });
    const db = join(codex, "state_2.sqlite");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        db,
        `CREATE TABLE threads (
          id TEXT, source TEXT, cwd TEXT, title TEXT, first_user_message TEXT,
          git_branch TEXT, updated_at_ms INTEGER, archived INTEGER
        );
        INSERT INTO threads VALUES (
          '${SID}', 'cli', '${PROJ}', 'Codex Title', NULL, 'main', 1700000000000, 0
        );`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    const rows = await listCodex(fs, PROJ, { codexHome: codex, sqliteAvailable: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Codex Title");
    assert.equal(rows[0].branch, "main");
  });

  it("falls back to JSONL rollouts when no DB", async () => {
    const codex = join(home, ".codex");
    const dir = join(codex, "sessions", "2026");
    mkdirSync(dir, { recursive: true });
    const fname = `rollout-2026-08-06T12-00-00-${SID}.jsonl`;
    writeFileSync(
      join(dir, fname),
      JSON.stringify({
        type: "session_meta",
        payload: { id: SID, cwd: PROJ, source: "cli", git: { branch: "dev" } },
      }) + "\n",
    );
    const fs = createHostFs(realExec);
    const rows = await listCodex(fs, PROJ, { codexHome: codex, sqliteAvailable: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, SID);
    assert.equal(rows[0].branch, "dev");
  });

  it("matches cwd with trailing slash (normPath)", async () => {
    const codex = join(home, ".codex");
    mkdirSync(codex, { recursive: true });
    const db = join(codex, "state_1.sqlite");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        db,
        `CREATE TABLE threads (
          id TEXT, source TEXT, cwd TEXT, title TEXT, first_user_message TEXT,
          git_branch TEXT, updated_at_ms INTEGER, archived INTEGER
        );
        INSERT INTO threads VALUES (
          '${SID}', 'cli', '${PROJ}/', 'Slash Title', NULL, 'main', 1700000000000, 0
        );`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    const rows = await listCodex(fs, PROJ, { codexHome: codex, sqliteAvailable: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Slash Title");
  });

  it("falls back to JSONL when DB is valid but empty for cwd", async () => {
    const codex = join(home, ".codex");
    mkdirSync(codex, { recursive: true });
    const db = join(codex, "state_1.sqlite");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        db,
        `CREATE TABLE threads (
          id TEXT, source TEXT, cwd TEXT, title TEXT, first_user_message TEXT,
          git_branch TEXT, updated_at_ms INTEGER, archived INTEGER
        );`,
      ],
      { encoding: "utf8" },
    );
    const dir = join(codex, "sessions", "2026");
    mkdirSync(dir, { recursive: true });
    const fname = `rollout-2026-08-06T12-00-00-${SID}.jsonl`;
    writeFileSync(
      join(dir, fname),
      JSON.stringify({
        type: "session_meta",
        payload: { id: SID, cwd: PROJ, source: "cli", git: { branch: "roll" } },
      }) + "\n",
    );
    const fs = createHostFs(realExec);
    const rows = await listCodex(fs, PROJ, { codexHome: codex, sqliteAvailable: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, SID);
    assert.equal(rows[0].branch, "roll");
  });
});

describe("buildCopilotProbeEntries", () => {
  it("always includes DB sids and limits residual when DB hits exist", () => {
    const entries = [];
    for (let i = 0; i < 50; i++) {
      entries.push({
        name: `aaaaaaaa-aaaa-aaaa-aaaa-${i.toString(16).padStart(12, "0")}`,
        kind: "dir",
        mtimeMs: 1_000 + i,
      });
    }
    const dbSid = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
    const probe = buildCopilotProbeEntries(entries, new Set([dbSid]));
    assert.ok(probe.some((e) => e.name === dbSid));
    // 1 DB + residual ≤ 20 when DB hits present
    assert.ok(probe.length <= 1 + 20);
    assert.ok(probe.length < entries.length);
  });

  it("uses full residual budget when DB set is empty", () => {
    const entries = [];
    for (let i = 0; i < COPILOT_MAX_STATE_DIRS + 30; i++) {
      entries.push({
        name: `bbbbbbbb-bbbb-bbbb-bbbb-${i.toString(16).padStart(12, "0")}`,
        kind: "dir",
        mtimeMs: 2_000 + i,
      });
    }
    const probe = buildCopilotProbeEntries(entries, new Set());
    assert.equal(probe.length, COPILOT_MAX_STATE_DIRS);
  });
});

describe("listCopilot", () => {
  let home;
  let prevHome;
  let prevCopilot;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-copilot-"));
    prevHome = process.env.HOME;
    prevCopilot = process.env.COPILOT_HOME;
    process.env.HOME = home;
    process.env.COPILOT_HOME = home;
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    if (prevCopilot === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = prevCopilot;
    rmSync(home, { recursive: true, force: true });
  });

  function sessionDir(sid, { cwd = PROJ, branch = "main", name, events } = {}) {
    const d = join(home, "session-state", sid);
    mkdirSync(join(d, "files"), { recursive: true });
    const lines = [`id: ${sid}`];
    if (cwd != null) lines.push(`cwd: ${cwd}`);
    if (branch) lines.push(`branch: ${branch}`);
    if (name) lines.push(`name: ${name}`);
    writeFileSync(join(d, "workspace.yaml"), lines.join("\n") + "\n");
    if (events != null) writeFileSync(join(d, "events.jsonl"), events);
    return d;
  }

  function writeStore({ sessions = [], turns = [], dataTitles } = {}) {
    const store = join(home, "session-store.db");
    const sql = [
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, branch TEXT, summary TEXT, updated_at TEXT);`,
      `CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INT, user_message TEXT);`,
    ];
    for (const [sid, cwd, summary] of sessions) {
      sql.push(
        `INSERT INTO sessions VALUES (${q(sid)}, ${q(cwd)}, 'main', ${q(summary)}, '2026-08-06T12:00:00Z');`,
      );
    }
    turns.forEach((sid, i) => {
      sql.push(
        `INSERT INTO turns (session_id, turn_index, user_message) VALUES (${q(sid)}, ${i}, 'hello');`,
      );
    });
    spawnSync("/usr/bin/sqlite3", [store, sql.join("\n")], { encoding: "utf8" });
    if (dataTitles) {
      const data = join(home, "data.db");
      const parts = [`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, updated_at TEXT);`];
      for (const [sid, title] of Object.entries(dataTitles)) {
        parts.push(
          `INSERT INTO sessions VALUES (${q(sid)}, ${q(title)}, '2026-08-06T12:00:00Z');`,
        );
      }
      spawnSync("/usr/bin/sqlite3", [data, parts.join("\n")], { encoding: "utf8" });
    }
  }

  function q(v) {
    if (v == null) return "NULL";
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  function ids(rows) {
    return new Set(rows.map((r) => r.id));
  }

  it("events nonempty + cwd match listed", async () => {
    sessionDir(SID, {
      events: '{"type":"user.message","data":{"content":"Fix the scanner"}}\n',
      name: "Weak",
    });
    writeStore({ sessions: [[SID, PROJ, "DB Title From Summary"]] });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.ok(ids(rows).has(SID));
  });

  it("turns only listed", async () => {
    const turnsOnly = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    sessionDir(turnsOnly, { cwd: PROJ });
    writeStore({
      sessions: [[turnsOnly, PROJ, "Turns only session"]],
      turns: [turnsOnly],
    });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.ok(ids(rows).has(turnsOnly));
  });

  it("empty shell omitted", async () => {
    const empty = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    sessionDir(empty, { cwd: PROJ });
    writeStore({ sessions: [[empty, PROJ, null]] });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.equal(ids(rows).has(empty), false);
  });

  it("optimistic-chat stub omitted", async () => {
    const sid = "optimistic-chat-e4b462a3-3628-4aad-90ae-43b9c4fee922";
    sessionDir(sid, {
      cwd: PROJ,
      events: '{"type":"user.message","data":{"content":"x"}}\n',
    });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.equal(ids(rows).has(sid), false);
  });

  it("missing cwd omitted", async () => {
    sessionDir(SID, {
      cwd: null,
      events: '{"type":"user.message","data":{"content":"hi"}}\n',
    });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.equal(ids(rows).has(SID), false);
  });

  it("other cwd omitted", async () => {
    sessionDir(SID2, {
      cwd: OTHER,
      events: '{"type":"user.message","data":{"content":"other"}}\n',
    });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.equal(ids(rows).has(SID2), false);
  });

  it("db title wins when strong", async () => {
    const dbId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    sessionDir(dbId, {
      cwd: PROJ,
      name: "Yaml Name",
      events: '{"type":"user.message","data":{"content":"first user line"}}\n',
    });
    writeStore({
      sessions: [[dbId, PROJ, "Store Summary Title"]],
      turns: [dbId],
      dataTitles: { [dbId]: "Desktop DB Title" },
    });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    const hit = rows.find((r) => r.id === dbId);
    assert.ok(hit);
    assert.equal(hit.title, "Desktop DB Title");
  });

  it("db-only without evidence omitted", async () => {
    const data = join(home, "data.db");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        data,
        `CREATE TABLE sessions (id TEXT, title TEXT, updated_at TEXT);
         CREATE TABLE workspaces (session_id TEXT, cwd TEXT, branch TEXT);
         INSERT INTO sessions VALUES ('${SID}', 'Orphan', '2026-08-06T12:00:00Z');
         INSERT INTO workspaces VALUES ('${SID}', '${PROJ}', 'main');`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.equal(rows.length, 0);
  });

  function uuidAt(i) {
    const hex = i.toString(16).padStart(12, "0");
    return `cccccccc-cccc-cccc-cccc-${hex}`;
  }

  it("multi-project flood: DB-first returns all project sessions, zero foreign", async () => {
    const { utimesSync } = await import("node:fs");
    const projectCount = 40;
    const foreignCount = 120;
    const projectSids = [];
    const foreignSids = [];
    const storeSessions = [];
    const storeTurns = [];

    // Older project sessions (low mtime) — would be dropped by global mtime top-100.
    for (let i = 0; i < projectCount; i++) {
      const sid = uuidAt(i);
      projectSids.push(sid);
      const d = sessionDir(sid, {
        cwd: PROJ,
        events: `{"type":"user.message","data":{"content":"proj ${i}"}}\n`,
        name: `Proj ${i}`,
      });
      const t = new Date(2020, 0, 1, 0, 0, i);
      utimesSync(d, t, t);
      storeSessions.push([sid, PROJ, `Project ${i}`]);
      storeTurns.push(sid);
    }

    // Many newer foreign sessions dominate global mtime.
    for (let i = 0; i < foreignCount; i++) {
      const sid = uuidAt(1000 + i);
      foreignSids.push(sid);
      const d = sessionDir(sid, {
        cwd: OTHER,
        events: `{"type":"user.message","data":{"content":"foreign ${i}"}}\n`,
        name: `Foreign ${i}`,
      });
      const t = new Date(2026, 5, 1, 0, 0, i);
      utimesSync(d, t, t);
      storeSessions.push([sid, OTHER, `Foreign ${i}`]);
      storeTurns.push(sid);
    }

    writeStore({ sessions: storeSessions, turns: storeTurns });

    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    const got = ids(rows);
    assert.equal(rows.length, projectCount, `expected ${projectCount} project sessions`);
    for (const sid of projectSids) {
      assert.ok(got.has(sid), `missing project session ${sid}`);
    }
    for (const sid of foreignSids) {
      assert.equal(got.has(sid), false, `foreign session leaked: ${sid}`);
    }
  });

  it("no silent 25-cap: returns more than PER_GROUP_CAP for one project", async () => {
    const { PER_GROUP_CAP } = await import("../src/lib/sessions/scan/helpers.js");
    const n = PER_GROUP_CAP + 10;
    const storeSessions = [];
    const storeTurns = [];
    for (let i = 0; i < n; i++) {
      const sid = uuidAt(i);
      sessionDir(sid, {
        cwd: PROJ,
        events: `{"type":"user.message","data":{"content":"s ${i}"}}\n`,
      });
      storeSessions.push([sid, PROJ, `S ${i}`]);
      storeTurns.push(sid);
    }
    writeStore({ sessions: storeSessions, turns: storeTurns });
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.equal(rows.length, n);
    assert.ok(rows.length > PER_GROUP_CAP);
  });

  it("DB index matches trailing-slash cwd form under foreign flood", async () => {
    const { utimesSync } = await import("node:fs");
    const target = uuidAt(7);
    const d = sessionDir(target, {
      cwd: PROJ,
      events: '{"type":"user.message","data":{"content":"slash"}}\n',
    });
    const t = new Date(2018, 0, 1);
    utimesSync(d, t, t);
    // DB stores trailing slash; yaml uses PROJ without slash.
    const store = join(home, "session-store.db");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        store,
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, branch TEXT, summary TEXT, updated_at TEXT);
         CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INT, user_message TEXT);
         INSERT INTO sessions VALUES ('${target}', '${PROJ}/', 'main', 'Slash', '2026-01-01T00:00:00Z');
         INSERT INTO turns (session_id, turn_index, user_message) VALUES ('${target}', 0, 'hi');`,
      ],
      { encoding: "utf8" },
    );
    for (let i = 0; i < 110; i++) {
      const sid = uuidAt(3000 + i);
      const fd = sessionDir(sid, {
        cwd: OTHER,
        events: '{"type":"user.message","data":{"content":"f"}}\n',
      });
      utimesSync(fd, new Date(2026, 6, 1, 0, 0, i % 60), new Date(2026, 6, 1, 0, 0, i % 60));
    }
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, { copilotHome: home, sqliteAvailable: true });
    assert.ok(ids(rows).has(target));
  });

  it("sqliteAvailable false: residual mtime wave still finds recent project sessions", async () => {
    const { utimesSync } = await import("node:fs");
    // A few project dirs with recent mtime + foreign older ones.
    const target = uuidAt(1);
    const d = sessionDir(target, {
      cwd: PROJ,
      events: '{"type":"user.message","data":{"content":"target"}}\n',
    });
    utimesSync(d, new Date(2026, 6, 1), new Date(2026, 6, 1));
    for (let i = 0; i < 5; i++) {
      const sid = uuidAt(50 + i);
      const fd = sessionDir(sid, {
        cwd: OTHER,
        events: '{"type":"user.message","data":{"content":"f"}}\n',
      });
      utimesSync(fd, new Date(2020, 0, i + 1), new Date(2020, 0, i + 1));
    }
    const fs = createHostFs(realExec);
    const rows = await listCopilot(fs, PROJ, {
      copilotHome: home,
      sqliteAvailable: false,
    });
    assert.ok(ids(rows).has(target));
    assert.equal(
      rows.every((r) => r.cwd === PROJ),
      true,
    );
  });
});
