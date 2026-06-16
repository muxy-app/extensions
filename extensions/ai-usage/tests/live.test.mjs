import assert from "node:assert/strict";
import test from "node:test";

import { fetchLiveSnapshots } from "../src/live.mjs";

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
      if (reqUrl.includes("billing")) {
        return ok(`${JSON.stringify({ config: { used: { val: 50 }, monthlyLimit: { val: 200 }, onDemandCap: { val: 100 }, billingPeriodEnd: "2026-07-01T00:00:00.000Z" } })}\n200`);
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
  assert.deepEqual(grok.rows.map((row) => row.label), ["Credits"]);
  assert.equal(grok.rows[0].percent, 25);
  assert.equal(grok.rows[0].detail, "50.0 / 200 units");
  assert.equal(grok.rows[0].periodDuration, 2592000);
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

function ok(stdout) {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stdout = "") {
  return { exitCode: 1, stdout, stderr: "" };
}
