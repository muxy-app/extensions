/**
 * Host filesystem / SQLite helpers over muxy.exec (or any argv exec).
 * Thenables-aware: if `exec` returns a Promise, methods return Promises;
 * if `exec` is synchronous, methods return plain values.
 *
 * Uses fixed absolute binaries (macOS-style) — no bash -lc for file content.
 */

export const HOST_BINS = Object.freeze({
  cat: "/bin/cat",
  ls: "/bin/ls",
  mv: "/bin/mv",
  rm: "/bin/rm",
  mkdir: "/bin/mkdir",
  tee: "/usr/bin/tee",
  env: "/usr/bin/env",
  printenv: "/usr/bin/printenv",
  head: "/usr/bin/head",
  stat: "/usr/bin/stat",
  sqlite3: "/usr/bin/sqlite3",
});

/** Core tools required for any listing; sqlite3 is optional (Codex/Copilot soft-fail). */
export const REQUIRED_HOST_TOOLS = Object.freeze([
  HOST_BINS.cat,
  HOST_BINS.ls,
  HOST_BINS.mv,
  HOST_BINS.rm,
  HOST_BINS.mkdir,
  HOST_BINS.tee,
  HOST_BINS.env,
  HOST_BINS.printenv,
  HOST_BINS.head,
  HOST_BINS.stat,
]);

export const OPTIONAL_HOST_TOOLS = Object.freeze([HOST_BINS.sqlite3]);

/**
 * @param {*} value
 * @param {(v: any) => any} fn
 */
export function chain(value, fn) {
  if (value != null && typeof value.then === "function") {
    return value.then(fn);
  }
  return fn(value);
}

/**
 * Swallow thenable rejections (optional probes must never surface as unhandled).
 * @param {*} value
 */
function swallowRejection(value) {
  if (value != null && typeof value.then === "function") {
    value.then(
      () => {},
      () => {},
    );
  }
}

/**
 * Normalize muxy.exec / Bun.spawnSync style results.
 * Missing or non-numeric exit codes fail closed (not success).
 * @param {*} result
 */
export function normalizeExecResult(result) {
  if (result == null || typeof result !== "object") {
    return { stdout: "", stderr: "empty exec result", exitCode: 1 };
  }
  const code = result.exitCode ?? result.code;
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    exitCode: typeof code === "number" && Number.isFinite(code) ? code : 1,
  };
}

/**
 * Expand `~` / relative env homes to an absolute POSIX path under `home`.
 * Absolute paths are returned with collapsed slashes (trailing slash stripped except root).
 * @param {string | null | undefined} path
 * @param {string} home
 * @returns {string | null}
 */
export function expandUserPath(path, home) {
  if (path == null || path === "") return null;
  let s = String(path);
  if (s.startsWith("~/") || s === "~") {
    if (!home) return null;
    s = joinPath(home, s.slice(1).replace(/^\//, ""));
  } else if (!s.startsWith("/")) {
    if (!home) return null;
    s = joinPath(home, s);
  }
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s || "/";
}

/**
 * @param {Function} exec
 * @param {string[]} argv
 * @param {{ stdin?: string, timeoutMs?: number }} [opts]
 */
function run(exec, argv, opts = {}) {
  const result = exec(argv, {
    timeoutMs: opts.timeoutMs ?? 15000,
    ...(opts.stdin != null ? { stdin: opts.stdin } : {}),
  });
  return chain(result, normalizeExecResult);
}

/**
 * @param {{ stdout: string, stderr: string, exitCode: number }} r
 * @param {string} label
 */
function assertOk(r, label) {
  if (r.exitCode !== 0) {
    const detail = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim();
    throw new Error(`${label}: ${detail || `exit ${r.exitCode}`}`);
  }
  return r;
}

/**
 * Probe host for required tools once.
 * @param {Function} exec
 * @param {{ required?: string[], optional?: string[] }} [opts]
 * @returns {boolean | Promise<boolean>}
 */
let hostToolsCache = null;

export function resetHostToolsProbe() {
  hostToolsCache = null;
}

export function ensureHostTools(exec, opts = {}) {
  if (hostToolsCache === true) return true;
  if (hostToolsCache === false) return false;

  const required = opts.required ?? REQUIRED_HOST_TOOLS;
  const optional = opts.optional ?? OPTIONAL_HOST_TOOLS;

  const probeOne = (bin) => {
    // Prefer printenv-style existence: ls the binary path itself.
    return chain(run(exec, [HOST_BINS.ls, "--", bin], { timeoutMs: 5000 }), (r) => {
      return r.exitCode === 0;
    });
  };

  const start = required.reduce(
    (acc, bin) =>
      chain(acc, (ok) => {
        if (!ok) return false;
        return chain(probeOne(bin), (found) => found);
      }),
    true,
  );

  return chain(start, (ok) => {
    hostToolsCache = Boolean(ok);
    // Best-effort optional probe (does not flip cache; never unhandled rejection).
    if (ok) {
      for (const bin of optional) {
        try {
          swallowRejection(probeOne(bin));
        } catch {
          /* ignore sync throws */
        }
      }
    }
    return hostToolsCache;
  });
}

/**
 * Soft probe for sqlite3.
 * @param {Function} exec
 * @returns {boolean | Promise<boolean>}
 */
export function hasSqlite3(exec) {
  return chain(run(exec, [HOST_BINS.ls, "--", HOST_BINS.sqlite3], { timeoutMs: 5000 }), (r) => {
    return r.exitCode === 0;
  });
}

/**
 * @param {Function} exec  muxy.exec-compatible (sync or async)
 */
export function createHostFs(exec) {
  if (typeof exec !== "function") {
    throw new Error("createHostFs requires an exec function");
  }

  const homeDir = () => {
    // Prefer printenv HOME; fall back to env printenv HOME.
    return chain(run(exec, [HOST_BINS.printenv, "--", "HOME"], { timeoutMs: 5000 }), (r) => {
      if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
      return chain(
        run(exec, [HOST_BINS.env, "printenv", "--", "HOME"], { timeoutMs: 5000 }),
        (r2) => {
          assertOk(r2, "homeDir");
          const home = r2.stdout.trim();
          if (!home) throw new Error("homeDir: HOME is empty");
          return home;
        },
      );
    });
  };

  const env = (name) => {
    if (!name || typeof name !== "string") throw new Error("env: invalid name");
    return chain(run(exec, [HOST_BINS.printenv, "--", name], { timeoutMs: 5000 }), (r) => {
      if (r.exitCode !== 0) return null;
      const v = r.stdout.replace(/\n$/, "");
      return v === "" ? null : v;
    });
  };

  const listDir = (dirPath) => {
    if (!dirPath) throw new Error("listDir: path required");
    return chain(
      run(exec, [HOST_BINS.ls, "-1A", "--", dirPath], { timeoutMs: 10000 }),
      (r) => {
        if (r.exitCode !== 0) {
          // Missing directory → empty list (callers decide).
          if (/No such file|not found|ENOENT/i.test(r.stderr + r.stdout)) return [];
          assertOk(r, `listDir ${dirPath}`);
        }
        return r.stdout
          .split("\n")
          .map((s) => s.replace(/\r$/, ""))
          .filter(Boolean);
      },
    );
  };

  /**
   * Map BSD/GNU stat file-type strings to a coarse kind.
   * stat is invoked with -L so symlinks are resolved to their target type.
   * @param {string} typeStr
   * @returns {'file'|'dir'|'other'}
   */
  const kindFromStatType = (typeStr) => {
    const s = String(typeStr || "").toLowerCase();
    if (s.includes("directory") || s === "dir") return "dir";
    // BSD: "Regular File"; GNU: "regular file" / "regular empty file"
    if (s.includes("regular") || s === "file") return "file";
    return "other";
  };

  /**
   * Parse multi-file stat output: path\\ttype\\tmtime_sec\\tsize per line.
   * @param {string} text
   * @param {Map<string, string>} fullToBase  full path → basename
   * @returns {Map<string, { kind: string, mtimeMs: number, size: number|null }>}
   */
  const parseStatBatch = (text, fullToBase) => {
    /** @type {Map<string, { kind: string, mtimeMs: number, size: number|null }>} */
    const out = new Map();
    for (const rawLine of String(text || "").split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const full = parts[0];
      const typeStr = parts[1];
      const sec = Number(parts[2]);
      const sizeRaw = parts.length >= 4 ? Number(parts[3]) : NaN;
      const base = fullToBase.get(full) ?? full.replace(/\/+$/, "").split("/").pop();
      if (!base) continue;
      out.set(base, {
        kind: kindFromStatType(typeStr),
        mtimeMs: Number.isFinite(sec) ? Math.trunc(sec * 1000) : 0,
        size: Number.isFinite(sizeRaw) ? sizeRaw : null,
      });
    }
    return out;
  };

  const STAT_CHUNK = 80;

  /**
   * List directory entries with kind + mtime (+ size when available).
   * Uses listDir + batched multi-path stat (macOS -f, Linux -c fallback).
   * Symlinks are followed (stat -L): symlink-to-dir → kind "dir", symlink-to-file → kind "file".
   * Missing dir → [].
   *
   * @param {string} dirPath
   * @returns {Array<{ name: string, kind: 'file'|'dir'|'other', mtimeMs: number, size: number|null }> | Promise<…>}
   */
  const listDirDetailed = (dirPath) => {
    if (!dirPath) throw new Error("listDirDetailed: path required");
    return chain(listDir(dirPath), (names) => {
      if (!names.length) return [];

      /** @type {Map<string, string>} */
      const fullToBase = new Map();
      const fullPaths = names.map((name) => {
        const full = joinPath(dirPath, name);
        fullToBase.set(full, name);
        return full;
      });

      /**
       * @param {string[]} chunk
       * @param {boolean} useBsd
       */
      const runChunk = (chunk, useBsd) => {
        // -L dereferences symlinks so symlink-to-dir reports kind "dir".
        const argv = useBsd
          ? [HOST_BINS.stat, "-L", "-f", "%N\t%HT\t%m\t%z", "--", ...chunk]
          : [HOST_BINS.stat, "-L", "-c", "%n\t%F\t%Y\t%s", "--", ...chunk];
        return run(exec, argv, { timeoutMs: 15000 });
      };

      /**
       * @param {number} start
       * @param {Map<string, { kind: string, mtimeMs: number, size: number|null }>} acc
       * @param {boolean|null} bsdMode  null = try BSD first
       */
      const processChunks = (start, acc, bsdMode) => {
        if (start >= fullPaths.length) {
          return names.map((name) => {
            const meta = acc.get(name);
            return {
              name,
              kind: meta?.kind ?? "other",
              mtimeMs: meta?.mtimeMs ?? 0,
              size: meta?.size ?? null,
            };
          });
        }
        const chunk = fullPaths.slice(start, start + STAT_CHUNK);
        const preferBsd = bsdMode !== false;
        return chain(runChunk(chunk, preferBsd), (r) => {
          if (r.exitCode !== 0 && preferBsd && bsdMode == null) {
            // Fall back to GNU stat for the whole remaining walk.
            return processChunks(start, acc, false);
          }
          if (r.exitCode === 0) {
            const parsed = parseStatBatch(r.stdout, fullToBase);
            for (const [k, v] of parsed) acc.set(k, v);
          }
          // Partial failure: keep going with whatever we have.
          return processChunks(start + STAT_CHUNK, acc, preferBsd ? bsdMode ?? true : false);
        });
      };

      return processChunks(0, new Map(), null);
    });
  };

  const readText = (filePath) => {
    if (!filePath) throw new Error("readText: path required");
    return chain(run(exec, [HOST_BINS.cat, "--", filePath], { timeoutMs: 20000 }), (r) => {
      if (r.exitCode !== 0) {
        if (/No such file|not found|ENOENT/i.test(r.stderr + r.stdout)) {
          throw new Error(`readText: not found: ${filePath}`);
        }
        assertOk(r, `readText ${filePath}`);
      }
      return r.stdout;
    });
  };

  /**
   * Read at most maxBytes (default 64 KiB) from the start of a file.
   * @param {string} filePath
   * @param {{ maxBytes?: number }} [opts]
   */
  const readHead = (filePath, opts = {}) => {
    if (!filePath) throw new Error("readHead: path required");
    const maxBytes = Math.max(1, Number(opts.maxBytes) || 65536);
    return chain(
      run(
        exec,
        [HOST_BINS.head, "-c", String(maxBytes), "--", filePath],
        { timeoutMs: 15000 },
      ),
      (r) => {
        if (r.exitCode !== 0) {
          if (/No such file|not found|ENOENT/i.test(r.stderr + r.stdout)) {
            throw new Error(`readHead: not found: ${filePath}`);
          }
          assertOk(r, `readHead ${filePath}`);
        }
        return r.stdout;
      },
    );
  };

  /**
   * File size in bytes, or 0 if missing.
   * @param {string} filePath
   */
  const fileSize = (filePath) => {
    // macOS: stat -f %z ; Linux: stat -c %s
    return chain(
      run(exec, [HOST_BINS.stat, "-f", "%z", "--", filePath], { timeoutMs: 5000 }),
      (r) => {
        if (r.exitCode === 0) {
          const n = Number(r.stdout.trim());
          return Number.isFinite(n) ? n : 0;
        }
        return chain(
          run(exec, [HOST_BINS.stat, "-c", "%s", "--", filePath], { timeoutMs: 5000 }),
          (r2) => {
            if (r2.exitCode !== 0) return 0;
            const n = Number(r2.stdout.trim());
            return Number.isFinite(n) ? n : 0;
          },
        );
      },
    );
  };

  /**
   * mtime in milliseconds since epoch; 0 if unavailable.
   * @param {string} filePath
   */
  const mtimeMs = (filePath) => {
    // macOS: %m is seconds; Linux: %Y
    return chain(
      run(exec, [HOST_BINS.stat, "-f", "%m", "--", filePath], { timeoutMs: 5000 }),
      (r) => {
        if (r.exitCode === 0) {
          const sec = Number(r.stdout.trim());
          return Number.isFinite(sec) ? Math.trunc(sec * 1000) : 0;
        }
        return chain(
          run(exec, [HOST_BINS.stat, "-c", "%Y", "--", filePath], { timeoutMs: 5000 }),
          (r2) => {
            if (r2.exitCode !== 0) return 0;
            const sec = Number(r2.stdout.trim());
            return Number.isFinite(sec) ? Math.trunc(sec * 1000) : 0;
          },
        );
      },
    );
  };

  const exists = (path) => {
    return chain(
      run(exec, [HOST_BINS.ls, "--", path], { timeoutMs: 5000 }),
      (r) => r.exitCode === 0,
    );
  };

  const isDir = (path) => {
    // ls -ldL: -L dereferences symlinks so symlink-to-dir is treated as a directory.
    return chain(run(exec, [HOST_BINS.ls, "-ldL", "--", path], { timeoutMs: 5000 }), (r) => {
      if (r.exitCode !== 0) return false;
      const line = r.stdout.trim();
      return line.startsWith("d");
    });
  };

  const isFile = (path) => {
    return chain(run(exec, [HOST_BINS.ls, "-ld", "--", path], { timeoutMs: 5000 }), (r) => {
      if (r.exitCode !== 0) return false;
      const line = r.stdout.trim();
      // regular file: '-' ; avoid directories and symlinks (l)
      return line.startsWith("-");
    });
  };

  const mkdirP = (dirPath) => {
    if (!dirPath) throw new Error("mkdirP: path required");
    return chain(
      run(exec, [HOST_BINS.mkdir, "-p", "--", dirPath], { timeoutMs: 10000 }),
      (r) => {
        assertOk(r, `mkdirP ${dirPath}`);
        return true;
      },
    );
  };

  /**
   * Atomic write: tee to .tmp then mv -f over destination.
   * @param {string} filePath
   * @param {string} content
   */
  const writeAtomic = (filePath, content) => {
    if (!filePath) throw new Error("writeAtomic: path required");
    const text = content == null ? "" : String(content);
    const tmp = `${filePath}.tmp`;
    // Parent may not exist — mkdir -p parent.
    const parent = filePath.replace(/\/[^/]+\/?$/, "");
    const ensureParent =
      parent && parent !== filePath
        ? chain(mkdirP(parent), () => true)
        : true;

    return chain(ensureParent, () =>
      chain(
        run(exec, [HOST_BINS.tee, "--", tmp], { stdin: text, timeoutMs: 15000 }),
        (r) => {
          assertOk(r, `writeAtomic tee ${tmp}`);
          return chain(
            run(exec, [HOST_BINS.mv, "-f", "--", tmp, filePath], { timeoutMs: 10000 }),
            (r2) => {
              if (r2.exitCode !== 0) {
                // Best-effort cleanup of tmp
                try {
                  run(exec, [HOST_BINS.rm, "-f", "--", tmp], { timeoutMs: 5000 });
                } catch {
                  /* ignore */
                }
                assertOk(r2, `writeAtomic mv ${filePath}`);
              }
              return true;
            },
          );
        },
      ),
    );
  };

  /**
   * Remove a file or directory tree.
   * @param {string} path
   * @param {{ root?: string }} [opts] — if set, path must equal root or be under root/
   */
  const removePath = (path, opts = {}) => {
    if (!path || typeof path !== "string") throw new Error("removePath: path required");
    if (!path.startsWith("/") || path === "/") {
      throw new Error("removePath: refusing non-absolute or root path");
    }
    const parts = path.split("/").filter(Boolean);
    if (parts.some((p) => p === "." || p === "..")) {
      throw new Error("removePath: path traversal refused");
    }
    if (opts.root) {
      const r = String(opts.root).replace(/\/+$/, "") || "/";
      if (r === "/" || (!path.startsWith(`${r}/`) && path !== r)) {
        throw new Error("removePath: path outside allowed root");
      }
    }
    return chain(
      run(exec, [HOST_BINS.rm, "-rf", "--", path], { timeoutMs: 20000 }),
      (r) => {
        assertOk(r, `removePath ${path}`);
        return true;
      },
    );
  };

  /**
   * Read-only SQLite query. Returns parsed JSON rows when using -json.
   * @param {string} dbPath
   * @param {string} sql
   * @param {{ readonly?: boolean }} [opts]
   */
  const sqliteQuery = (dbPath, sql, opts = {}) => {
    if (!dbPath) throw new Error("sqliteQuery: dbPath required");
    if (!sql) throw new Error("sqliteQuery: sql required");
    const readonly = opts.readonly !== false;
    // Options first, then --, then database path + SQL so flag-shaped paths are safe.
    const argv = readonly
      ? [HOST_BINS.sqlite3, "-readonly", "-json", "--", dbPath, sql]
      : [HOST_BINS.sqlite3, "-json", "--", dbPath, sql];
    return chain(run(exec, argv, { timeoutMs: 20000 }), (r) => {
      if (r.exitCode !== 0) {
        throw new Error(
          `sqliteQuery: ${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim()}`,
        );
      }
      const text = r.stdout.trim();
      if (!text) return [];
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        throw new Error(`sqliteQuery: invalid JSON output`);
      }
    });
  };

  /**
   * Execute a write SQL statement (no JSON expected).
   * @param {string} dbPath
   * @param {string} sql
   */
  const sqliteExec = (dbPath, sql) => {
    if (!dbPath) throw new Error("sqliteExec: dbPath required");
    if (!sql) throw new Error("sqliteExec: sql required");
    return chain(
      run(exec, [HOST_BINS.sqlite3, "--", dbPath, sql], { timeoutMs: 20000 }),
      (r) => {
        if (r.exitCode !== 0) {
          throw new Error(
            `sqliteExec: ${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim()}`,
          );
        }
        return true;
      },
    );
  };

  /**
   * PRAGMA table_info / table list helpers returning string sets.
   * @param {string} dbPath
   * @param {string} table
   */
  const sqliteTableColumns = (dbPath, table) => {
    // Validate table name (identifier only)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`sqliteTableColumns: invalid table ${table}`);
    }
    return chain(
      sqliteQuery(dbPath, `PRAGMA table_info(${table})`),
      (rows) => new Set(rows.map((row) => row.name).filter(Boolean)),
    );
  };

  const sqliteTables = (dbPath) => {
    return chain(
      sqliteQuery(
        dbPath,
        "SELECT name FROM sqlite_master WHERE type='table'",
      ),
      (rows) => new Set(rows.map((row) => row.name).filter(Boolean)),
    );
  };

  return {
    homeDir,
    env,
    listDir,
    listDirDetailed,
    readText,
    readHead,
    fileSize,
    mtimeMs,
    exists,
    isDir,
    isFile,
    mkdirP,
    writeAtomic,
    removePath,
    sqliteQuery,
    sqliteExec,
    sqliteTableColumns,
    sqliteTables,
  };
}

/**
 * Join path segments with `/` (host paths are POSIX).
 * @param {...string} parts
 */
export function joinPath(...parts) {
  const cleaned = parts
    .filter((p) => p != null && p !== "")
    .map((p, i) => {
      let s = String(p);
      if (i > 0) s = s.replace(/^\/+/, "");
      return s.replace(/\/+$/, "");
    });
  if (!cleaned.length) return "";
  let out = cleaned[0];
  for (let i = 1; i < cleaned.length; i++) {
    out = out.endsWith("/") ? out + cleaned[i] : `${out}/${cleaned[i]}`;
  }
  return out;
}

/**
 * SQL string literal escaping for sqlite3 CLI.
 * @param {string} value
 */
export function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
