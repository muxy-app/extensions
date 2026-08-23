const MAX_WAITING_IDS = 400;

/**
 * Pure state machine for the background status-bar count.
 *
 * A background restart intentionally begins neutral. Agent events received
 * before the panel's first snapshot are not enough to reconstruct GSD-derived
 * attention, so they are discarded when that authoritative baseline arrives.
 */
export function createAttentionTracker() {
  let hydrated = false;
  let baseAttention = 0;
  let baselineWaiting = new Set();
  let currentWaiting = new Set();

  return {
    observeAgent(event) {
      if (!event || typeof event !== "object") return false;
      const worktreeId = typeof event.worktreeID === "string" ? event.worktreeID.trim() : "";
      if (!worktreeId || !hydrated) return false;
      const status = typeof event.status === "string" ? event.status.toLowerCase() : "";
      if (status === "waiting") currentWaiting.add(worktreeId);
      else if (["working", "idle", "unavailable"].includes(status)) currentWaiting.delete(worktreeId);
      else return false;
      return true;
    },

    observeSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return false;
      const attentionCount = Number(snapshot.attentionCount);
      if (!Number.isFinite(attentionCount) || attentionCount < 0) return false;
      const ids = Array.isArray(snapshot.waitingIds)
        ? snapshot.waitingIds
            .filter((value) => typeof value === "string" && value.trim())
            .slice(0, MAX_WAITING_IDS)
        : [];
      baselineWaiting = new Set(ids);
      currentWaiting = new Set(ids);
      baseAttention = Math.floor(attentionCount);
      hydrated = true;
      return true;
    },

    count() {
      if (!hydrated) return 0;
      return Math.max(0, baseAttention + currentWaiting.size - baselineWaiting.size);
    },

    isHydrated() {
      return hydrated;
    },
  };
}
