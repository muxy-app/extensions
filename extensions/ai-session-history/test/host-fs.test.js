import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHostFs,
  ensureHostTools,
  resetHostToolsProbe,
  normalizeExecResult,
  expandUserPath,
  HOST_BINS,
  sqlQuote,
  joinPath,
} from "../src/lib/host-fs.js";

/** Real host exec for integration-style tests. */
function realExec(argv, opts = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    input: opts.stdin,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 15000,
    env: process.env,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function mockExec(handlers) {
  return (argv, opts = {}) => {
    const key = argv.join(" ");
    for (const h of handlers) {
      if (h.match(argv, opts)) return h.handle(argv, opts);
    }
    throw new Error(`unexpected exec: ${key}`);
  };
}

describe("host-fs mock argv contracts", () => {
  beforeEach(() => resetHostToolsProbe());

  it("normalizeExecResult fails closed for missing/non-numeric codes", () => {
    assert.equal(normalizeExecResult(undefined).exitCode, 1);
    assert.equal(normalizeExecResult(null).exitCode, 1);
    assert.equal(normalizeExecResult({}).exitCode, 1);
    assert.equal(normalizeExecResult({ stdout: "x" }).exitCode, 1);
    assert.equal(normalizeExecResult({ exitCode: 0 }).exitCode, 0);
    assert.equal(normalizeExecResult({ code: 2 }).exitCode, 2);
    assert.equal(normalizeExecResult({ exitCode: "0" }).exitCode, 1);
  });

  it("expandUserPath resolves ~ and relative under home", () => {
    assert.equal(expandUserPath("~/foo", "/Users/a"), "/Users/a/foo");
    assert.equal(expandUserPath("rel", "/Users/a"), "/Users/a/rel");
    assert.equal(expandUserPath("/abs/x", "/Users/a"), "/abs/x");
    assert.equal(expandUserPath("/abs/x/", "/Users/a"), "/abs/x");
    assert.equal(expandUserPath(null, "/Users/a"), null);
  });

  it("readText uses /bin/cat with -- before path", async () => {
    const exec = mockExec([
      {
        match: (argv) => argv[0] === HOST_BINS.cat,
        handle: (argv) => {
          assert.deepEqual(argv, [HOST_BINS.cat, "--", "/tmp/x"]);
          return { stdout: "hello", stderr: "", exitCode: 0 };
        },
      },
    ]);
    const fs = createHostFs(exec);
    assert.equal(await fs.readText("/tmp/x"), "hello");
  });

  it("readText treats missing exitCode as failure", () => {
    const exec = mockExec([
      {
        match: (argv) => argv[0] === HOST_BINS.cat,
        handle: () => ({ stdout: "", stderr: "" }),
      },
    ]);
    const fs = createHostFs(exec);
    assert.throws(() => fs.readText("/tmp/x"), /exit 1|readText/i);
  });

  it("readHead uses /usr/bin/head -c with -- before path", async () => {
    const exec = mockExec([
      {
        match: (argv) => argv[0] === HOST_BINS.head,
        handle: (argv) => {
          assert.deepEqual(argv, [HOST_BINS.head, "-c", "100", "--", "/f"]);
          return { stdout: "ab", stderr: "", exitCode: 0 };
        },
      },
    ]);
    const fs = createHostFs(exec);
    assert.equal(await fs.readHead("/f", { maxBytes: 100 }), "ab");
  });

  it("writeAtomic uses tee then mv", async () => {
    const calls = [];
    const exec = mockExec([
      {
        match: (argv) => argv[0] === HOST_BINS.mkdir,
        handle: (argv) => {
          calls.push(argv);
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
      {
        match: (argv) => argv[0] === HOST_BINS.tee,
        handle: (argv, opts) => {
          calls.push([...argv, opts.stdin]);
          assert.equal(opts.stdin, "body");
          return { stdout: "body", stderr: "", exitCode: 0 };
        },
      },
      {
        match: (argv) => argv[0] === HOST_BINS.mv,
        handle: (argv) => {
          calls.push(argv);
          assert.equal(argv[1], "-f");
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    ]);
    const fs = createHostFs(exec);
    await fs.writeAtomic("/tmp/dir/file.json", "body");
    assert.ok(calls.some((c) => c[0] === HOST_BINS.tee));
    assert.ok(calls.some((c) => c[0] === HOST_BINS.mv));
  });

  it("sqliteQuery uses -readonly -json", async () => {
    const exec = mockExec([
      {
        match: (argv) => argv[0] === HOST_BINS.sqlite3,
        handle: (argv) => {
          assert.ok(argv.includes("-readonly"));
          assert.ok(argv.includes("-json"));
          return {
            stdout: JSON.stringify([{ id: "1" }]),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    ]);
    const fs = createHostFs(exec);
    const rows = await fs.sqliteQuery("/tmp/db", "SELECT 1");
    assert.equal(rows[0].id, "1");
  });

  it("ensureHostTools probes required binaries via ls (incl. printenv)", async () => {
    const probed = [];
    const exec = mockExec([
      {
        match: (argv) => argv[0] === HOST_BINS.ls,
        handle: (argv) => {
          // argv: [ls, --, bin]
          const bin = argv[argv.length - 1];
          probed.push(bin);
          return { stdout: bin, stderr: "", exitCode: 0 };
        },
      },
    ]);
    assert.equal(await ensureHostTools(exec), true);
    assert.ok(probed.includes(HOST_BINS.cat));
    assert.ok(probed.includes(HOST_BINS.ls));
    assert.ok(probed.includes(HOST_BINS.printenv));
  });

  it("ensureHostTools optional probe rejection does not throw", async () => {
    const exec = (argv) => {
      if (argv[0] === HOST_BINS.ls && argv.includes(HOST_BINS.sqlite3)) {
        return Promise.reject(new Error("spawn failed"));
      }
      if (argv[0] === HOST_BINS.ls) {
        return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    };
    assert.equal(await ensureHostTools(exec), true);
    // Give microtask queue a tick so swallowed rejection would surface if unhandled.
    await new Promise((r) => setTimeout(r, 10));
  });

  it("sqlQuote escapes single quotes", () => {
    assert.equal(sqlQuote("a'b"), "'a''b'");
  });

  it("joinPath joins POSIX segments", () => {
    assert.equal(joinPath("/Users/a", ".grok", "x"), "/Users/a/.grok/x");
  });

  it("thenables-aware: async exec returns promises", async () => {
    const exec = async (argv) => {
      if (argv[0] === HOST_BINS.cat) {
        return { stdout: "async", stderr: "", exitCode: 0 };
      }
      throw new Error("bad");
    };
    const fs = createHostFs(exec);
    const p = fs.readText("/x");
    assert.equal(typeof p.then, "function");
    assert.equal(await p, "async");
  });

  it("removePath refuses root, traversal, and outside root", async () => {
    const fs = createHostFs(() => ({ stdout: "", stderr: "", exitCode: 0 }));
    assert.throws(() => fs.removePath("/"), /root/i);
    assert.throws(() => fs.removePath("/tmp/../etc"), /traversal/i);
    assert.throws(() => fs.removePath("/tmp/evil", { root: "/Users/me" }), /outside/i);
  });
});

describe("host-fs real tools", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "host-fs-"));
    resetHostToolsProbe();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips writeAtomic + readText", async () => {
    const fs = createHostFs(realExec);
    const path = join(dir, "nested", "f.txt");
    await fs.writeAtomic(path, "hello world\n");
    assert.equal(await fs.readText(path), "hello world\n");
    assert.equal(existsSync(path + ".tmp"), false);
  });

  it("listDir / isFile / mtimeMs", async () => {
    const fs = createHostFs(realExec);
    writeFileSync(join(dir, "a.txt"), "x");
    mkdirSync(join(dir, "sub"));
    const names = await fs.listDir(dir);
    assert.ok(names.includes("a.txt"));
    assert.ok(names.includes("sub"));
    assert.equal(await fs.isFile(join(dir, "a.txt")), true);
    assert.equal(await fs.isDir(join(dir, "sub")), true);
    assert.ok((await fs.mtimeMs(join(dir, "a.txt"))) > 0);
  });

  it("listDirDetailed returns kind + mtime for entries", async () => {
    const fs = createHostFs(realExec);
    writeFileSync(join(dir, "a.txt"), "x");
    mkdirSync(join(dir, "sub"));
    const entries = await fs.listDirDetailed(dir);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    assert.equal(byName["a.txt"]?.kind, "file");
    assert.equal(byName.sub?.kind, "dir");
    assert.ok((byName["a.txt"]?.mtimeMs || 0) > 0);
  });

  it("listDirDetailed missing dir returns empty array", async () => {
    const fs = createHostFs(realExec);
    const entries = await fs.listDirDetailed(join(dir, "does-not-exist"));
    assert.deepEqual(entries, []);
  });

  it("isDir treats symlink-to-directory as dir", async () => {
    const fs = createHostFs(realExec);
    const target = join(dir, "real-dir");
    const link = join(dir, "link-to-dir");
    mkdirSync(target);
    symlinkSync(target, link);
    assert.equal(await fs.isDir(link), true, "symlink-to-dir should be a dir");
    assert.equal(await fs.isDir(target), true, "real dir should be a dir");
  });

  it("listDirDetailed treats symlink-to-directory as kind=dir", async () => {
    const fs = createHostFs(realExec);
    const target = join(dir, "real-dir");
    const link = "link-to-dir";
    mkdirSync(target);
    symlinkSync(target, join(dir, link));
    const entries = await fs.listDirDetailed(dir);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    assert.equal(byName[link]?.kind, "dir", "symlink-to-dir should report kind=dir");
  });

  it("sqliteQuery readonly", async () => {
    const fs = createHostFs(realExec);
    const db = join(dir, "t.sqlite");
    spawnSync("/usr/bin/sqlite3", [db, "CREATE TABLE t(id TEXT); INSERT INTO t VALUES('ok');"], {
      encoding: "utf8",
    });
    const rows = await fs.sqliteQuery(db, "SELECT id FROM t");
    assert.equal(rows[0].id, "ok");
  });
});
