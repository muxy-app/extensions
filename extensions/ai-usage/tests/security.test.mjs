import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("security: popover exec commands use absolute binaries", async () => {
  const source = await readFile(new URL("../popovers/usage.js", import.meta.url), "utf8");
  const cacheSource = await readFile(new URL("../src/status-cache.mjs", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.mjs", import.meta.url), "utf8");

  for (const content of [source, cacheSource, background]) {
    assert.doesNotMatch(content, /printenv/);
    assert.doesNotMatch(content, /\/bin\/sh/);
    assert.doesNotMatch(content, /"-c"/);
    assert.doesNotMatch(content, /muxy\.exec\(\["[^/]/);
  }
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
  assert.doesNotMatch(background, /async/);
  assert.doesNotMatch(background, /await/);
  // setInterval은 polling loop에서 의도적으로 사용됨
  // assert.doesNotMatch(background, /setInterval/);
});

test("regression: background Claude collector matches the live collector", async () => {
  const background = await readFile(new URL("../src/background.mjs", import.meta.url), "utf8");

  // The live path was migrated to the OAuth usage endpoint and Bearer auth, but
  // the background collector kept calling api.claude.ai with a session cookie.
  // That host no longer resolves, so every background poll failed silently.
  assert.match(background, /api\.anthropic\.com\/api\/oauth\/usage/);
  assert.match(background, /platform\.claude\.com\/v1\/oauth\/token/);
  assert.doesNotMatch(background, /api\.claude\.ai/);
  assert.doesNotMatch(background, /sessionKey=/);

  // Credentials may live in the keychain rather than a file.
  assert.match(background, /find-generic-password/);
  assert.match(background, /Claude Code-credentials/);

  // parseClaudeRows returns { rows, planName }; the caller must not treat it as
  // an array, or Array.isArray() is always false and the poll returns null.
  assert.doesNotMatch(background, /Array\.isArray\(parseClaudeRows/);
  assert.doesNotMatch(background, /const rows = parseClaudeRows/);
});

test("regression: background credential paths are reachable from the startup poll", async () => {
  const background = await readFile(new URL("../src/background.mjs", import.meta.url), "utf8");

  // The activation block runs at the top of the module and calls poll()
  // immediately, so any module-level const it reaches is still in its temporal
  // dead zone. Credential path tables must be hoisted function declarations.
  assert.doesNotMatch(background, /const claudeCredPaths =/);
  assert.match(background, /function claudeCredPaths\(/);
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
