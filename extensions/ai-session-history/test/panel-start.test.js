/**
 * Panel orchestration for filter-aware Start (#42 / #43).
 * Stubs instance seams so product rules on preferCli / startNew are locked
 * without mock.module (which would leak into storage tests).
 */
import { describe, it, expect, mock } from "bun:test";
import { SessionsPanel } from "../src/panel/app.js";

const multi = [
  { id: "grok", displayName: "Grok" },
  { id: "claude", displayName: "Claude" },
  { id: "codex", displayName: "Codex" },
];

function makePanel(overrides = {}) {
  const panel = new SessionsPanel({ replaceChildren() {} });
  panel.render = () => {};
  panel.installed = multi;
  panel.preferredCli = "grok";
  panel.filter = "all";
  panel._writePreferredCli = mock(async () => true);
  panel._writeListFilter = mock(async () => true);
  panel._openStartTerminal = mock(async () => {});
  Object.assign(panel, overrides);
  return panel;
}

describe("SessionsPanel preferCli / startNew", () => {
  it("menu pick always dual-writes preferred + filter all (even same preferred)", async () => {
    const panel = makePanel({ preferredCli: "claude", filter: "codex" });
    await panel.preferCli("claude");
    expect(panel.preferredCli).toBe("claude");
    expect(panel.filter).toBe("all");
    expect(panel._writePreferredCli).toHaveBeenCalledTimes(1);
    expect(panel._writePreferredCli).toHaveBeenCalledWith("claude");
    expect(panel._writeListFilter).toHaveBeenCalledTimes(1);
    expect(panel._writeListFilter).toHaveBeenCalledWith("all");
  });

  it("menu pick with new id dual-writes both values", async () => {
    const panel = makePanel({ preferredCli: "grok", filter: "claude" });
    await panel.preferCli("codex");
    expect(panel.preferredCli).toBe("codex");
    expect(panel.filter).toBe("all");
    expect(panel._writePreferredCli).toHaveBeenCalledWith("codex");
    expect(panel._writeListFilter).toHaveBeenCalledWith("all");
  });

  it("filter Start never writes preferredCli", async () => {
    const panel = makePanel({ preferredCli: "grok", filter: "claude" });
    await panel.startNew();
    expect(panel._openStartTerminal).toHaveBeenCalledWith("claude");
    expect(panel._writePreferredCli).not.toHaveBeenCalled();
  });

  it("heals preferred when fallback starts under filter=all", async () => {
    const panel = makePanel({
      preferredCli: "cursor",
      filter: "all",
      installed: multi,
    });
    await panel.startNew();
    // pickStartCli falls back to grok (START_PREFERENCE)
    expect(panel._openStartTerminal).toHaveBeenCalledWith("grok");
    expect(panel._writePreferredCli).toHaveBeenCalledWith("grok");
    expect(panel.preferredCli).toBe("grok");
  });

  it("concurrent preferCli during openStartTerminal skips heal", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const panel = makePanel({
      preferredCli: "cursor",
      filter: "all",
      installed: multi,
      _openStartTerminal: mock(async () => {
        await gate;
      }),
    });
    const startP = panel.startNew();
    // While terminal is in-flight, menu pick updates preferred.
    await panel.preferCli("claude");
    release();
    await startP;

    expect(panel._openStartTerminal).toHaveBeenCalledWith("grok");
    // preferCli wrote claude; heal must not overwrite after concurrent menu pick.
    expect(panel.preferredCli).toBe("claude");
    const healCalls = panel._writePreferredCli.mock.calls.filter(
      (args) => args[0] === "grok",
    );
    expect(healCalls.length).toBe(0);
  });

  it("soft-handles false dual-write returns without throwing", async () => {
    const panel = makePanel({
      preferredCli: "grok",
      filter: "claude",
      _writePreferredCli: mock(async () => false),
      _writeListFilter: mock(async () => true),
    });
    await panel.preferCli("codex");
    expect(panel.preferredCli).toBe("codex");
    expect(panel.filter).toBe("all");
    expect(panel._writePreferredCli).toHaveBeenCalledWith("codex");
    expect(panel._writeListFilter).toHaveBeenCalledWith("all");
  });
});
