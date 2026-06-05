import { serializeSnapshots } from "./cache.mjs";

export const statusCacheWriteShell = "DIR=\"$HOME/.config/muxy/extensions/ai-usage\"; CACHE=\"$DIR/status-cache.json\"; /bin/mkdir -p \"$DIR\" && /usr/bin/tee \"$CACHE\" >/dev/null";

export function statusCachePayload(snapshots, preferences) {
  const serialized = JSON.parse(serializeSnapshots(snapshots));
  return JSON.stringify({
    version: 1,
    displayMode: preferences.displayMode,
    pinnedPreview: preferences.pinnedPreview,
    snapshots: serialized.snapshots
  });
}

export async function writeStatusCache(exec, snapshots, preferences) {
  if (typeof exec !== "function") return;
  try {
    await exec(["/bin/sh", "-c", statusCacheWriteShell], {
      stdin: statusCachePayload(snapshots, preferences),
      timeoutMs: 3000
    });
  } catch (error) {
    console.warn("ai-usage status cache write failed", error);
  }
}
