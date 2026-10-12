import { serializeSnapshots } from "./cache.mjs";

export const statusCacheKey = "status-cache";

export function statusCachePayload(snapshots, preferences) {
  const serialized = JSON.parse(serializeSnapshots(snapshots));
  return {
    version: 1,
    displayMode: preferences.displayMode,
    pinnedPreview: preferences.pinnedPreview,
    autoRefreshSeconds: preferences.autoRefreshSeconds,
    // Popover heartbeat: background uses this to detect if popover is active
    popoverHeartbeat: Date.now(),
    // Store tracked provider IDs so background can skip untracked (hidden) providers
    trackedProviderIDs: preferences.trackedProviderIDs ? [...preferences.trackedProviderIDs] : [],
    snapshots: serialized.snapshots
  };
}

export async function writeStatusCache(storage, snapshots, preferences) {
  if (typeof storage?.set !== "function") return;
  try {
    await storage.set(statusCacheKey, statusCachePayload(snapshots, preferences));
  } catch (error) {
    console.warn("ai-usage status cache write failed", error);
  }
}
