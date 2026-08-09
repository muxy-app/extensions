import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { oneLine, isSafeSessionId } from "../src/lib/sanitize.js";
import { shellQuote } from "../src/lib/shell-quote.js";
import { buildResumeCommand, buildStartCommand } from "../src/lib/resume.js";
import { buildGroups, filterGroups, groupByDate } from "../src/lib/sessions/group.js";
import { dateGroup, relativeTime } from "../src/lib/time.js";
import { PROVIDERS, providerById } from "../src/lib/sessions/providers.js";
import {
  editTargetStillPresent,
  evaluateRenameDraft,
  findSessionByKey,
  sessionRowKey,
} from "../src/lib/sessions/inline-rename.js";
import {
  buildStartActionModel,
  isFilterStartOverride,
  pickStartCli,
  resolveStartPreference,
  shouldHealPreferredAfterStart,
  showStartCliMenu,
  startButtonLabel,
  startMenuItems,
} from "../src/lib/sessions/start-cli.js";
import * as manageApi from "../src/lib/sessions/manage.js";
import * as storageApi from "../src/lib/storage.js";

describe("sanitize", () => {
  it("collapses whitespace and strips control chars", () => {
    assert.equal(oneLine("  hello\n\tworld\u0001  "), "hello world\uFFFD");
  });

  it("accepts UUIDs and rejects shell metacharacters", () => {
    assert.equal(isSafeSessionId("019fd37f-cc78-76c3-ba12-c5008005b813"), true);
    assert.equal(isSafeSessionId("abc;rm -rf /"), false);
    assert.equal(isSafeSessionId("short"), false);
  });

  it("accepts OpenCode ses_ session ids", () => {
    assert.equal(isSafeSessionId("ses_0123456789abcdef"), true);
  });

  it("rejects Copilot stub id prefixes", () => {
    assert.equal(
      isSafeSessionId("optimistic-chat-e4b462a3-3628-4aad-90ae-43b9c4fee922"),
      false,
    );
    assert.equal(isSafeSessionId("pending-session-draft-abc123"), false);
  });
});

describe("shell-quote", () => {
  it("single-quotes and escapes", () => {
    assert.equal(shellQuote("a'b"), `'a'\\''b'`);
  });
});

describe("resume commands", () => {
  const id = "019fd37f-cc78-76c3-ba12-c5008005b813";
  it("builds per-cli resume strings", () => {
    assert.match(buildResumeCommand("grok", id), /^grok --resume '/);
    assert.match(buildResumeCommand("claude", id), /^claude --resume '/);
    assert.match(buildResumeCommand("codex", id), /^codex resume '/);
    assert.match(buildResumeCommand("copilot", id), /^copilot --resume='/);
    assert.match(buildResumeCommand("cursor", id), /^cursor-agent --resume '/);
    assert.match(buildResumeCommand("opencode", "ses_abc123def"), /^opencode --session '/);
  });
  it("start commands", () => {
    assert.equal(buildStartCommand("grok"), "grok");
    assert.equal(buildStartCommand("cursor"), "cursor-agent");
    assert.equal(buildStartCommand("opencode"), "opencode");
  });
});

describe("group", () => {
  it("orders groups by latest session and omits empty", () => {
    const installed = [
      { id: "grok", displayName: "Grok" },
      { id: "claude", displayName: "Claude" },
      { id: "codex", displayName: "Codex" },
    ];
    const groups = buildGroups(
      installed,
      {
        grok: [{ id: "1", title: "g", updatedAt: 100, cli: "grok" }],
        claude: [{ id: "2", title: "c", updatedAt: 200, cli: "claude" }],
        codex: [],
      },
      {},
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].cli, "claude");
    assert.equal(groups[1].cli, "grok");
    assert.equal(filterGroups(groups, "grok").length, 1);
  });

  it("keeps error-only groups", () => {
    const groups = buildGroups(
      [{ id: "claude", displayName: "Claude" }],
      { claude: [] },
      { claude: "boom" },
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].error, "boom");
  });
});

describe("relativeTime", () => {
  it("formats recent times", () => {
    assert.equal(relativeTime(Date.now() -  thr_ms(0.5)), "just now");
    assert.match(relativeTime(Date.now() - thr_ms(5)), /5m ago/);
  });
});

describe("dateGroup", () => {
  it("returns Today for now", () => {
    assert.equal(dateGroup(Date.now()), "Today");
  });
  it("returns Yesterday for 1 day ago", () => {
    assert.equal(dateGroup(Date.now() - 86400000), "Yesterday");
  });
  it("returns Unknown for falsy input", () => {
    assert.equal(dateGroup(0), "Unknown");
  });
});

describe("groupByDate", () => {
  it("groups sessions by date label", () => {
    const sessions = [
      { id: "1", updatedAt: Date.now() },
      { id: "2", updatedAt: Date.now() },
      { id: "3", updatedAt: Date.now() - 86400000 },
    ];
    const groups = groupByDate(sessions, dateGroup);
    assert.equal(groups[0].label, "Today");
    assert.equal(groups[0].sessions.length, 2);
    assert.equal(groups[1].label, "Yesterday");
    assert.equal(groups[1].sessions.length, 1);
  });
});

function thr_ms(minutes) {
  return minutes * 60 * 1000;
};

describe("providers capabilities", () => {
  it("every provider has a capabilities object with rename/delete booleans only", () => {
    for (const p of PROVIDERS) {
      assert.ok(p.capabilities, `${p.id} missing capabilities`);
      assert.equal(typeof p.capabilities.rename, "boolean", `${p.id}.capabilities.rename`);
      assert.equal(typeof p.capabilities.delete, "boolean", `${p.id}.capabilities.delete`);
      assert.deepEqual(
        Object.keys(p.capabilities).sort(),
        ["delete", "rename"],
        `${p.id} capabilities keys`,
      );
    }
  });

  it("grok supports rename and delete", () => {
    const grok = providerById("grok");
    assert.equal(grok.capabilities.rename, true);
    assert.equal(grok.capabilities.delete, true);
  });

  it("claude supports delete but not rename", () => {
    const claude = providerById("claude");
    assert.equal(claude.capabilities.rename, false);
    assert.equal(claude.capabilities.delete, true);
  });

  it("codex supports rename but not delete", () => {
    const codex = providerById("codex");
    assert.equal(codex.capabilities.rename, true);
    assert.equal(codex.capabilities.delete, false);
  });

  it("copilot supports rename but not delete", () => {
    const copilot = providerById("copilot");
    assert.equal(copilot.capabilities.rename, true);
    assert.equal(copilot.capabilities.delete, false);
  });

  it("cursor supports rename and delete", () => {
    const cursor = providerById("cursor");
    assert.equal(cursor.capabilities.rename, true);
    assert.equal(cursor.capabilities.delete, true);
  });
});


describe("archive API surface removed", () => {
  it("manage/storage no longer export archive APIs", () => {
    assert.equal("archiveSession" in manageApi, false);
    for (const name of [
      "getArchivedSessions",
      "setSessionArchived",
      "getShowArchived",
      "setShowArchived",
    ]) {
      assert.equal(name in storageApi, false, name);
    }
  });
});

describe("inline-rename helpers", () => {
  it("sessionRowKey joins cli and id", () => {
    assert.equal(sessionRowKey("grok", "abc"), "grok:abc");
  });

  it("evaluateRenameDraft rejects empty and whitespace", () => {
    assert.deepEqual(evaluateRenameDraft("Old", ""), { action: "empty" });
    assert.deepEqual(evaluateRenameDraft("Old", "   "), { action: "empty" });
    assert.deepEqual(evaluateRenameDraft("Old", null), { action: "empty" });
  });

  it("evaluateRenameDraft treats trimmed equal titles as unchanged", () => {
    assert.deepEqual(evaluateRenameDraft("Hello", "Hello"), { action: "unchanged" });
    assert.deepEqual(evaluateRenameDraft("Hello", "  Hello  "), { action: "unchanged" });
  });

  it("evaluateRenameDraft commits trimmed new titles", () => {
    assert.deepEqual(evaluateRenameDraft("Old", "  New title  "), {
      action: "commit",
      title: "New title",
    });
  });

  it("editTargetStillPresent finds keys in groups", () => {
    const groups = [
      { sessions: [{ cli: "grok", id: "1" }] },
      { sessions: [{ cli: "codex", id: "2" }] },
    ];
    assert.equal(editTargetStillPresent("grok:1", groups), true);
    assert.equal(editTargetStillPresent("codex:9", groups), false);
    assert.equal(editTargetStillPresent(null, groups), false);
  });

  it("findSessionByKey returns the matching session", () => {
    const groups = [{ sessions: [{ cli: "cursor", id: "x", title: "T" }] }];
    assert.equal(findSessionByKey("cursor:x", groups)?.title, "T");
    assert.equal(findSessionByKey("cursor:y", groups), null);
  });
});

describe("start-cli helpers", () => {
  const multi = [
    { id: "claude", displayName: "Claude" },
    { id: "codex", displayName: "Codex" },
    { id: "grok", displayName: "Grok" },
  ];
  const single = [{ id: "codex", displayName: "Codex" }];

  it("pickStartCli prefers stored when installed", () => {
    assert.equal(pickStartCli("codex", multi), "codex");
  });

  it("pickStartCli falls back to START_PREFERENCE order", () => {
    assert.equal(pickStartCli("missing", multi), "grok");
    assert.equal(pickStartCli(null, multi), "grok");
    assert.equal(pickStartCli("grok", single), "codex");
  });

  it("pickStartCli returns null when nothing installed", () => {
    assert.equal(pickStartCli("grok", []), null);
  });

  it("showStartCliMenu only when two or more CLIs", () => {
    assert.equal(showStartCliMenu([]), false);
    assert.equal(showStartCliMenu(single), false);
    assert.equal(showStartCliMenu(multi), true);
  });

  it("startButtonLabel includes display name", () => {
    assert.equal(startButtonLabel("claude", multi), "Start new Claude");
    assert.equal(startButtonLabel(null, multi), "Start new session");
  });

  it("startMenuItems orders by START_PREFERENCE and marks selected", () => {
    const items = startMenuItems("codex", multi);
    assert.deepEqual(
      items.map((i) => i.id),
      ["grok", "claude", "codex"],
    );
    assert.equal(items.find((i) => i.id === "codex")?.selected, true);
    assert.equal(items.filter((i) => i.selected).length, 1);
  });

  it("startMenuItems selects fallback when preferred uninstalled", () => {
    const items = startMenuItems("cursor", multi);
    assert.equal(items.find((i) => i.id === "grok")?.selected, true);
  });

  it("buildStartActionModel combines fields", () => {
    const model = buildStartActionModel("claude", multi);
    assert.equal(model.startCli, "claude");
    assert.equal(model.label, "Start new Claude");
    assert.equal(model.showMenu, true);
    assert.equal(model.items.length, 3);

    const alone = buildStartActionModel("codex", single);
    assert.equal(alone.showMenu, false);
    assert.equal(alone.label, "Start new Codex");
  });

  it("resolveStartPreference uses installed filter over preferred", () => {
    assert.equal(resolveStartPreference("grok", "all", multi), "grok");
    assert.equal(resolveStartPreference("grok", "claude", multi), "claude");
    assert.equal(resolveStartPreference("grok", "cursor", multi), "grok");
    assert.equal(resolveStartPreference("grok", "claude", []), "grok");
    assert.equal(resolveStartPreference(null, "codex", multi), "codex");
  });

  it("isFilterStartOverride is true only for installed provider filters", () => {
    assert.equal(isFilterStartOverride("all", multi), false);
    assert.equal(isFilterStartOverride("claude", multi), true);
    assert.equal(isFilterStartOverride("cursor", multi), false);
    assert.equal(isFilterStartOverride("claude", []), false);
    assert.equal(isFilterStartOverride(null, multi), false);
  });

  it("buildStartActionModel with filter overrides preferred for label/start/selected", () => {
    const model = buildStartActionModel("grok", multi, "claude");
    assert.equal(model.startCli, "claude");
    assert.equal(model.label, "Start new Claude");
    assert.equal(model.items.find((i) => i.id === "claude")?.selected, true);
    assert.equal(model.items.find((i) => i.id === "grok")?.selected, false);
  });

  it("buildStartActionModel default listFilter keeps preferred behavior", () => {
    const model = buildStartActionModel("claude", multi);
    assert.equal(model.startCli, "claude");
    assert.equal(model.label, "Start new Claude");
    assert.equal(model.items.find((i) => i.id === "claude")?.selected, true);
  });

  it("buildStartActionModel ignores uninstalled filter", () => {
    const model = buildStartActionModel("grok", multi, "cursor");
    assert.equal(model.startCli, "grok");
    assert.equal(model.label, "Start new Grok");
    assert.equal(model.items.find((i) => i.id === "grok")?.selected, true);
  });

  it("shouldHealPreferredAfterStart gates filter override and no-ops on match", () => {
    // Filter override + mismatch → never heal (filter Start must not persist).
    assert.equal(
      shouldHealPreferredAfterStart("claude", "grok", "claude", multi),
      false,
    );
    // No override + mismatch (ghost preferred fallback) → heal.
    assert.equal(
      shouldHealPreferredAfterStart("grok", "missing", "all", multi),
      true,
    );
    // Match → no-op.
    assert.equal(
      shouldHealPreferredAfterStart("grok", "grok", "all", multi),
      false,
    );
    // Uninstalled filter is not an override → heal allowed when mismatch.
    assert.equal(
      shouldHealPreferredAfterStart("grok", "missing", "cursor", multi),
      true,
    );
    assert.equal(
      shouldHealPreferredAfterStart(null, "grok", "all", multi),
      false,
    );
  });
});
