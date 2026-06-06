import { serializeSnapshots } from "./cache.mjs";

export const statusCacheRelativePath = ".config/muxy/extensions/ai-usage/status-cache.json";

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
    const home = await readHome(exec);
    if (!home) return;
    const dir = `${home}/.config/muxy/extensions/ai-usage`;
    const created = await exec(["/bin/mkdir", "-p", dir], { timeoutMs: 3000 });
    if (!created || created.exitCode !== 0) return;
    await exec(["/usr/bin/tee", `${home}/${statusCacheRelativePath}`], {
      stdin: statusCachePayload(snapshots, preferences),
      timeoutMs: 3000
    });
  } catch (error) {
    console.warn("ai-usage status cache write failed", error);
  }
}

async function readHome(exec) {
  const result = await exec(["/usr/bin/env"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  const line = String(result.stdout || "").split("\n").find((entry) => entry.startsWith("HOME="));
  return line ? line.slice(5) : "";
}
