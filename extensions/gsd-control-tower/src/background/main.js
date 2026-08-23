/**
 * GSD Control Tower — background host.
 *
 * The background script has no projects/worktrees/files/agents APIs, so the
 * open panel publishes a compact attention snapshot over the `extension.*`
 * bus; between panel sessions this script tracks `agent.status` deltas and
 * keeps the status-bar figure honest without fabricating GSD-derived states.
 */
import { createAttentionTracker } from "./attention-tracker.js";

const tracker = createAttentionTracker();

function log(message) {
  try { console.log(`[control-tower] ${message}`); } catch { /* no-op */ }
}

async function renderStatusBar() {
  const count = tracker.count();
  const muxyRef = globalThis.muxy;
  if (!muxyRef?.statusbar?.set) return;
  try {
    if (count > 0) {
      await muxyRef.statusbar.set({
        id: "attention",
        text: String(count),
        icon: { symbol: "exclamationmark.triangle.fill" },
      });
    } else {
      await muxyRef.statusbar.set({
        id: "attention",
        text: "",
        icon: { symbol: "circle.dashed" },
      });
    }
  } catch (e) {
    log(`statusbar.set failed: ${e?.message ?? e}`);
  }
}

muxy.events.subscribe("agent.status", (evt) => {
  if (tracker.observeAgent(evt)) renderStatusBar();
});

muxy.events.subscribe("extension.snapshot", (snapshot) => {
  if (tracker.observeSnapshot(snapshot)) renderStatusBar();
});

renderStatusBar();
log("background ready");
