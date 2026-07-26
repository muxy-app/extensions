import { serializeSnapshots } from "./cache.mjs";

export const statusCachePath = "status-cache.json";

export function statusCachePayload(snapshots, preferences) {
  const serialized = JSON.parse(serializeSnapshots(snapshots));
  return JSON.stringify({
    version: 1,
    displayMode: preferences.displayMode,
    pinnedPreview: preferences.pinnedPreview,
    autoRefreshSeconds: preferences.autoRefreshSeconds,
    // Popover heartbeat: background uses this to detect if popover is active
    popoverHeartbeat: Date.now(),
    // Store tracked provider IDs so background can skip untracked (hidden) providers
    trackedProviderIDs: preferences.trackedProviderIDs ? [...preferences.trackedProviderIDs] : [],
    snapshots: serialized.snapshots
  });
}

export async function writeStatusCache(exec, snapshots, preferences) {
  if (typeof exec !== "function") return;
  try {
    const tmpPath = `${statusCachePath}.tmp`;
    const written = await exec(["/usr/bin/tee", tmpPath], {
      stdin: statusCachePayload(snapshots, preferences),
      timeoutMs: 3000
    });
    if (!written || written.exitCode !== 0) return;
    await exec(["/bin/mv", "-f", tmpPath, statusCachePath], { timeoutMs: 3000 });
  } catch (error) {
    console.warn("ai-usage status cache write failed", error);
  }
}
