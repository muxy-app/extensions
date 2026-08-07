import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostFs } from "../src/lib/host-fs.js";
import { listGrok } from "../src/lib/sessions/scan/grok.js";
import { listClaude } from "../src/lib/sessions/scan/claude.js";
import { listCodex } from "../src/lib/sessions/scan/codex.js";
import { listCopilot } from "../src/lib/sessions/scan/copilot.js";
import {
  pathQuote,
  slugify,
  PER_GROUP_CAP,
  COPILOT_MAX_STATE_DIRS,
} from "../src/lib/sessions/scan/helpers.js";
import { countingExec } from "./helpers/counting-exec.js";

const PROJ = "/tmp/muxy-budget-proj";
const N = 40;

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

function uuidAt(i) {
  const hex = i.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-aaaa-aaaa-${hex}`;
}

describe("scan exec budgets (amplification)", () => {
  let home;
  let prevHome;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-budget-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("listGrok N=40 stays under budget and returns PER_GROUP_CAP", async () => {
    const root = join(home, ".grok", "sessions", pathQuote(PROJ));
    for (let i = 0; i < N; i++) {
      const sid = uuidAt(i);
      const sess = join(root, sid);
      mkdirSync(sess, { recursive: true });
      writeFileSync(
        join(sess, "summary.json"),
        JSON.stringify({
          generated_title: `Grok ${i}`,
          updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          info: { id: sid },
        }),
      );
      // Distinct mtimes for ranking
      const t = new Date(2026, 0, 1, 0, 0, i);
      utimesSync(sess, t, t);
    }

    const exec = countingExec(realExec);
    const fs = createHostFs(exec);
    const rows = await listGrok(fs, PROJ, { home });
    assert.equal(rows.length, PER_GROUP_CAP);
    // listDir + batched stat + at most cap+slack readText (no per-child isDir/isFile/mtime)
    assert.ok(
      exec.calls.length <= 50,
      `expected ≤50 execs, got ${exec.calls.length}`,
    );
  });

  it("listClaude with many foreign jsonl only enriches capped set", async () => {
    const base = join(home, ".claude");
    const projects = join(base, "projects");
    const expected = join(projects, slugify(PROJ));
    mkdirSync(expected, { recursive: true });

    for (let i = 0; i < N; i++) {
      const sid = uuidAt(i);
      const path = join(expected, `${sid}.jsonl`);
      writeFileSync(
        path,
        JSON.stringify({
          type: "user",
          message: { content: `msg ${i}` },
          cwd: PROJ,
        }) + "\n",
      );
      const t = new Date(2026, 0, 1, 0, 0, i);
      utimesSync(path, t, t);
    }

    // Foreign project with many jsonl that should not all be head-read
    const foreign = join(projects, "other-project");
    mkdirSync(foreign, { recursive: true });
    for (let i = 0; i < N; i++) {
      const sid = uuidAt(1000 + i);
      writeFileSync(
        join(foreign, `${sid}.jsonl`),
        JSON.stringify({
          type: "user",
          message: { content: "foreign" },
          cwd: "/tmp/other",
        }) + "\n",
      );
    }

    const exec = countingExec(realExec);
    const fs = createHostFs(exec);
    const rows = await listClaude(fs, PROJ, { home, claudeConfigDir: base });
    assert.equal(rows.length, PER_GROUP_CAP);

    const headCalls = exec.countWhere((a) => a[0] === "/usr/bin/head");
    // Only cap+slack heads, not N*2 projects
    assert.ok(
      headCalls <= PER_GROUP_CAP + 15,
      `expected ≤${PER_GROUP_CAP + 15} head calls, got ${headCalls}`,
    );
    assert.ok(
      exec.calls.length <= 60,
      `expected ≤60 total execs, got ${exec.calls.length}`,
    );
  });

  it("listCodex file fallback ranks before reading all rollouts", async () => {
    const codexHome = join(home, ".codex");
    const sessions = join(codexHome, "sessions", "2026", "01");
    mkdirSync(sessions, { recursive: true });
    for (let i = 0; i < N; i++) {
      const sid = uuidAt(i);
      const name = `rollout-2026-01-01T00-00-${String(i).padStart(2, "0")}-${sid}.jsonl`;
      const path = join(sessions, name);
      writeFileSync(
        path,
        JSON.stringify({
          type: "session_meta",
          payload: { id: sid, cwd: PROJ, source: "cli" },
        }) + "\n",
      );
      const t = new Date(2026, 0, 1, 0, 0, i);
      utimesSync(path, t, t);
    }

    const exec = countingExec(realExec);
    const fs = createHostFs(exec);
    const rows = await listCodex(fs, PROJ, {
      home,
      codexHome,
      sqliteAvailable: false,
    });
    assert.equal(rows.length, PER_GROUP_CAP);
    const headCalls = exec.countWhere((a) => a[0] === "/usr/bin/head");
    assert.ok(
      headCalls <= PER_GROUP_CAP + 15,
      `expected capped head calls, got ${headCalls}`,
    );
  });

  it("listCopilot multi-project flood stays under budget with DB path columns", async () => {
    const copilotHome = join(home, ".copilot");
    const state = join(copilotHome, "session-state");
    mkdirSync(state, { recursive: true });

    const projectCount = 35;
    const foreignCount = 150;
    const projectSids = [];
    const sql = [
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, branch TEXT, summary TEXT, updated_at TEXT);`,
      `CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INT, user_message TEXT);`,
    ];

    function q(v) {
      if (v == null) return "NULL";
      return `'${String(v).replace(/'/g, "''")}'`;
    }

    for (let i = 0; i < projectCount; i++) {
      const sid = uuidAt(i);
      projectSids.push(sid);
      const d = join(state, sid);
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, "workspace.yaml"),
        `id: ${sid}\ncwd: ${PROJ}\nbranch: main\nname: Proj ${i}\n`,
      );
      writeFileSync(
        join(d, "events.jsonl"),
        `{"type":"user.message","data":{"content":"p ${i}"}}\n`,
      );
      // Old mtimes — outside a global top-100 window of foreign dirs.
      const t = new Date(2019, 0, 1, 0, 0, i);
      utimesSync(d, t, t);
      sql.push(
        `INSERT INTO sessions VALUES (${q(sid)}, ${q(PROJ)}, 'main', ${q(`P${i}`)}, '2026-01-01T00:00:00Z');`,
      );
      sql.push(
        `INSERT INTO turns (session_id, turn_index, user_message) VALUES (${q(sid)}, 0, 'hi');`,
      );
    }

    for (let i = 0; i < foreignCount; i++) {
      const sid = uuidAt(2000 + i);
      const d = join(state, sid);
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, "workspace.yaml"),
        `id: ${sid}\ncwd: /tmp/other\nbranch: main\nname: F ${i}\n`,
      );
      writeFileSync(
        join(d, "events.jsonl"),
        `{"type":"user.message","data":{"content":"f"}}\n`,
      );
      const t = new Date(2026, 6, 1, 0, 0, i % 60);
      utimesSync(d, t, t);
      sql.push(
        `INSERT INTO sessions VALUES (${q(sid)}, ${q("/tmp/other")}, 'main', ${q(`F${i}`)}, '2026-06-01T00:00:00Z');`,
      );
    }

    const store = join(copilotHome, "session-store.db");
    spawnSync("/usr/bin/sqlite3", [store, sql.join("\n")], { encoding: "utf8" });

    const exec = countingExec(realExec);
    const fs = createHostFs(exec);
    const rows = await listCopilot(fs, PROJ, {
      copilotHome,
      sqliteAvailable: true,
    });

    assert.equal(rows.length, projectCount);
    const got = new Set(rows.map((r) => r.id));
    for (const sid of projectSids) {
      assert.ok(got.has(sid), `missing ${sid}`);
    }

    // Expensive probes: listDirDetailed (ls+stat) is cheap; per-dir reads use head
    // (yaml/meta/events) and skip dual-stat fileSize. Budget = project + residual.
    const catCalls = exec.countWhere((a) => a[0] === "/bin/cat");
    const headCalls = exec.countWhere((a) => a[0] === "/usr/bin/head");
    const residualWhenDbHits = Math.min(20, COPILOT_MAX_STATE_DIRS);
    const maxProbes = projectCount + residualWhenDbHits;
    // Prefer head over full cat for metadata (P1 exec budget).
    assert.ok(
      catCalls <= 5,
      `expected almost no full cat reads, got cat=${catCalls}`,
    );
    assert.ok(
      headCalls <= maxProbes * 3 + 20,
      `expected bounded head reads, got head=${headCalls}`,
    );
    assert.ok(
      exec.calls.length < 450,
      `expected under budget exec count, got ${exec.calls.length}`,
    );
  });

  it("listCopilot N≈40 stays under hard exec ceiling", async () => {
    const copilotHome = join(home, ".copilot");
    const state = join(copilotHome, "session-state");
    mkdirSync(state, { recursive: true });
    const n = 40;
    const sql = [
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, branch TEXT, summary TEXT, updated_at TEXT);`,
      `CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, turn_index INT, user_message TEXT);`,
    ];
    function q(v) {
      if (v == null) return "NULL";
      return `'${String(v).replace(/'/g, "''")}'`;
    }
    for (let i = 0; i < n; i++) {
      const sid = uuidAt(i);
      const d = join(state, sid);
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, "workspace.yaml"),
        `id: ${sid}\ncwd: ${PROJ}\nbranch: main\nname: S ${i}\n`,
      );
      writeFileSync(
        join(d, "events.jsonl"),
        `{"type":"user.message","data":{"content":"m ${i}"}}\n`,
      );
      const t = new Date(2026, 0, 1, 0, 0, i);
      utimesSync(d, t, t);
      sql.push(
        `INSERT INTO sessions VALUES (${q(sid)}, ${q(PROJ)}, 'main', ${q(`S${i}`)}, '2026-01-01T00:00:00Z');`,
      );
      sql.push(
        `INSERT INTO turns (session_id, turn_index, user_message) VALUES (${q(sid)}, 0, 'hi');`,
      );
    }
    const store = join(copilotHome, "session-store.db");
    spawnSync("/usr/bin/sqlite3", [store, sql.join("\n")], { encoding: "utf8" });

    const exec = countingExec(realExec);
    const fs = createHostFs(exec);
    const rows = await listCopilot(fs, PROJ, {
      copilotHome,
      sqliteAvailable: true,
    });
    assert.equal(rows.length, n);
    // Hard ceiling: listDirDetailed per probe + up to 3 heads; no dual-stat fileSize.
    assert.ok(
      exec.calls.length <= 280,
      `expected ≤280 execs for N=${n}, got ${exec.calls.length}`,
    );
  });
});
