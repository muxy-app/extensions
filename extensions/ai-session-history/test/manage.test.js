import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostFs } from "../src/lib/host-fs.js";
import { renameSessionJs, deleteSessionJs } from "../src/lib/sessions/manage/index.js";
import { listCopilot } from "../src/lib/sessions/scan/copilot.js";
import { pathQuote, slugify, resolveTitleLikeColumn } from "../src/lib/sessions/scan/helpers.js";

const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SID2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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

describe("manage rename/delete", () => {
  let home;
  let prevEnv;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "manage-"));
    prevEnv = { ...process.env };
    process.env.HOME = home;
    delete process.env.CODEX_HOME;
    delete process.env.COPILOT_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;
  });
  afterEach(() => {
    process.env = prevEnv;
    rmSync(home, { recursive: true, force: true });
  });

  it("rename grok round-trip", async () => {
    const proj = join(home, ".grok", "sessions", pathQuote("/tmp/proj"));
    const session = join(proj, SID);
    mkdirSync(session, { recursive: true });
    const summary = join(session, "summary.json");
    writeFileSync(
      summary,
      JSON.stringify({ generated_title: "Old", info: { id: SID } }),
    );
    const fs = createHostFs(realExec);
    const title = 'New multi-word "quoted" café';
    await renameSessionJs(fs, "grok", SID, title);
    const loaded = JSON.parse(readFileSync(summary, "utf8"));
    assert.equal(loaded.generated_title, title);
    assert.equal(existsSync(summary + ".tmp"), false);
  });

  it("rename grok missing errors", async () => {
    const fs = createHostFs(realExec);
    await assert.rejects(() => renameSessionJs(fs, "grok", SID, "X"), /not found/i);
  });

  it("rename cursor round-trip", async () => {
    const session = join(home, ".cursor", "chats", "projhash", SID);
    mkdirSync(session, { recursive: true });
    const meta = join(session, "meta.json");
    writeFileSync(meta, JSON.stringify({ title: "Old" }));
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "cursor", SID, "Cursor New");
    assert.equal(JSON.parse(readFileSync(meta, "utf8")).title, "Cursor New");
  });

  it("rename codex round-trip", async () => {
    const codex = join(home, ".codex");
    mkdirSync(codex);
    const db = join(codex, "state_1.sqlite");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        db,
        `CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, cwd TEXT, source TEXT, archived INT);
         INSERT INTO threads VALUES ('${SID}', 'Old', '/tmp', 'cli', 0);`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "codex", SID, "Codex Title");
    const out = spawnSync("/usr/bin/sqlite3", [db, `SELECT title FROM threads WHERE id='${SID}'`], {
      encoding: "utf8",
    });
    assert.equal(out.stdout.trim(), "Codex Title");
  });

  it("rename copilot multi-target", async () => {
    const state = join(home, ".copilot", "session-state", SID);
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "workspace.yaml"), `id: ${SID}\ncwd: /tmp/p\nname: OldName\n`);
    writeFileSync(join(state, "meta.json"), JSON.stringify({ title: "Old" }));
    const dataDb = join(home, ".copilot", "data.db");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        dataDb,
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
         INSERT INTO sessions VALUES ('${SID}', 'OldDb');`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "copilot", SID, "Copilot Fresh");
    const title = spawnSync(
      "/usr/bin/sqlite3",
      [dataDb, `SELECT title FROM sessions WHERE id='${SID}'`],
      { encoding: "utf8" },
    ).stdout.trim();
    assert.equal(title, "Copilot Fresh");
    const yamlMulti = readFileSync(join(state, "workspace.yaml"), "utf8");
    assert.match(yamlMulti, /name: "Copilot Fresh"/);
    assert.match(yamlMulti, /user_named:\s*true/);
    const meta = JSON.parse(readFileSync(join(state, "meta.json"), "utf8"));
    assert.equal(meta.title, "Copilot Fresh");
    assert.equal(meta.name, "Copilot Fresh");
    assert.ok(existsSync(state));
  });


  it("rename copilot writes summary on session-store.db (production shape)", async () => {
    const state = join(home, ".copilot", "session-state", SID);
    mkdirSync(state, { recursive: true });
    writeFileSync(
      join(state, "workspace.yaml"),
      `id: ${SID}\ncwd: /tmp/p\nname: OldYaml\nuser_named: false\n`,
    );
    writeFileSync(join(state, "meta.json"), JSON.stringify({ title: "OldMeta" }));
    writeFileSync(join(state, "events.jsonl"), '{"type":"user.message","data":{"content":"hi"}}\n');
    const storeDb = join(home, ".copilot", "session-store.db");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        storeDb,
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, cwd TEXT, updated_at TEXT);
         CREATE TABLE turns (id INTEGER PRIMARY KEY, session_id TEXT);
         INSERT INTO sessions VALUES ('${SID}', 'Old Summary', '/tmp/p', '2026-08-06T12:00:00Z');
         INSERT INTO turns VALUES (1, '${SID}');`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "copilot", SID, "Renamed From Summary");
    const summary = spawnSync(
      "/usr/bin/sqlite3",
      [storeDb, `SELECT summary FROM sessions WHERE id='${SID}'`],
      { encoding: "utf8" },
    ).stdout.trim();
    assert.equal(summary, "Renamed From Summary");
    const yaml = readFileSync(join(state, "workspace.yaml"), "utf8");
    assert.match(yaml, /name: "Renamed From Summary"/);
    assert.match(yaml, /user_named:\s*true/);
    const meta = JSON.parse(readFileSync(join(state, "meta.json"), "utf8"));
    assert.equal(meta.title, "Renamed From Summary");
    assert.equal(meta.name, "Renamed From Summary");
  });

  it("rename copilot then listCopilot returns new title (summary store)", async () => {
    const PROJ = "/tmp/copilot-proj";
    const state = join(home, ".copilot", "session-state", SID);
    mkdirSync(state, { recursive: true });
    writeFileSync(
      join(state, "workspace.yaml"),
      `id: ${SID}\ncwd: ${PROJ}\nbranch: main\nname: Yaml Old\n`,
    );
    writeFileSync(
      join(state, "events.jsonl"),
      '{"type":"user.message","data":{"content":"first user"}}\n',
    );
    const storeDb = join(home, ".copilot", "session-store.db");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        storeDb,
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT, cwd TEXT, branch TEXT, updated_at TEXT);
         CREATE TABLE turns (id INTEGER PRIMARY KEY, session_id TEXT);
         INSERT INTO sessions VALUES ('${SID}', 'Old Summary Title', '${PROJ}', 'main', '2026-08-06T12:00:00Z');
         INSERT INTO turns VALUES (1, '${SID}');`,
      ],
      { encoding: "utf8" },
    );
    const fs = createHostFs(realExec);
    await renameSessionJs(fs, "copilot", SID, "Persisted New Title");
    const rows = await listCopilot(fs, PROJ, {
      copilotHome: join(home, ".copilot"),
      sqliteAvailable: true,
    });
    const hit = rows.find((r) => r.id === SID);
    assert.ok(hit, "session should list after rename");
    assert.equal(hit.title, "Persisted New Title");
  });


  it("rename copilot fails loud when authoritative DB UPDATE fails", async () => {
    const state = join(home, ".copilot", "session-state", SID);
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "workspace.yaml"), `id: ${SID}\ncwd: /tmp/p\nname: OldYaml\n`);
    writeFileSync(join(state, "meta.json"), JSON.stringify({ title: "OldMeta" }));
    const storeDb = join(home, ".copilot", "session-store.db");
    spawnSync(
      "/usr/bin/sqlite3",
      [
        storeDb,
        `CREATE TABLE sessions (id TEXT PRIMARY KEY, summary TEXT);
         INSERT INTO sessions VALUES ('${SID}', 'Old Summary');`,
      ],
      { encoding: "utf8" },
    );
    const base = createHostFs(realExec);
    const fs = {
      ...base,
      sqliteExec(dbPath, sql) {
        if (String(sql).includes("UPDATE sessions")) {
          return Promise.reject(new Error("simulated UPDATE failure"));
        }
        return base.sqliteExec(dbPath, sql);
      },
    };
    await assert.rejects(
      () => renameSessionJs(fs, "copilot", SID, "Should Not Persist"),
      /Could not rename Copilot session/i,
    );
    const summary = spawnSync(
      "/usr/bin/sqlite3",
      [storeDb, `SELECT summary FROM sessions WHERE id='${SID}'`],
      { encoding: "utf8" },
    ).stdout.trim();
    assert.equal(summary, "Old Summary");
    assert.match(readFileSync(join(state, "workspace.yaml"), "utf8"), /name: OldYaml/);
    assert.equal(JSON.parse(readFileSync(join(state, "meta.json"), "utf8")).title, "OldMeta");
  });

  it("resolveTitleLikeColumn prefers title then summary then name", () => {
    assert.equal(resolveTitleLikeColumn(new Set(["summary", "name"])), "summary");
    assert.equal(resolveTitleLikeColumn(new Set(["name"])), "name");
    assert.equal(resolveTitleLikeColumn(new Set(["title", "summary"])), "title");
    assert.equal(resolveTitleLikeColumn(new Set(["id"])), null);
  });

  it("rename claude unsupported", async () => {
    const fs = createHostFs(realExec);
    await assert.rejects(
      () => renameSessionJs(fs, "claude", SID, "Nope"),
      /not supported/i,
    );
  });

  it("delete grok", async () => {
    const session = join(home, ".grok", "sessions", "proj", SID);
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, "summary.json"), "{}");
    const fs = createHostFs(realExec);
    await deleteSessionJs(fs, "grok", SID);
    assert.equal(existsSync(session), false);
  });

  it("delete claude", async () => {
    const slug = slugify("/tmp/p");
    const file = join(home, ".claude", "projects", slug, `${SID}.jsonl`);
    mkdirSync(join(home, ".claude", "projects", slug), { recursive: true });
    writeFileSync(file, "{}\n");
    const fs = createHostFs(realExec);
    await deleteSessionJs(fs, "claude", SID, "/tmp/p");
    assert.equal(existsSync(file), false);
  });

  it("delete cursor", async () => {
    const session = join(home, ".cursor", "chats", "h", SID);
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, "meta.json"), "{}");
    const fs = createHostFs(realExec);
    await deleteSessionJs(fs, "cursor", SID);
    assert.equal(existsSync(session), false);
  });

  it("rejects empty title and invalid id", async () => {
    const fs = createHostFs(realExec);
    await assert.rejects(() => renameSessionJs(fs, "grok", SID, "   "), /empty/i);
    await assert.rejects(() => renameSessionJs(fs, "grok", "short", "X"), /invalid/i);
  });
});
