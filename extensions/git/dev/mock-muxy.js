(() => {
  const ROOT = "/Users/dev/project";
  const params = new URLSearchParams(location.search);
  const LATENCY = Number(params.get("latency") ?? 15);
  const CHANGES = Number(params.get("changes") ?? 40);
  const COMMITS = Number(params.get("commits") ?? 3000);
  const light = params.get("theme") === "light";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const call = async (fn, ms = LATENCY) => {
    await sleep(ms);
    return fn();
  };
  const calls = {};
  const count = (name) => (calls[name] = (calls[name] ?? 0) + 1);

  const theme = light
    ? { background: "#ffffff", foreground: "#1d1d1f", foregroundMuted: "#6e6e73", surface: "#f2f2f4", surfaceSolid: "#ffffff", border: "#e1e1e6", hover: "#ebebef", accent: "#0a84ff", accentForeground: "#ffffff", accentSoft: "rgba(10,132,255,0.16)", diffAdd: "#1f9d55", diffRemove: "#d93f3f", diffHunk: "#b7791f", colorScheme: "light", topbarHeight: "32px" }
    : { background: "#1e1e20", foreground: "#e8e8ea", foregroundMuted: "#8e8e93", surface: "#2a2a2d", surfaceSolid: "#2a2a2d", border: "#38383c", hover: "#333336", accent: "#4f9dff", accentForeground: "#0b0b0c", accentSoft: "rgba(79,157,255,0.2)", diffAdd: "#4cc38a", diffRemove: "#ff6b6b", diffHunk: "#e5b454", colorScheme: "dark", topbarHeight: "32px" };
  for (const [key, value] of Object.entries(theme)) document.documentElement.style.setProperty(`--muxy-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, value);

  const dirs = ["src/components", "src/lib", "src/lib/deep/nested", "docs", "tests", "scripts", ""];
  const state = {
    branch: "feature/login",
    staged: new Map(),
    unstaged: new Map(),
    conflicts: new Set(),
    ahead: 2,
    behind: 1,
    op: params.get("op") || "",
    head: 0,
  };
  function seed(n) {
    state.staged.clear();
    state.unstaged.clear();
    for (let i = 0; i < n; i += 1) {
      const dir = dirs[i % dirs.length];
      const path = `${dir ? `${dir}/` : ""}file-${i}.${i % 3 ? "js" : "md"}`;
      const code = i % 11 === 0 ? "?" : i % 13 === 0 ? "D" : i % 17 === 0 ? "A" : "M";
      if (i % 4 === 0 && code !== "?") state.staged.set(path, { status: code, additions: (i * 7) % 90, deletions: (i * 3) % 40 });
      else state.unstaged.set(path, { status: code, additions: code === "D" ? 0 : (i * 5) % 120, deletions: code === "?" ? 0 : (i * 2) % 30 });
    }
    if (params.get("conflicts")) for (const path of ["src/lib/conflict.js", "README.md"]) state.conflicts.add(path);
  }
  seed(CHANGES);

  const authors = ["Ada", "Linus", "Grace", "Ken"];
  const commits = [];
  for (let i = 0; i < COMMITS; i += 1) {
    const hash = (i + 1).toString(16).padStart(8, "0") + "deadbeefcafe0000";
    commits.push({ hash, shortHash: hash.slice(0, 7), subject: i % 9 === 0 ? `Merge pull request #${1000 - i} from feature/x-${i}` : `Change ${COMMITS - i}: update module ${i % 40}`, authorName: authors[i % 4], authorDate: new Date(Date.now() - i * 3600e3 * 5).toISOString(), isMerge: false, parentHashes: [], refs: [] });
  }
  for (let i = 0; i < commits.length; i += 1) {
    const next = commits[i + 1]?.hash;
    const side = commits[i + 3]?.hash;
    commits[i].parentHashes = next ? (i % 9 === 0 && side ? [next, side] : [next]) : [];
    commits[i].isMerge = commits[i].parentHashes.length > 1;
  }
  commits[0].refs = [{ name: "feature/login", kind: "localBranch" }];
  commits[2].refs = [{ name: "origin/feature/login", kind: "remoteBranch" }];
  commits[5].refs = [{ name: "main", kind: "localBranch" }, { name: "origin/main", kind: "remoteBranch" }, { name: "v2.0.0", kind: "tag" }];

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };

  const file = (path, info) => ({ path, oldPath: null, status: info.status, isStaged: false, isUnstaged: false, isBinary: false, additions: info.additions, deletions: info.deletions });
  function status() {
    count("status");
    if (state.staged.size + state.unstaged.size > 4096) throw new Error("More than 4096 changed files; narrow changes using Git");
    const conflicts = [...state.conflicts].map((path) => ({ path, status: "UU", additions: 0, deletions: 0 }));
    return {
      branch: state.branch,
      defaultBranch: "main",
      aheadBehind: { ahead: state.ahead, behind: state.behind },
      branches: [],
      stagedFiles: [...state.staged].map(([p, i]) => file(p, i)),
      unstagedFiles: [...[...state.unstaged].map(([p, i]) => file(p, i)), ...conflicts],
      pullRequest: null,
    };
  }

  function lines(n, prefix) {
    return Array.from({ length: n }, (_, i) => `${prefix}  const value${i} = compute(${i}); // ${prefix === "+" ? "new" : "old"}`).join("\n");
  }
  function patchFor(map) {
    let out = "";
    for (const [path, info] of map) {
      if (info.status === "?") continue;
      const add = Math.min(info.additions, 30);
      const del = Math.min(info.deletions, 30);
      if (info.status === "D") {
        out += `diff --git a/${path} b/${path}\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/${path}\n+++ /dev/null\n@@ -1,${Math.max(del, 1)} +0,0 @@\n${lines(Math.max(del, 1), "-")}\n`;
        continue;
      }
      out += `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -10,${del + 2} +10,${add + 2} @@ function context() {\n   const keep = true;\n${del ? `${lines(del, "-")}\n` : ""}${add ? `${lines(add, "+")}\n` : ""}   return keep;\n`;
    }
    return out;
  }

  const prs = Array.from({ length: 25 }, (_, i) => ({
    number: 400 - i,
    title: ["Add login flow with OAuth providers", "Bump dependencies", "Fix flaky test in scheduler", "Dark mode toggle", "Refactor the storage layer"][i % 5],
    author: { login: authors[i % 4].toLowerCase() },
    headBranch: i === 0 ? "feature/login" : `feature/topic-${i}`,
    baseBranch: "main",
    state: i > 18 ? "MERGED" : "OPEN",
    url: `https://github.com/dev/project/pull/${400 - i}`,
    isDraft: i === 3,
    updatedAt: new Date(Date.now() - i * 3600e3 * 9).toISOString(),
    mergeable: i === 4 ? "CONFLICTING" : "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: i === 0 ? "APPROVED" : "",
    checks: { passing: i % 3 === 0 ? 5 : 3, failing: i % 3 === 1 ? 1 : 0, pending: i % 3 === 2 ? 2 : 0, total: 5 },
  }));

  function exec(argv) {
    count(`exec:${argv[0]} ${argv[1] ?? ""}`);
    const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0, timedOut: false, truncated: false });
    const cmd = argv.join(" ");
    if (argv[0] === "sh" && cmd.includes("rebase-merge")) return ok(state.op ? `${state.op}\n` : "");
    if (argv[0] === "sh" && cmd.includes("MERGE_MSG")) return ok(state.op ? "Merge branch 'main' into feature/login\n" : "");
    if (cmd.startsWith("git status --porcelain")) {
      const entries = [`## ${state.branch}...origin/${state.branch} [ahead ${state.ahead}, behind ${state.behind}]`];
      for (const [p, i] of state.staged) entries.push(`${i.status}  ${p}`);
      for (const [p, i] of state.unstaged) entries.push(i.status === "?" ? `?? ${p}` : ` ${i.status} ${p}`);
      return ok(`${entries.join("\0")}\0`);
    }
    if (cmd.startsWith("git remote get-url")) return ok("git@github.com:dev/project.git\n");
    if (cmd.startsWith("tea ")) return { stdout: "", stderr: "tea: command not found", exitCode: 127 };
    if (cmd.startsWith("git log") && cmd.includes("HEAD..@{upstream}")) return ok(`f00dbabe00000001\x1ff00dbab\x1fUpstream fix from teammate\x1fGrace\x1f${new Date().toISOString()}\x1f${commits[0].hash}\x1forigin/feature/login\x1e\n`);
    if (cmd.startsWith("git rev-list")) return ok(`${commits[0].hash}\n${commits[1].hash}\n`);
    if (cmd.startsWith("git show -s")) return ok(`${argv.at(-1)}\x00${argv.at(-1).slice(0, 7)}\x00Ada\x00ada@example.com\x00${new Date().toISOString()}\x00${commits[1].hash}\x00Change 42: update module\n\nLonger explanation of the change\nacross lines.\n`);
    if (cmd.startsWith("git -c core.editor=true show") || cmd.startsWith("git -c core.editor=true diff")) return ok(patchFor(new Map([...state.staged].slice(0, 6))));
    if (cmd.startsWith("gh pr view")) return ok(JSON.stringify({ ...prs[0], body: "## Summary\n\nAdds **OAuth** login.\n\n- Google\n- GitHub\n\n```js\nlogin()\n```", additions: 120, deletions: 8, changedFiles: 6, createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), labels: [{ name: "feature" }, { name: "auth" }], comments: [{ id: "c1", author: { login: "grace" }, body: "Looks great! One nit: can we rename `loginFlow`?", createdAt: new Date(Date.now() - 2 * 864e5).toISOString() }], reviews: [{ id: "r1", author: { login: "linus" }, state: "APPROVED", body: "", submittedAt: new Date(Date.now() - 864e5).toISOString() }, { id: "r2", author: { login: "ken" }, state: "CHANGES_REQUESTED", body: "Please add tests for the **token refresh** path.", submittedAt: new Date(Date.now() - 36e5).toISOString() }] }));
    if (cmd.startsWith("gh pr checks")) return ok(JSON.stringify([{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://x", workflow: "CI" }, { name: "test", state: "FAILURE", bucket: "fail", link: "https://x", workflow: "CI" }, { name: "lint", bucket: "pending", workflow: "CI" }]));
    if (cmd.startsWith("gh run list")) return ok(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ databaseId: 900 + i, displayTitle: `CI for change ${i}`, workflowName: i % 2 ? "CI" : "Release", status: i === 0 ? "in_progress" : "completed", conclusion: i === 0 ? "" : i % 4 === 1 ? "failure" : "success", headBranch: i % 3 ? "main" : "feature/login", event: "push", url: "https://x", createdAt: new Date(Date.now() - i * 4e6).toISOString() }))));
    if (cmd.startsWith("git stash list")) return ok("stash@{0}\x1fWIP on feature/login\x1f2 hours ago\n");
    return ok("");
  }

  const opened = [];
  const api = {
    extensionID: "git",
    tabInstanceID: params.get("tab") ?? "tab-1",
    panelID: "scm",
    data: JSON.parse(params.get("data") ?? "{}"),
    theme,
    focused: true,
    onDataChange: () => () => {},
    onThemeChange: () => () => {},
    onFocus: () => () => {},
    toast: async (o) => console.info("[toast]", o),
    notifications: { notify: async (o) => console.info("[notify]", o) },
    exec: (argv, opts) => call(() => exec(Array.isArray(argv) ? argv : ["sh", argv.shell])),
    dialog: {
      confirm: async (o) => (window.__autoConfirm === false ? "Cancel" : o.buttons[0]),
      alert: async (o) => console.warn("[alert]", o.title, o.message),
      prompt: async (o) => window.prompt(o.title, o.default ?? ""),
      pickFolder: async () => null,
    },
    modal: { open: async (o) => (console.info("[picker]", o.placeholder, (o.items ?? []).length), null), openWebview: async () => null, submitWebview: async () => null, closeWebview: async () => null },
    tabs: { open: async (r) => (opened.push(r), "tab-x"), switchTo: async () => { throw new Error("no tab"); }, setTitle: async (t) => (document.title = t), setIcon: async () => null },
    worktrees: { refresh: async () => null },
    lifecycle: { onBeforeClose: () => () => {}, close: async () => null },
    events: {
      subscribe(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return () => listeners.get(name).delete(fn);
      },
      emit: async () => null,
    },
    files: { read: (path) => call(() => ({ path, content: `untracked ${path}\nline two\n`, size: 30 })) },
    git: {
      status: () => call(status),
      repoInfo: () => call(() => ({ root: ROOT, gitDir: ".git", isWorktree: false, currentBranch: state.branch })),
      aheadBehind: () => call(() => ({ ahead: state.ahead, behind: state.behind, hasUpstream: true })),
      log: (o = {}) => call(() => (count("log"), commits.slice(o.skip ?? 0, (o.skip ?? 0) + (o.maxCount ?? 100)))),
      branches: () => call(() => ["main", "feature/login", "feature/dark-mode"]),
      remoteBranches: () => call(() => ["origin/main", "origin/feature/login", "origin/release"]),
      currentBranch: () => call(() => state.branch),
      worktrees: () => call(() => [{ path: ROOT, branch: state.branch }]),
      diff: (o) => call(() => ({ diff: patchFor(o.staged ? state.staged : state.unstaged), truncated: false }), 40),
      stage: (o) => call(() => {
        for (const path of o.paths) {
          const info = state.unstaged.get(path);
          if (info) state.staged.set(path, { ...info, status: info.status === "?" ? "A" : info.status });
          state.unstaged.delete(path);
          state.conflicts.delete(path);
        }
      }),
      unstage: (o) => call(() => {
        for (const path of o.paths) {
          const info = state.staged.get(path);
          if (info) state.unstaged.set(path, info);
          state.staged.delete(path);
        }
      }),
      discard: (o) => call(() => [...o.paths, ...o.untrackedPaths].forEach((p) => state.unstaged.delete(p))),
      commit: (o) => call(() => {
        if (o.stageAll) for (const [p, i] of state.unstaged) state.staged.set(p, i);
        if (o.stageAll) state.unstaged.clear();
        state.staged.clear();
        state.ahead += 1;
        commits.unshift({ ...commits[0], hash: `c0ffee${Date.now()}`, shortHash: "c0ffee1", subject: o.message, refs: [], parentHashes: [commits[0].hash] });
        return { hash: "c0ffee" };
      }, 120),
      push: () => call(() => (state.ahead = 0), 300),
      pull: () => call(() => (state.behind = 0), 300),
      pr: {
        info: () => call(() => (params.get("nopr") ? null : prs[0]), 200),
        list: (o) => call(() => prs.filter((p) => o.filter === "all" || p.state.toLowerCase() === o.filter), 250),
        merge: () => call(() => null, 300),
        close: () => call(() => null),
        diff: () => call(() => ({ diff: patchFor(state.unstaged) })),
      },
      branch: { create: async () => null, switchTo: async (o) => (state.branch = o.branch), delete: async () => null, deleteRemote: async () => null },
    },
  };
  window.muxy = api;
  window.__mock = {
    state,
    calls,
    opened,
    emit,
    seed: (n) => {
      seed(n);
      emit("file.changed", { path: `${ROOT}/x`, projectPath: ROOT });
    },
    changed: (rel) => emit("file.changed", { path: `${ROOT}/${rel}`, projectPath: ROOT }),
    flood(n) {
      for (let i = 0; i < n; i += 1) emit("file.changed", { path: `${ROOT}/node_modules/pkg/file-${i}.js`, projectPath: ROOT });
    },
  };
})();
