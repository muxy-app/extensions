import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("security: popover exec commands use absolute binaries", async () => {
  const source = await readFile(new URL("../popovers/usage.js", import.meta.url), "utf8");
  const cacheSource = await readFile(new URL("../src/status-cache.mjs", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.mjs", import.meta.url), "utf8");
  const apiKeysSource = await readFile(new URL("../src/api-keys.mjs", import.meta.url), "utf8");

  for (const content of [source, cacheSource, background, apiKeysSource]) {
    assert.doesNotMatch(content, /printenv/);
    assert.doesNotMatch(content, /\/bin\/sh/);
    assert.doesNotMatch(content, /"-c"/);
    assert.doesNotMatch(content, /muxy\.exec\(\["[^/]/);
  }
});

test("security: popover API keys are written owner-only through stdin, never argv", async () => {
  const { saveStoredApiKey, parseStoredApiKeys, maskApiKey } = await import("../src/api-keys.mjs");
  const secret = "sk-or-v1-supersecret-1234";
  const calls = [];
  let file = JSON.stringify({ version: 1, keys: { zai: "zai-existing" } });
  const exec = async (argv, options = {}) => {
    calls.push({ argv, stdin: options.stdin });
    if (argv[0] === "/bin/cat") return { exitCode: 0, stdout: file };
    if (argv[0] === "/bin/dd") file = options.stdin;
    return { exitCode: 0, stdout: "" };
  };

  await saveStoredApiKey(exec, "/Users/me", "openrouter", secret);

  const dir = "/Users/me/Library/Application Support/muxy-ai-usage";
  const tmp = `${dir}/api-keys.json.tmp`;
  for (const { argv } of calls) {
    assert.match(argv[0], /^\//);
    assert.equal(argv.join(" ").includes(secret), false, "secret leaked into argv");
  }
  const order = calls.map(({ argv }) => argv.join(" "));
  assert.ok(order.indexOf(`/bin/chmod 700 ${dir}`) > order.indexOf(`/bin/mkdir -p ${dir}`));
  assert.ok(order.indexOf(`/bin/chmod 600 ${tmp}`) < order.findIndex((line) => line.startsWith("/bin/dd")), "file must be owner-only before the secret is written");
  assert.equal(calls.some(({ argv }) => argv[0] === "/usr/bin/tee"), false, "tee echoes the secret to stdout");
  assert.equal(order.at(-1), `/bin/mv -f ${tmp} ${dir}/api-keys.json`);
  assert.deepEqual(parseStoredApiKeys(file), { zai: "zai-existing", openrouter: secret });
  assert.equal(maskApiKey(secret), "••••1234");

  await saveStoredApiKey(exec, "/Users/me", "openrouter", "");
  assert.deepEqual(parseStoredApiKeys(file), { zai: "zai-existing" });
  await assert.rejects(saveStoredApiKey(exec, "/Users/me", "claude", secret));
});

test("security: popover API key field is masked and explains local-only storage", async () => {
  const source = await readFile(new URL("../popovers/usage.js", import.meta.url), "utf8");
  assert.match(source, /input\.type = "password"/);
  assert.match(source, /input\.autocomplete = "off"/);
  assert.match(source, /Saved only on this Mac/);
  assert.doesNotMatch(source, /console\.(log|warn)\([^)]*draft/);
});

test("regression: background restores the cached status bar text on activation", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const background = await readFile(new URL("../src/background.mjs", import.meta.url), "utf8");
  const cacheSource = await readFile(new URL("../src/status-cache.mjs", import.meta.url), "utf8");
  const cacheCode = `${background}\n${cacheSource}`;

  assert.equal(manifest.muxy.background, "background.js");
  assert.match(background, /muxy\.events\.subscribe\("extension\.ai-usage\.keepalive"/);
  assert.match(cacheCode, /status-cache\.json/);
  assert.match(background, /muxy\.statusbar\.set/);
  assert.match(background, /typeof setInterval === "function"/);
  assert.doesNotMatch(cacheCode, /\.config\/muxy\/extensions\/ai-usage/);
  // setInterval은 polling loop에서 의도적으로 사용됨
  // assert.doesNotMatch(background, /setInterval/);
});

test("regression: status cache lives in Application Support, never the opened project folder", async () => {
  const { statusCachePath, writeStatusCache } = await import("../src/status-cache.mjs");
  assert.equal(statusCachePath("/Users/me"), "/Users/me/Library/Application Support/muxy-ai-usage/status-cache.json");
  assert.equal(statusCachePath(""), "");

  const calls = [];
  const exec = async (argv) => {
    calls.push(argv);
    if (argv[0] === "/usr/bin/env") return { exitCode: 0, stdout: "HOME=/Users/me\n" };
    return { exitCode: 0, stdout: "" };
  };
  await writeStatusCache(exec, [], { displayMode: "used", pinnedPreview: "", autoRefreshSeconds: 300, trackedProviderIDs: new Set() });

  const paths = calls.filter((argv) => argv[0] !== "/usr/bin/env").flatMap((argv) => argv.slice(1).filter((arg) => !arg.startsWith("-")));
  assert.ok(paths.length > 0);
  for (const path of paths) assert.match(path, /^\/Users\/me\/Library\/Application Support\/muxy-ai-usage(\/|$)/);
});

test("regression: background reuses the live collectors instead of per-provider copies", async () => {
  const background = await readFile(new URL("../src/background.mjs", import.meta.url), "utf8");

  // Hand-copied background collectors drifted from the live ones (endpoint,
  // parser return shape, credential tables) and failed silently. Background
  // must go through fetchLiveSnapshots so every provider stays in sync.
  assert.match(background, /import \{ fetchLiveSnapshots \} from "\.\/live\.mjs"/);
  assert.doesNotMatch(background, /function fetch\w+Sync\(/);
  assert.doesNotMatch(background, /function syncCurl\(/);
  assert.doesNotMatch(background, /CredPaths/);
});

test("regression: background poll refreshes every cached provider, including ones it never covered", async () => {
  const { cachePath, cache, muxy, writes } = backgroundFixture({ popoverActive: false });

  vm.runInNewContext(await readFile(new URL("../dist/background.js", import.meta.url), "utf8"), backgroundContext(muxy));
  await settle();

  assert.deepEqual(muxy.warnings, []);
  const written = writes.at(-1);
  assert.ok(written, `expected a cache write to ${cachePath}`);
  const byID = Object.fromEntries(written.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  assert.deepEqual(Object.keys(byID).sort(), cache.snapshots.map((snapshot) => snapshot.id).sort());
  assert.deepEqual(byID.codex.rows.map((row) => [row.label, row.percent]), [["5h", 44.4], ["7d", 12]]);
  assert.deepEqual(byID.kimi.rows.map((row) => [row.label, row.percent]), [["Session", 50]]);
  assert.deepEqual(byID.factory.rows.map((row) => [row.label, row.percent]), [["Standard", 25], ["Premium", 80]]);
  assert.deepEqual(byID.claude.rows.map((row) => [row.label, row.percent]), [["5h", 67.8]]);
  assert.equal(byID.claude.planName, "Max");
  assert.deepEqual(byID.minimax.rows.map((row) => [row.label, row.percent]), [["Session", 75]]);
  assert.deepEqual(byID.alibaba.rows.map((row) => [row.label, row.percent]), [["5h", 50], ["7d", 25]]);
  for (const snapshot of written.snapshots) {
    assert.notEqual(snapshot.fetchedAt, "2026-01-01T00:00:00.000Z", `${snapshot.id} was not refreshed`);
    assert.equal(snapshot.state.kind, "available");
  }
  assert.equal("popoverHeartbeat" in written, false);
});

test("regression: background poll keeps token-rotating providers and failed fetches on their cached snapshot", async () => {
  const { cache, muxy, writes, curlHosts } = backgroundFixture({ popoverActive: true, failCodex: true });

  vm.runInNewContext(await readFile(new URL("../dist/background.js", import.meta.url), "utf8"), backgroundContext(muxy));
  await settle();

  assert.deepEqual(muxy.warnings, []);
  const byID = Object.fromEntries(writes.at(-1).snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const stale = Object.fromEntries(cache.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  // Popover is active: kimi/claude rotate refresh tokens, so background leaves them alone.
  assert.equal(curlHosts.some((host) => host.includes("api.kimi.com") || host.includes("api.anthropic.com")), false);
  assert.deepEqual(byID.kimi, stale.kimi);
  assert.deepEqual(byID.claude, stale.claude);
  // A failing provider keeps its previous snapshot instead of flipping to unavailable.
  assert.deepEqual(byID.codex, stale.codex);
  assert.equal(byID.factory.fetchedAt === stale.factory.fetchedAt, false);
});

test("regression: background activation survives runtimes without timers", async () => {
  const source = await readFile(new URL("../dist/background.js", import.meta.url), "utf8");
  const calls = [];
  const context = {
    muxy: {
      events: {
        subscribe: (name, handler) => calls.push(["subscribe", name, typeof handler])
      },
      exec: (argv) => {
        if (argv[0] === "/usr/bin/env") return { exitCode: 0, stdout: "HOME=/tmp/home\n" };
        return { exitCode: 1, stdout: "", stderr: "missing" };
      },
      statusbar: {
        set: (payload) => calls.push(["statusbar", payload])
      }
    },
    console: {
      log: () => {},
      warn: (...args) => calls.push(["warn", args[0]])
    },
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Infinity
  };

  assert.doesNotThrow(() => vm.runInNewContext(source, context));
  assert.deepEqual(calls[0], ["subscribe", "extension.ai-usage.keepalive", "function"]);
  assert.equal(calls.some((call) => call[0] === "warn" && call[1] === "ai-usage background polling timer unavailable"), true);
});

test("regression: popover exposes only useful top controls and keeps fixed host width", async () => {
  const html = await readFile(new URL("../popovers/usage.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../popovers/usage.js", import.meta.url), "utf8");

  assert.doesNotMatch(html, /id="enabled"/);
  assert.doesNotMatch(html, /id="secondary"/);
  assert.match(html, /id="displayMode"/);
  assert.match(html, /id="autoRefresh"/);
  assert.match(source, /const popoverWidth = 360;/);
  assert.match(source, /muxy\.popover\.resize\(popoverWidth,/);
  assert.doesNotMatch(source, /Status bar API unavailable/);
  assert.doesNotMatch(source, /Status bar update failed/);
  assert.match(source, /window\.muxy\.statusbar\.set/);
  assert.match(source, /preferences\.enabled = true;/);
  assert.match(source, /preferences\.includeSecondary = true;/);
  assert.match(source, /localStorage\.setItem\(`\$\{storagePrefix\}enabled`, "true"\)/);
  assert.match(source, /localStorage\.setItem\(`\$\{storagePrefix\}includeSecondary`, "true"\)/);
});

test("regression: popover chrome follows the Muxy extension theme scale", async () => {
  const css = await readFile(new URL("../popovers/usage.css", import.meta.url), "utf8");
  const groups = await readFile(new URL("../popovers/provider-groups.css", import.meta.url), "utf8");
  const chrome = `${css}\n${groups}`;

  assert.match(css, /--font-body: 12px/);
  assert.match(css, /--font-title: 14px/);
  assert.match(css, /--control: 24px/);
  assert.match(css, /--radius: 6px/);
  assert.match(css, /--radius-card: 8px/);
  assert.match(css, /scrollbar-gutter: stable/);
  assert.match(css, /\.wrap \{[^}]*width: 360px/s);
  assert.match(css, /background: transparent/);
  assert.doesNotMatch(chrome, /var\(--muxy-[^)]+,\s*#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(chrome, /linear-gradient/);
  assert.doesNotMatch(chrome, /translateY/);
});

function backgroundFixture({ popoverActive, failCodex = false }) {
  const home = "/tmp/home";
  const cachePath = `${home}/Library/Application Support/muxy-ai-usage/status-cache.json`;
  const staleSnapshot = (id, name) => ({ id, name, icon: id, state: { kind: "available" }, fetchedAt: "2026-01-01T00:00:00.000Z", rows: [{ id: "old", label: "old", percent: 1, resetAt: null, detail: null, periodDuration: null }] });
  const cache = {
    version: 1,
    autoRefreshSeconds: 300,
    ...(popoverActive ? { popoverHeartbeat: Date.now() } : {}),
    snapshots: [
      staleSnapshot("codex", "Codex"),
      staleSnapshot("kimi", "Kimi"),
      staleSnapshot("factory", "Factory"),
      staleSnapshot("claude", "Claude Code"),
      staleSnapshot("minimax", "MiniMax"),
      staleSnapshot("alibaba", "Alibaba"),
    ],
  };
  const files = {
    [cachePath]: JSON.stringify(cache),
    [`${home}/.codex/auth.json`]: JSON.stringify({ tokens: { access_token: "codex-token", account_id: "account-1" } }),
    [`${home}/.kimi-code/credentials/kimi-code.json`]: JSON.stringify({ access_token: "kimi-token", expires_at: 9999999999 }),
    [`${home}/.factory/auth.json`]: JSON.stringify({ tokens: { access_token: "factory-token" } }),
    [`${home}/.claude/.credentials.json`]: JSON.stringify({ claudeAiOauth: { accessToken: "claude-token" } }),
    [`${home}/.bailian/config.json`]: JSON.stringify({ access_token: "console-token" }),
  };
  const responses = [
    ["chatgpt.com/backend-api/wham/usage", failCodex ? null : { plan_type: "prolite", rate_limit: { primary_window: { used_percent: 44.4, limit_window_seconds: 18000 }, secondary_window: { used_percent: 12, limit_window_seconds: 604800 } } }],
    ["api.kimi.com/coding/v1/usages", { data: { limits: [{ window: { duration: 5, timeUnit: "HOUR" }, detail: { limit: 100, used: 50 } }] } }],
    ["api.factory.ai/api/organization/subscription/usage", { usage: { startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-07-01T00:00:00.000Z", standard: { totalAllowance: 1000, orgTotalTokensUsed: 250 }, premium: { totalAllowance: 100, orgTotalTokensUsed: 80 } } }],
    ["api.anthropic.com/api/oauth/usage", { plan: { display_name: "Max" }, five_hour: { utilization: 67.8 } }],
    ["api.minimax.io/v1/api/openplatform/coding_plan/remains", { data: { result: { modelRemains: [{ currentIntervalTotalCount: 100, currentIntervalRemainingCount: 25 }] } } }],
    ["bailian-cs.console.aliyun.com/cli/api.json", { data: { per5HourPercentage: 0.5, per1WeekPercentage: 0.25 } }],
  ];
  const writes = [];
  const curlHosts = [];
  const fail = { exitCode: 1, stdout: "", stderr: "" };
  const muxy = {
    warnings: [],
    events: { subscribe: () => {} },
    statusbar: { set: () => {} },
    exec: (argv, options = {}) => {
      if (argv[0] === "/usr/bin/env") return { exitCode: 0, stdout: `HOME=${home}\nUSER=me\nMINIMAX_API_KEY=minimax-token\n` };
      if (argv[0] === "/bin/cat") return argv[1] in files ? { exitCode: 0, stdout: files[argv[1]] } : fail;
      if (argv[0] === "/usr/bin/curl") {
        const url = /url = "([^"]+)"/.exec(options.stdin)?.[1] || "";
        curlHosts.push(url);
        const match = responses.find(([needle]) => url.includes(needle));
        if (!match || match[1] === null) return { exitCode: 0, stdout: "{}\n500" };
        return { exitCode: 0, stdout: `${JSON.stringify(match[1])}\n200` };
      }
      if (argv[0] === "/usr/bin/tee" && argv[1] === `${cachePath}.tmp`) {
        writes.push(JSON.parse(options.stdin));
        return { exitCode: 0, stdout: "" };
      }
      if (argv[0] === "/bin/mkdir" || argv[0] === "/bin/mv") return { exitCode: 0, stdout: "" };
      return fail;
    },
  };
  return { cachePath, cache, muxy, writes, curlHosts };
}

function backgroundContext(muxy) {
  const warn = (...args) => {
    if (args[0] === "ai-usage background polling timer unavailable") return;
    muxy.warnings.push(args.map(String).join(" "));
  };
  return { muxy, console: { log: () => {}, warn }, Date, JSON, Math, Number, String, Array, Object, Infinity, Promise };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
