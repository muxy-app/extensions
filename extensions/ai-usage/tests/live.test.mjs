import assert from "node:assert/strict";
import test from "node:test";

import { fetchLiveSnapshots } from "../src/live.mjs";
import { parseOpenCodeGoRows } from "../src/live-parsers.mjs";

test("regression: live provider fetch reads Codex auth from disk and parses WHAM usage rows", async () => {
  const calls = [];
  const exec = async (argv, options = {}) => {
    calls.push({ argv, options });
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.config/codex/auth.json") {
      return ok(JSON.stringify({ tokens: { access_token: "codex-token", account_id: "account-1" } }));
    }
    if (argv[0] === "/bin/cat") return fail();
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("chatgpt.com/backend-api/wham/usage")) {
      assert.match(options.stdin, /Authorization: Bearer codex-token/);
      assert.match(options.stdin, /ChatGPT-Account-Id: account-1/);
      return ok(`${JSON.stringify({
        plan_type: "prolite",
        rate_limit: {
          primary_window: { used_percent: 44.4, reset_at: "2026-06-04T13:00:00.000Z", limit_window_seconds: 18000 },
          secondary_window: { used_percent: 12, reset_at: "2026-06-10T13:00:00.000Z", limit_window_seconds: 604800 },
        },
      })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec });
  const codex = snapshots.find((snapshot) => snapshot.id === "codex");

  assert.equal(codex.state.kind, "available");
  assert.deepEqual(codex.rows.map((row) => row.label), ["5h", "7d"]);
  assert.equal(codex.rows[0].percent, 44.4);
  assert.equal(codex.rows[0].periodDuration, 18000);
  assert.equal(codex.planName, "Pro 5x");
  assert.equal(calls.some((call) => call.argv[0] === "/usr/bin/curl" && call.options.stdin.includes("codex-token")), true);
});

test("regression: live provider fetch respects provider allowlist before credential reads", async () => {
  const calls = [];
  const exec = async (argv, options = {}) => {
    calls.push({ argv, options });
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.config/codex/auth.json") {
      return ok(JSON.stringify({ tokens: { access_token: "codex-token" } }));
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("chatgpt.com/backend-api/wham/usage")) {
      return ok(`${JSON.stringify({ rate_limit: { primary_window: { used_percent: 10 } } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["codex"] });

  assert.deepEqual(snapshots.map((snapshot) => snapshot.id), ["codex"]);
  assert.equal(calls.some((call) => call.argv[0] === "/usr/bin/security"), false);
  assert.equal(calls.some((call) => call.argv[1]?.includes(".claude")), false);
  assert.equal(calls.some((call) => call.options.stdin?.includes("api.anthropic.com")), false);
});

test("regression: live provider fetch reads Claude credentials and parses usage windows", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nUSER=me\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.claude/.credentials.json") {
      return ok(JSON.stringify({ claudeAiOauth: { accessToken: "claude-token" } }));
    }
    if (argv[0] === "/bin/cat") return fail();
    if (argv[0] === "/usr/bin/security") return fail();
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.anthropic.com/api/oauth/usage")) {
      assert.match(options.stdin, /anthropic-beta: oauth-2025-04-20/);
      return ok(`${JSON.stringify({
        plan: { display_name: "Max" },
        five_hour: { utilization: 67.8, resets_at: "2026-06-04T13:00:00.000Z" },
        seven_day: { used_percent: 20, reset_at: "2026-06-10T13:00:00.000Z" },
      })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec });
  const claude = snapshots.find((snapshot) => snapshot.id === "claude");

  assert.equal(claude.state.kind, "available");
  assert.deepEqual(claude.rows.map((row) => row.label), ["5h", "7d"]);
  assert.equal(claude.rows[0].detail, "67.8% used");
  assert.equal(claude.planName, "Max");
});

test("regression: Claude planName extracts tier suffix from rateLimitTier when API omits plan.display_name", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nUSER=me\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.claude/.credentials.json") {
      return ok(JSON.stringify({ claudeAiOauth: { accessToken: "claude-token", subscriptionType: "Max", rateLimitTier: "default_calude_max_5x" } }));
    }
    if (argv[0] === "/bin/cat") return fail();
    if (argv[0] === "/usr/bin/security") return fail();
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.anthropic.com/api/oauth/usage")) {
      return ok(`${JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2026-06-04T13:00:00.000Z" },
        seven_day: { used_percent: 5, reset_at: "2026-06-10T13:00:00.000Z" },
      })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec });
  const claude = snapshots.find((snapshot) => snapshot.id === "claude");

  assert.equal(claude.state.kind, "available");
  assert.equal(claude.planName, "Max 5x");
});

test("regression: Claude uses keychain credentials before a stale credentials file", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nUSER=me\n");
    if (argv[0] === "/usr/bin/security" && argv.includes("Claude Code-credentials")) {
      return ok(JSON.stringify({ claudeAiOauth: { accessToken: "fresh-keychain-token", subscriptionType: "Max" } }));
    }
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.claude/.credentials.json") {
      return ok(JSON.stringify({ claudeAiOauth: { accessToken: "stale-file-token", subscriptionType: "Pro" } }));
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.anthropic.com/api/oauth/usage")) {
      assert.match(options.stdin, /Authorization: Bearer fresh-keychain-token/);
      assert.match(options.stdin, /User-Agent: claude-code/);
      return ok(`${JSON.stringify({
        five_hour: { utilization: 11, resets_at: "2026-06-04T13:00:00.000Z" },
      })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["claude"] });
  const claude = snapshots.find((snapshot) => snapshot.id === "claude");

  assert.equal(claude.state.kind, "available");
  assert.equal(claude.rows[0].percent, 11);
  assert.equal(claude.planName, "Max");
});

test("regression: live provider fetch reads Factory plain credentials and parses token buckets", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.factory/auth.json") {
      return ok(JSON.stringify({ tokens: { access_token: "factory-token" } }));
    }
    if (argv[0] === "/bin/cat") return fail();
    if (argv[0] === "/usr/bin/security") return fail();
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.factory.ai/api/organization/subscription/usage")) {
      assert.match(options.stdin, /Authorization: Bearer factory-token/);
      return ok(`${JSON.stringify({
        plan_name: "Team",
        usage: {
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-07-01T00:00:00.000Z",
          standard: { totalAllowance: 1000, orgTotalTokensUsed: 250 },
          premium: { totalAllowance: 100, orgTotalTokensUsed: 80 },
        },
      })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec });
  const factory = snapshots.find((snapshot) => snapshot.id === "factory");

  assert.equal(factory.state.kind, "available");
  assert.deepEqual(factory.rows.map((row) => row.label), ["Standard", "Premium"]);
  assert.equal(factory.rows[1].percent, 80);
  assert.equal(factory.rows[0].periodDuration, 2592000);
  assert.equal(factory.planName, "Team");
});

test("regression: live provider fetch parses Amp usage", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nAMP_API_KEY=amp-token\n");
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("ampcode.com/api/internal")) {
      assert.match(options.stdin, /Authorization: Bearer amp-token/);
      return ok(`${JSON.stringify({ result: { displayText: "$25 / $100 remaining\nIndividual credits: $7 remaining" } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["amp"] });
  const amp = snapshots.find((snapshot) => snapshot.id === "amp");

  assert.equal(amp.state.kind, "available");
  assert.deepEqual(amp.rows.map((row) => row.label), ["Free balance", "Credits"]);
  assert.equal(amp.rows[0].percent, 75);
});

test("regression: live provider fetch parses Copilot quota snapshots", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nGH_TOKEN=github-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.github.com/copilot_internal/user")) {
      assert.match(options.stdin, /Authorization: token github-token/);
      return ok(`${JSON.stringify({
        plan: "Personal",
        quota_reset_date: "2026-07-01T00:00:00.000Z",
        quota_snapshots: { premium_interactions: { entitlement: 100, remaining: 40 } },
      })}\n200`);
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["copilot"] });
  const copilot = snapshots.find((snapshot) => snapshot.id === "copilot");

  assert.equal(copilot.state.kind, "available");
  assert.equal(copilot.rows[0].label, "Premium");
  assert.equal(copilot.rows[0].percent, 60);
  assert.equal(copilot.planName, "Personal");
});

test("regression: live provider fetch prefers new kimi-code credential path", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.kimi-code/credentials/kimi-code.json") {
      return ok(JSON.stringify({ access_token: "kimi-new-token", expires_at: 9999999999 }));
    }
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.kimi/credentials/kimi-code.json") {
      return fail(); // Should not be read
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.kimi.com/coding/v1/usages")) {
      assert.match(options.stdin, /Authorization: Bearer kimi-new-token/);
      return ok(`${JSON.stringify({ data: { limits: [{ window: { duration: 5, timeUnit: "HOUR" }, detail: { limit: 100, used: 50 } }] } })}
 200`);
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["kimi"] });
  const kimi = snapshots.find((snapshot) => snapshot.id === "kimi");

  assert.equal(kimi.state.kind, "available");
  assert.equal(kimi.rows[0].label, "Session");
  assert.equal(kimi.rows[0].percent, 50);
});

test("regression: live provider fetch falls back to legacy kimi credential path", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.kimi-code/credentials/kimi-code.json") {
      return fail(); // New path doesn't exist
    }
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.kimi/credentials/kimi-code.json") {
      return ok(JSON.stringify({ access_token: "kimi-legacy-token", expires_at: 9999999999 }));
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.kimi.com/coding/v1/usages")) {
      assert.match(options.stdin, /Authorization: Bearer kimi-legacy-token/);
      return ok(`${JSON.stringify({ data: { limits: [{ window: { duration: 5, timeUnit: "HOUR" }, detail: { limit: 100, used: 50 } }] } })}
 200`);
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["kimi"] });
  const kimi = snapshots.find((snapshot) => snapshot.id === "kimi");

  assert.equal(kimi.state.kind, "available");
  assert.equal(kimi.rows[0].label, "Session");
  assert.equal(kimi.rows[0].percent, 50);
});

test("regression: live provider fetch refreshes expired Kimi access token", async () => {
  let writtenToken = null;
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.kimi-code/credentials/kimi-code.json") {
      // Return expired token on first read, refreshed token after write
      if (writtenToken) {
        return ok(JSON.stringify(writtenToken));
      }
      return ok(JSON.stringify({ access_token: "kimi-expired-token", refresh_token: "kimi-refresh-token", expires_at: Math.floor(Date.now() / 1000) - 3600 }));
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/bin/sh" && options.stdin) {
      // Capture the written token
      writtenToken = JSON.parse(options.stdin);
      return ok("");
    }
    if (argv[0] === "/bin/mv") {
      return ok("");
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("auth.kimi.com/api/oauth/token")) {
      // Refresh token endpoint
      assert.match(options.stdin, /refresh_token=kimi-refresh-token/);
      return ok(`${JSON.stringify({ access_token: "kimi-refreshed-token", expires_in: 900, scope: "kimi-code", token_type: "Bearer" })}
 200`);
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.kimi.com/coding/v1/usages")) {
      assert.match(options.stdin, /Authorization: Bearer kimi-refreshed-token/);
      return ok(`${JSON.stringify({ data: { limits: [{ window: { duration: 5, timeUnit: "HOUR" }, detail: { limit: 100, used: 50 } }] } })}
200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["kimi"] });
  const kimi = snapshots.find((snapshot) => snapshot.id === "kimi");

  assert.equal(kimi.state.kind, "available");
  assert.equal(kimi.rows[0].label, "Session");
  assert.equal(kimi.rows[0].percent, 50);
  // Verify the token was written back to disk
  assert.equal(writtenToken?.access_token, "kimi-refreshed-token");
  assert.equal(writtenToken?.refresh_token, "kimi-refresh-token");
});

test("regression: live provider fetch parses MiniMax remains", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nMINIMAX_API_KEY=minimax-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.minimax.io/v1/api/openplatform/coding_plan/remains")) {
      assert.match(options.stdin, /Authorization: Bearer minimax-token/);
      return ok(`${JSON.stringify({ data: { plan_name: "Max_5.1", result: { modelRemains: [{ currentIntervalTotalCount: 100, currentIntervalRemainingCount: 25 }] } } })}\n200`);
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["minimax"] });
  const minimax = snapshots.find((snapshot) => snapshot.id === "minimax");

  assert.equal(minimax.state.kind, "available");
  assert.equal(minimax.rows[0].label, "Session");
  assert.equal(minimax.rows[0].percent, 75);
  assert.equal(minimax.planName, "Max_5.1");
});

test("regression: live provider fetch reads Alibaba Token Plan usage from the active bl profile", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.bailian/config.json") {
      return ok(JSON.stringify({
        active_config: "token-plan",
        "token-plan": { access_token: "bailian-console-token", api_key: "sk-sp-unused", console_region: "ap-southeast-1", console_site: "international", console_switch_agent: 123456 }
      }));
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("bailian-singapore-cs.alibabacloud.com/cli/api.json")) {
      assert.match(options.stdin, /action=IntlBroadScopeAspnGateway&product=sfm_bailian&api=zeldaHttp\.apikeyMgr\.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage/);
      assert.match(options.stdin, /Authorization: Bearer bailian-console-token/);
      assert.match(options.stdin, /Content-Type: application\/x-www-form-urlencoded/);
      assert.match(options.stdin, /region=ap-southeast-1/);
      assert.doesNotMatch(options.stdin, /sk-sp-unused/);
      const params = JSON.parse(decodeURIComponent(/params=([^&"]+)/.exec(options.stdin)[1]));
      assert.equal(params.Api, "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage");
      assert.equal(params.Data.cornerstoneParam.switchAgent, 123456);
      return ok(`${JSON.stringify({ data: { DataV2: { data: { data: { per5HourPercentage: 0.4217, per5HourResetTime: 1793000000000, per1WeekPercentage: 0.1 } } } } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["alibaba"] });
  const alibaba = snapshots.find((snapshot) => snapshot.id === "alibaba");

  assert.equal(alibaba.state.kind, "available");
  assert.deepEqual(alibaba.rows.map((row) => [row.label, row.percent]), [["5h", 42.17], ["7d", 10]]);
  assert.equal(alibaba.rows[0].resetAt.getTime(), 1793000000000);
  assert.equal(alibaba.planName, "Token Plan");
});

test("edge case: Alibaba Token Plan asks for console login when the session expired or no token exists", async () => {
  const expired = async (argv) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.bailian/config.json") return ok(JSON.stringify({ access_token: "stale" }));
    if (argv[0] === "/usr/bin/curl") return ok(`${JSON.stringify({ code: "ConsoleNeedLogin.NotLogined", success: false })}\n200`);
    return fail();
  };
  const missing = async (argv) => (argv[0] === "/usr/bin/env" ? ok("HOME=/tmp/home\n") : fail());

  for (const exec of [expired, missing]) {
    const [alibaba] = await fetchLiveSnapshots({ exec, providerIDs: ["alibaba"] });
    assert.equal(alibaba.state.kind, "unavailable");
    assert.equal(alibaba.state.message, "Run bl auth login --console");
  }
});

test("regression: API keys saved from the popover win over env keys and reach only the provider", async () => {
  const stored = JSON.stringify({ version: 1, keys: { openrouter: "sk-or-stored", zai: "zai-stored", minimax: "minimax-stored" } });
  const curlConfigs = [];
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nOPENROUTER_API_KEY=sk-or-env\nMINIMAX_CN_API_KEY=minimax-env\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/Library/Application Support/muxy-ai-usage/api-keys.json") return ok(stored);
    if (argv[0] === "/usr/bin/curl") {
      curlConfigs.push(options.stdin);
      return ok(`${JSON.stringify({ data: {} })}\n200`);
    }
    return fail();
  };

  await fetchLiveSnapshots({ exec, providerIDs: ["openrouter", "zai", "minimax"] });

  const byHost = (host) => curlConfigs.filter((config) => config.includes(host));
  assert.ok(byHost("openrouter.ai").length > 0);
  for (const config of byHost("openrouter.ai")) assert.match(config, /Bearer sk-or-stored/);
  for (const config of byHost("api.z.ai")) assert.match(config, /zai-stored/);
  // A key saved in the popover uses the international MiniMax endpoint even if a CN env key exists.
  assert.ok(byHost("api.minimax.io").length > 0);
  for (const config of byHost("api.minimax.io")) assert.match(config, /Bearer minimax-stored/);
  for (const config of curlConfigs) {
    for (const [key, host] of [["sk-or-stored", "openrouter.ai"], ["zai-stored", "api.z.ai"], ["minimax-stored", "minimax.io"]]) {
      if (config.includes(key)) assert.ok(config.includes(host), `${key} leaked to another host`);
    }
  }
});

test("regression: missing API keys are flagged so the popover can offer to add one", async () => {
  const exec = async (argv) => (argv[0] === "/usr/bin/env" ? ok("HOME=/tmp/home\nSHELL=/bin/zsh\n") : argv[0] === "/bin/zsh" ? ok("__MUXY_ZAI_API_KEY__") : fail());
  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["openrouter", "zai", "minimax"] });

  assert.deepEqual(snapshots.map((snapshot) => [snapshot.id, snapshot.state.message, snapshot.apiKeyMissing]), [
    ["openrouter", "API key needed", true],
    ["minimax", "API key needed", true],
    ["zai", "API key needed", true],
  ]);
});

test("regression: live provider fetch parses Z.ai quota limits", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nZAI_API_KEY=zai-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/biz/subscription/list")) {
      return ok(`${JSON.stringify({ data: [{ productName: "Pro" }] })}\n200`);
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/monitor/usage/quota/limit")) {
      assert.match(options.stdin, /Authorization: Bearer zai-token/);
      return ok(`${JSON.stringify({ data: { limits: [{ limitType: "TOKENS_LIMIT", unit: 3, percentage: 55 }] } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["zai"] });
  const zai = snapshots.find((snapshot) => snapshot.id === "zai");

  assert.equal(zai.state.kind, "available");
  assert.equal(zai.rows[0].label, "Session");
  assert.equal(zai.rows[0].percent, 55);
  assert.equal(zai.planName, "Pro");
});

test("regression: live provider fetch parses Z.ai GLM Coding Plan quota shape from ZAI_API_KEY", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nZAI_API_KEY=zai-auth-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/biz/subscription/list")) {
      assert.match(options.stdin, /Authorization: Bearer zai-auth-token/);
      return ok(`${JSON.stringify({ data: [{ productName: "GLM Coding Pro" }] })}\n200`);
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/monitor/usage/quota/limit")) {
      return ok(`${JSON.stringify({ data: { limits: [
        { type: "TOKENS_LIMIT", unit: 3, currentValue: 80, usage: 400, nextResetTime: "2026-07-01T05:00:00.000Z" },
        { type: "TOKENS_LIMIT", unit: 6, currentValue: 300, usage: 2000, nextResetTime: "2026-07-06T00:00:00.000Z" },
        { type: "TIME_LIMIT", currentValue: 10, usage: 1000 },
      ] } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["zai"] });
  const zai = snapshots.find((snapshot) => snapshot.id === "zai");

  assert.equal(zai.state.kind, "available");
  assert.deepEqual(zai.rows.map((row) => row.label), ["Session", "Weekly", "MCP"]);
  assert.equal(zai.rows[0].percent, 20);
  assert.equal(zai.rows[1].percent, 15);
  assert.equal(zai.rows[2].percent, 1);
  assert.equal(zai.planName, "GLM Coding Pro");
});

test("regression: live provider fetch parses Z.ai CREDIT_LIMIT windows (GLM Coding Max)", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nZAI_API_KEY=zai-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/biz/subscription/list")) {
      return ok(`${JSON.stringify({ code: 200, data: [{ productName: "GLM Coding Max", status: "VALID" }], success: true })}\n200`);
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/monitor/usage/quota/limit")) {
      return ok(`${JSON.stringify({ code: 200, data: { limits: [
        { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 28000, currentValue: 1958, remaining: 26041, percentage: 6, nextResetTime: 1791744856004 },
        { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 140000, currentValue: 76214, remaining: 63785, percentage: 54, nextResetTime: 1792205583999 },
      ], level: "max" }, success: true })}\n200`);
    }
    return fail();
  };

  const [zai] = await fetchLiveSnapshots({ exec, providerIDs: ["zai"] });

  assert.equal(zai.state.kind, "available");
  assert.deepEqual(zai.rows.map((row) => [row.label, row.percent, row.detail]), [["Session", 6, "1958/28000"], ["Weekly", 54, "76214/140000"]]);
  assert.equal(zai.rows[0].resetAt.getTime(), 1791744856004);
  assert.equal(zai.planName, "GLM Coding Max");
});

test("regression: live provider fetch asks for an API key when Z.ai env is missing", async () => {
  const exec = async (argv) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/zsh") return ok("__MUXY_ZAI_API_KEY__");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["zai"] });
  const zai = snapshots.find((snapshot) => snapshot.id === "zai");

  assert.equal(zai.state.kind, "unavailable");
  assert.equal(zai.state.message, "API key needed");
  assert.equal(zai.apiKeyMissing, true);
});

test("regression: live provider fetch reads ZAI_API_KEY from the login shell when Muxy env misses it", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nSHELL=/bin/zsh\n");
    if (argv[0] === "/bin/zsh" && argv[1] === "-lic") {
      assert.match(argv[2], /ZAI_API_KEY/);
      return ok("shell startup noise\n__MUXY_ZAI_API_KEY__shell-zai-token");
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/biz/subscription/list")) {
      assert.match(options.stdin, /Authorization: Bearer shell-zai-token/);
      return ok(`${JSON.stringify({ data: [{ productName: "Pro" }] })}\n200`);
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.z.ai/api/monitor/usage/quota/limit")) {
      assert.match(options.stdin, /Authorization: Bearer shell-zai-token/);
      return ok(`${JSON.stringify({ data: { limits: [{ limitType: "TOKENS_LIMIT", unit: 3, percentage: 31 }] } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["zai"] });
  const zai = snapshots.find((snapshot) => snapshot.id === "zai");

  assert.equal(zai.state.kind, "available");
  assert.equal(zai.rows[0].percent, 31);
  assert.equal(zai.planName, "Pro");
});

test("regression: live provider fetch parses OpenRouter credits and key usage", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nOPENROUTER_API_KEY=openrouter-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("openrouter.ai/api/v1/credits")) {
      assert.match(options.stdin, /Authorization: Bearer openrouter-token/);
      return ok(`${JSON.stringify({ data: { total_usage: 12.5, total_credits: 50 } })}\n200`);
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("openrouter.ai/api/v1/key")) {
      return ok(`${JSON.stringify({ data: { is_free_tier: false, usage_daily: 1.25, usage_weekly: 4, usage_monthly: 9, usage: 10, limit: 100 } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["openrouter"] });
  const openrouter = snapshots.find((snapshot) => snapshot.id === "openrouter");

  assert.equal(openrouter.state.kind, "available");
  assert.deepEqual(openrouter.rows.map((row) => row.label), ["Credits", "Balance", "Today", "This Week", "This Month", "Key Limit"]);
  assert.equal(openrouter.rows[0].percent, 25);
  assert.equal(openrouter.rows[1].detail, "$37.5");
  assert.equal(openrouter.planName, "Pay as you go");
});

test("regression: live provider fetch parses Devin quota", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nDEVIN_API_KEY=devin-token\n");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("SeatManagementService/GetUserStatus")) {
      assert.match(options.stdin, /devin-token/);
      return ok(`${JSON.stringify({ userStatus: { planStatus: {
        planInfo: { planName: "Team" },
        dailyQuotaRemainingPercent: 70,
        weeklyQuotaRemainingPercent: 40,
        dailyQuotaResetAtUnix: 1782892800,
        weeklyQuotaResetAtUnix: 1783292800,
        overageBalanceMicros: 12500000,
      } } })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["devin"] });
  const devin = snapshots.find((snapshot) => snapshot.id === "devin");

  assert.equal(devin.state.kind, "available");
  assert.deepEqual(devin.rows.map((row) => row.label), ["Daily quota", "Weekly quota", "Extra usage balance"]);
  assert.equal(devin.rows[0].percent, 30);
  assert.equal(devin.rows[1].percent, 60);
  assert.equal(devin.rows[2].detail, "$12.5");
  assert.equal(devin.planName, "Team");
});

test("regression: live provider fetch parses Antigravity quota summary", async () => {
  const raw = Buffer.from(JSON.stringify({ token: { access_token: "anti-token", expiry: "2099-01-01T00:00:00.000Z" } }), "utf8").toString("base64");
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\nUSER=me\n");
    if (argv[0] === "/bin/cat") return fail();
    if (argv[0] === "/usr/bin/security" && argv.includes("gemini") && argv.includes("antigravity")) return ok(`go-keyring-base64:${raw}`);
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary")) {
      assert.match(options.stdin, /Authorization: Bearer anti-token/);
      return ok(`${JSON.stringify({ groups: [{ buckets: [
        { bucketId: "gemini-5h", remainingFraction: 0.75, resetTime: "2026-07-01T05:00:00.000Z" },
        { bucketId: "gemini-weekly", remainingFraction: 0.9 },
        { bucketId: "3p-5h", remainingFraction: 0.4 },
      ] }] })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["antigravity"] });
  const antigravity = snapshots.find((snapshot) => snapshot.id === "antigravity");

  assert.equal(antigravity.state.kind, "available");
  assert.deepEqual(antigravity.rows.map((row) => row.label), ["Session", "Weekly", "Claude"]);
  assert.equal(antigravity.rows[0].percent, 25);
  assert.equal(antigravity.rows[2].percent, 60);
});

test("regression: live provider fetch reads Cursor credentials from SQLite and parses plan usage", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/usr/bin/sqlite3") {
      assert.match(argv[argv.length - 1], /cursorAuth\/accessToken/);
      return ok("cursorAuth/accessToken|cursor-jwt-token\ncursorAuth/stripeMembershipType|Ultra\n");
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage")) {
      assert.match(options.stdin, /Authorization: Bearer cursor-jwt-token/);
      assert.match(options.stdin, /Connect-Protocol-Version: 1/);
      return ok(`${JSON.stringify({
        planUsage: {
          totalSpend: 23222,
          includedSpend: 23222,
          bonusSpend: 0,
          remaining: 16778,
          limit: 40000,
          totalPercentUsed: 15.48,
          apiPercentUsed: 46.444,
        },
        billingCycleEnd: "2026-05-02T14:11:55.000Z",
      })}\n200`);
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["cursor"] });
  const cursor = snapshots.find((snapshot) => snapshot.id === "cursor");

  assert.equal(cursor.state.kind, "available");
  assert.deepEqual(cursor.rows.map((row) => row.label), ["Monthly"]);
  assert.equal(cursor.rows[0].percent, 15.48);
  assert.equal(cursor.rows[0].detail, "$232.22 / $400.00");
  assert.equal(cursor.rows[0].periodDuration, 2592000);
  assert.equal(cursor.planName, "Ultra");
});

test("regression: live provider fetch shows unauthenticated when Cursor SQLite DB missing", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/usr/bin/sqlite3") return fail();
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["cursor"] });
  const cursor = snapshots.find((snapshot) => snapshot.id === "cursor");

  assert.equal(cursor.state.kind, "unavailable");
  assert.equal(cursor.state.message, "Sign in to Cursor");
});

test("regression: live provider fetch reads Grok credentials from auth.json and parses billing", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.grok/auth.json") {
      return ok(JSON.stringify({ default: { key: "grok-jwt-token", refresh_token: "grok-refresh", oidc_client_id: "test-client-id" } }));
    }
    if (argv[0] === "/bin/cat") return fail();
    if (argv[0] === "/usr/bin/curl") {
      const stdin = options.stdin || "";
      const urlMatch = stdin.match(/url\s*=\s*"([^"]+)"/);
      const reqUrl = urlMatch ? urlMatch[1] : "";
      if (reqUrl.includes("billing?format=credits")) {
        return ok(`${JSON.stringify({ config: {
          creditUsagePercent: 42,
          currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-06-24T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" },
          onDemandCap: { val: 100 },
        } })}\n200`);
      }
      if (reqUrl.includes("settings")) {
        return ok(`${JSON.stringify({ subscription_tier_display: "SuperGrok" })}\n200`);
      }
    }
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["grok"] });
  const grok = snapshots.find((snapshot) => snapshot.id === "grok");

  assert.equal(grok.state.kind, "available");
  assert.deepEqual(grok.rows.map((row) => row.label), ["Weekly limit", "Pay as you go"]);
  assert.equal(grok.rows[0].percent, 42);
  assert.equal(grok.rows[0].detail, "42.0% used");
  assert.equal(grok.rows[0].periodDuration, 604800);
  assert.equal(grok.rows[1].detail, "100 cap");
  assert.equal(grok.planName, "SuperGrok");
});

test("regression: live provider fetch shows unauthenticated when Grok auth.json missing", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat") return fail();
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["grok"] });
  const grok = snapshots.find((snapshot) => snapshot.id === "grok");

  assert.equal(grok.state.kind, "unavailable");
  assert.equal(grok.state.message, "Sign in to Grok");
});

test("regression: live provider fetch reads OpenCode Go credentials and parses usage windows", async () => {
  const nowMs = Date.now();
  const mockData = [
    `${nowMs - 60000}|2`,
    `${nowMs - 300000}|2`,
    `${nowMs - 7200000}|2`,
  ].join("\n");

  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home/.local/share/opencode/auth.json") {
      return ok(JSON.stringify({ "opencode-go": { key: "test-key" } }));
    }
    if (argv[0] === "/bin/cat") return fail();
    if (argv[0] === "/usr/bin/sqlite3" && (argv[argv.length - 1] || "").includes("message")) {
      return ok(mockData);
    }
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["opencode-go"] });
  const opencode = snapshots.find((snapshot) => snapshot.id === "opencode-go");

  assert.equal(opencode.state.kind, "available");
  assert.deepEqual(opencode.rows.map((row) => row.label), ["Session", "Weekly", "Monthly"]);
  assert.equal(opencode.rows[0].percent, 50);
  assert.equal(opencode.rows[1].percent, 20);
  assert.equal(opencode.rows[2].percent, 10);
  assert.equal(opencode.rows[0].detail, "6.0 / 12 credits");
  assert.equal(opencode.rows[1].detail, "6.0 / 30 credits");
  assert.equal(opencode.rows[2].detail, "6.0 / 60 credits");
  assert.equal(opencode.planName, "Go");
});

test("regression: live provider fetch shows unauthenticated when OpenCode Go auth.json missing", async () => {
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home\n");
    if (argv[0] === "/bin/cat") return fail();
    if (argv[2]?.includes("/tmp/muxy/ai-usage-raw-")) return ok("");
    return fail();
  };

  const snapshots = await fetchLiveSnapshots({ exec, providerIDs: ["opencode-go"] });
  const opencode = snapshots.find((snapshot) => snapshot.id === "opencode-go");

  assert.equal(opencode.state.kind, "unavailable");
  assert.equal(opencode.state.message, "Sign in to OpenCode Go");
});

test("regression: parseOpenCodeGoRows monthly window uses earliest usage as anchor, not UTC calendar month", () => {
  // Anchor (earliest usage): April 15 (day 15). Now: June 10.
  // Expected monthly window: May 15 ~ June 15 (subscription-style).
  const nowMs = Date.UTC(2026, 5, 10, 12, 0, 0); // June 10, 2026
  const rows = [
    { createdMs: Date.UTC(2026, 3, 15, 10, 0, 0), cost: 5 },   // Apr 15 — anchor, before window
    { createdMs: Date.UTC(2026, 4, 15, 0, 0, 0), cost: 10 },   // May 15 — start of current window
    { createdMs: Date.UTC(2026, 5, 5, 0, 0, 0), cost: 10 },    // Jun 5  — within window
  ];

  const result = parseOpenCodeGoRows(rows, nowMs);
  const monthly = result.find((r) => r.label === "Monthly");

  // Window is May 15 ~ June 15. Only May 15 ($10) + Jun 5 ($10) = $20.
  // Anchor Apr 15 ($5) is outside the window.
  assert.equal(monthly.detail, "20.0 / 60 credits");
  assert.equal(monthly.resetAt.toISOString(), "2026-06-15T00:00:00.000Z");
});

test("regression: parseOpenCodeGoRows falls back to UTC calendar month when no rows exist", () => {
  const nowMs = Date.UTC(2026, 5, 10, 12, 0, 0); // June 10, 2026
  const result = parseOpenCodeGoRows([], nowMs);
  const monthly = result.find((r) => r.label === "Monthly");

  // No rows → anchor is null → UTC calendar month: June 1 ~ July 1
  assert.equal(monthly.resetAt.toISOString(), "2026-07-01T00:00:00.000Z");
});

// Kept last: the cooldown is module state, so it would block later Claude tests in this file.
test("regression: Claude 429 backs off for retry-after instead of re-calling the usage endpoint", async () => {
  let usageCalls = 0;
  const exec = async (argv, options = {}) => {
    if (argv[0] === "/usr/bin/env") return ok("HOME=/tmp/home-ratelimit\nUSER=me\n");
    if (argv[0] === "/bin/cat" && argv[1] === "/tmp/home-ratelimit/.claude/.credentials.json") {
      return ok(JSON.stringify({ claudeAiOauth: { accessToken: "claude-token" } }));
    }
    if (argv[0] === "/usr/bin/curl" && options.stdin.includes("api.anthropic.com/api/oauth/usage")) {
      usageCalls += 1;
      assert.ok(argv.includes("\n%{http_code} %header{retry-after}"));
      return ok(`${JSON.stringify({ error: { type: "rate_limit_error" } })}\n429 238`);
    }
    return fail();
  };

  const before = Date.now();
  const [first] = await fetchLiveSnapshots({ exec, providerIDs: ["claude"] });
  const [second] = await fetchLiveSnapshots({ exec, providerIDs: ["claude"] });

  assert.equal(usageCalls, 1);
  for (const claude of [first, second]) {
    assert.equal(claude.state.kind, "error");
    assert.match(claude.state.message, /^Rate limited until /);
    assert.ok(claude.rateLimitedUntil.getTime() >= before + 238000);
  }
});

function ok(stdout) {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stdout = "") {
  return { exitCode: 1, stdout, stderr: "" };
}
