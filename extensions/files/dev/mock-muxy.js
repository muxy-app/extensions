// Dev-only stand-in for the `window.muxy` page API, so the panel and editor can
// run under `npm run dev` in a normal browser. It models a large repository
// (≈20k entries, including a wide node_modules), host IPC latency, the real
// `file.changed` payload shape (absolute `path` + `projectPath`), and the
// permission errors the real host returns for undeclared permissions.
(() => {
  const ROOT = "/Users/dev/project";
  const params = new URLSearchParams(location.search);
  const LATENCY = Number(params.get("latency") ?? 2);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const call = async (fn, ms = LATENCY) => {
    await sleep(ms);
    return fn();
  };

  // ---- Synthetic repository ------------------------------------------------
  const files = new Map(); // rel path -> content
  const dirs = new Map(); // rel dir ("" or "a/b") -> Set of child names
  const ignored = new Set(["node_modules", "dist", ".DS_Store"]);

  function ensureDir(rel) {
    if (dirs.has(rel)) return;
    dirs.set(rel, new Set());
    if (rel === "") return;
    const idx = rel.lastIndexOf("/");
    const parent = idx === -1 ? "" : rel.slice(0, idx);
    ensureDir(parent);
    dirs.get(parent).add(rel.slice(idx + 1));
  }

  function addFile(rel, content) {
    const idx = rel.lastIndexOf("/");
    const parent = idx === -1 ? "" : rel.slice(0, idx);
    ensureDir(parent);
    dirs.get(parent).add(rel.slice(idx + 1));
    files.set(rel, content);
  }

  function jsSource(lines, seed) {
    const out = [];
    for (let i = 0; i < lines; i++) {
      if (i % 40 === 0) out.push(`// Section ${i / 40} of module ${seed}`);
      else if (i % 7 === 0) out.push(`export function fn_${seed}_${i}(value, options = {}) {`);
      else if (i % 7 === 6) out.push("}");
      else out.push(`  const item_${i} = compute("${seed}-${i}", value * ${i}, { color: "#3b82f6", enabled: ${i % 2 === 0} });`);
    }
    return out.join("\n") + "\n";
  }

  ensureDir("");
  for (let d = 0; d < 40; d++) {
    for (let f = 0; f < 25; f++) addFile(`src/module-${d}/file-${f}.js`, jsSource(60, `${d}-${f}`));
    addFile(`src/module-${d}/README.md`, `# Module ${d}\n\nSome docs.\n`);
  }
  for (let p = 0; p < 300; p++) {
    const pkg = `node_modules/pkg-${String(p).padStart(3, "0")}`;
    addFile(`${pkg}/package.json`, `{"name":"pkg-${p}","version":"1.0.0"}\n`);
    addFile(`${pkg}/README.md`, `# pkg-${p}\n`);
    for (let f = 0; f < 10; f++) addFile(`${pkg}/dist/index-${f}.js`, "module.exports = {};\n");
  }
  for (let f = 0; f < 30; f++) addFile(`docs/guide-${f}.md`, `# Guide ${f}\n\n- [ ] task\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n`);
  addFile("src/big.js", jsSource(3000, "big"));
  addFile(
    "docs/sample.md",
    [
      "# Sample document",
      "",
      "Intro paragraph with **bold**, *italic*, `inline code`, and a [link](https://muxy.app).",
      "",
      "## Section two",
      "",
      "- First item",
      "- Second item with `code`",
      "  - Nested item",
      "",
      "1. One",
      "2. Two",
      "",
      "- [ ] Open task",
      "- [x] Done task",
      "",
      "> A blockquote line.",
      "",
      "```js",
      "const answer = 42;",
      "console.log(answer);",
      "```",
      "",
      "### Table",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | 1 |",
      "| beta | 2 |",
      "",
      "---",
      "",
      "Final paragraph.",
      "",
    ].join("\n"),
  );
  addFile("README.md", "# Project\n\nHello **world**.\n");
  addFile("package.json", '{\n  "name": "project",\n  "version": "1.0.0"\n}\n');
  addFile(".gitignore", "node_modules\ndist\n");
  addFile("dist/bundle.js", "/* built */\n");

  // HEAD versions: scatter edits at the top and bottom of big.js so the
  // changed region spans the whole file (the git gutter's worst case).
  const headFiles = new Map(files);
  {
    const lines = files.get("src/big.js").split("\n");
    lines[3] = "  // changed at the top";
    lines[lines.length - 10] = "  // changed at the bottom";
    headFiles.set("src/big.js", lines.join("\n"));
  }

  const strip = (p) => String(p ?? "").replace(/^\/+|\/+$/g, "");
  const nameOf = (p) => p.slice(p.lastIndexOf("/") + 1);
  const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

  function isIgnoredPath(rel) {
    return rel.split("/").some((seg) => ignored.has(seg));
  }

  function listDir(rel) {
    const key = strip(rel);
    const children = dirs.get(key);
    if (!children) throw new Error(`No such directory: ${key}`);
    const entries = [...children].map((name) => {
      const path = key ? `${key}/${name}` : name;
      return { name, path, isDirectory: dirs.has(path), isIgnored: isIgnoredPath(path) };
    });
    entries.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase())));
    return entries;
  }

  function removePath(rel) {
    if (dirs.has(rel)) {
      for (const child of [...dirs.get(rel)]) removePath(`${rel}/${child}`);
      dirs.delete(rel);
    }
    files.delete(rel);
    dirs.get(parentOf(rel))?.delete(nameOf(rel));
  }

  function movePath(from, to) {
    if (dirs.has(from)) {
      ensureDir(to);
      for (const child of [...dirs.get(from)]) movePath(`${from}/${child}`, `${to}/${child}`);
      removePath(from);
      return;
    }
    const content = files.get(from);
    removePath(from);
    addFile(to, content ?? "");
  }

  // ---- Events --------------------------------------------------------------
  const listeners = new Map();
  function emit(name, payload) {
    for (const fn of [...(listeners.get(name) ?? [])]) {
      try {
        fn(payload ?? {});
      } catch (err) {
        console.error(err);
      }
    }
  }
  function changed(rel) {
    emit("file.changed", { path: rel ? `${ROOT}/${rel}` : ROOT, projectPath: ROOT });
  }

  // ---- Theme ---------------------------------------------------------------
  const dark = params.get("theme") !== "light";
  const theme = dark
    ? { colorScheme: "dark", background: "#1e1e1e", foreground: "#e6e6e6", foregroundMuted: "#9a9a9a", surface: "#2a2a2a", surfaceSolid: "#2a2a2a", border: "#3a3a3a", hover: "#333333", accent: "#4c8dff", accentForeground: "#ffffff", accentSoft: "rgba(76,141,255,0.18)", diffAdd: "#3fb950", diffRemove: "#f85149", diffHunk: "#a371f7", topbarHeight: "36px" }
    : { colorScheme: "light", background: "#ffffff", foreground: "#1d1d1f", foregroundMuted: "#6e6e73", surface: "#f2f2f4", surfaceSolid: "#f2f2f4", border: "#dcdce0", hover: "#e8e8ec", accent: "#0a66ff", accentForeground: "#ffffff", accentSoft: "rgba(10,102,255,0.14)", diffAdd: "#1a7f37", diffRemove: "#cf222e", diffHunk: "#8250df", topbarHeight: "36px" };
  for (const [key, value] of Object.entries(theme)) {
    document.documentElement.style.setProperty(`--muxy-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, value);
  }

  const storage = new Map();
  const opened = [];
  const switched = [];
  const surface = params.get("surface") ?? "panel";
  const tabInstanceID = params.get("pane") ?? (surface === "panel" ? "files" : "pane-1");
  let data = surface === "tab" ? { filePath: params.get("file") ?? "src/big.js" } : null;
  // `?source=terminal&line=12` mimics a terminal Cmd-click (the host's file opener).
  if (data && params.get("source")) data.source = params.get("source");
  if (data && params.get("line")) data.line = Number(params.get("line"));
  let closed = false;
  const dataListeners = new Set();
  const focusListeners = new Set();
  let beforeClose = null;

  const denied = (perm) => () => Promise.reject(new Error(`permission denied (${perm})`));

  window.muxy = {
    extensionID: "files",
    tabInstanceID,
    panelID: surface === "panel" ? "files" : null,
    get data() {
      return data;
    },
    theme,
    focused: true,
    onDataChange: (fn) => (dataListeners.add(fn), () => dataListeners.delete(fn)),
    onThemeChange: () => () => {},
    onFocus: (fn) => (focusListeners.add(fn), () => focusListeners.delete(fn)),
    events: {
      subscribe(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return () => listeners.get(name)?.delete(fn);
      },
      emit: () => Promise.reject(new Error("no background script")),
    },
    files: {
      list: (path) => call(() => listDir(path)),
      read: (path) =>
        call(() => {
          const rel = strip(path);
          if (!files.has(rel)) throw new Error(`No such file: ${rel}`);
          const content = files.get(rel);
          return { path: rel, content, size: content.length };
        }),
      stat: (path) =>
        call(() => {
          const rel = strip(path);
          if (dirs.has(rel)) return { path: rel, name: nameOf(rel), isDirectory: true, size: 0 };
          if (files.has(rel)) return { path: rel, name: nameOf(rel), isDirectory: false, size: files.get(rel).length };
          throw new Error(`No such file: ${rel}`);
        }),
      write: (path, content) =>
        call(() => {
          const rel = strip(path);
          addFile(rel, String(content));
          setTimeout(() => changed(rel), 300);
        }),
      mkdir: (path) =>
        call(() => {
          const rel = strip(path);
          ensureDir(rel);
          setTimeout(() => changed(rel), 300);
        }),
      rename: (path, newName) =>
        call(() => {
          const rel = strip(path);
          const dest = parentOf(rel) ? `${parentOf(rel)}/${newName}` : newName;
          if (files.has(dest) || dirs.has(dest)) throw new Error(`${newName} already exists`);
          movePath(rel, dest);
          setTimeout(() => (changed(rel), changed(dest)), 300);
          return { path: dest };
        }),
      move: (paths, into) =>
        call(() => {
          const target = strip(into);
          return paths.map((p) => {
            const rel = strip(p);
            const dest = target ? `${target}/${nameOf(rel)}` : nameOf(rel);
            movePath(rel, dest);
            setTimeout(() => (changed(rel), changed(dest)), 300);
            return dest;
          });
        }),
      delete: (paths) =>
        call(() => {
          for (const p of paths) {
            const rel = strip(p);
            removePath(rel);
            setTimeout(() => changed(rel), 300);
          }
        }),
    },
    git: {
      status: () =>
        call(
          () => ({
            branch: "main",
            stagedFiles: [{ path: "src/module-1/file-1.js", status: "M" }],
            unstagedFiles: [
              { path: "src/big.js", status: "M" },
              { path: "src/module-3/file-4.js", status: "M" },
              { path: "docs/guide-2.md", status: "?" },
              { path: "README.md", status: "M" },
            ],
          }),
          15,
        ),
    },
    exec: (argv) =>
      call(() => {
        const args = Array.isArray(argv) ? argv : [];
        if (args[0] === "pwd") return { stdout: `${ROOT}\n`, stderr: "", exitCode: 0 };
        if (args[0] === "git" && args[1] === "show") {
          const rel = String(args[2]).replace(/^HEAD:(\.\/)?/, "");
          if (!headFiles.has(rel)) return { stdout: "", stderr: "not in HEAD", exitCode: 128 };
          return { stdout: headFiles.get(rel), stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }, 8),
    tabs: {
      list: denied("tabs:read"),
      open: (request) => call(() => (opened.push(request), `tab-${opened.length}`)),
      // A pane is "alive" when an editor page registered it (see
      // src/shared/editors.js) or this page opened it.
      switchTo: (id) =>
        call(() => {
          const alive = localStorage.getItem(`muxy.files.editor:${id}`) !== null || String(id).startsWith("tab-");
          if (!alive) throw new Error(`tab not found ${id}`);
          switched.push(id);
        }),
      setTitle: () => call(() => undefined),
      setIcon: () => call(() => undefined),
    },
    worktrees: { list: denied("worktrees:read") },
    storage: {
      get: (key) => call(() => (storage.has(key) ? structuredClone(storage.get(key)) : null)),
      set: (key, value) => call(() => void storage.set(key, structuredClone(value))),
      delete: (key) => call(() => void storage.delete(key)),
      keys: () => call(() => [...storage.keys()].sort()),
    },
    toast: () => Promise.resolve(),
    dialog: {
      confirm: (opts) => Promise.resolve(window.confirm(opts?.message ?? "") ? opts.buttons?.[0] : opts.cancel ?? null),
      alert: (opts) => Promise.resolve(void console.warn("alert", opts)),
      prompt: () => Promise.resolve(null),
    },
    lifecycle: {
      onBeforeClose: (fn) => ((beforeClose = fn), () => (beforeClose = null)),
      close: () => ((closed = true), Promise.resolve()),
    },
    panels: { close: () => Promise.resolve() },
  };

  // ---- Test hooks ----------------------------------------------------------
  window.__mock = {
    ROOT,
    files,
    dirs,
    opened,
    switched,
    storage,
    get closed() {
      return closed;
    },
    emit,
    changed,
    setData(next) {
      data = next;
      for (const fn of dataListeners) fn(data);
    },
    focus(value) {
      for (const fn of focusListeners) fn(value);
    },
    beforeClose: () => beforeClose?.(),
    // A burst like `npm install`: thousands of events under node_modules plus
    // a handful in tracked sources, delivered the way the host does (one
    // `file.changed` per path, back to back).
    flood(count = 2000) {
      for (let i = 0; i < count; i++) changed(`node_modules/pkg-${String(i % 300).padStart(3, "0")}/dist/index-${i % 10}.js`);
      for (let i = 0; i < 20; i++) changed(`src/module-${i}/file-${i}.js`);
      changed(".git/index");
    },
  };
})();
