import { serializeSnapshots } from "./cache.mjs";

/*
 * 변경 전 정책: 캐시 경로가 상대 경로 "status-cache.json"이라 muxy.exec의 작업 디렉터리,
 *   즉 Muxy에서 열린 프로젝트 폴더에 status-cache.json(.tmp)을 쓰고 읽었다.
 * 변경 후 정책: $HOME/Library/Application Support/muxy-ai-usage/status-cache.json 절대 경로를 쓴다.
 *   HOME을 알 수 없으면 경로를 만들지 않고 캐시 읽기/쓰기를 건너뛴다.
 * 변경 이유: 열린 저장소마다 untracked 파일이 생기는 문제(#119). background 호스트에는
 *   muxy.storage가 없어서 popover와 background가 공유하려면 파일이어야 한다.
 * 영향 범위: popover 캐시 쓰기와 background 캐시 읽기/쓰기. 기존 프로젝트 폴더의 캐시는 더 이상
 *   읽지 않으므로, 업데이트 직후에는 popover를 한 번 열어야 status bar 복원이 다시 시작된다.
 */
export const statusCacheFileName = "status-cache.json";

export function statusCacheDir(home) {
  return home ? `${home}/Library/Application Support/muxy-ai-usage` : "";
}

export function statusCachePath(home) {
  const dir = statusCacheDir(home);
  return dir ? `${dir}/${statusCacheFileName}` : "";
}

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

let cachedHome = "";

export async function readHome(exec) {
  if (cachedHome) return cachedHome;
  const result = await exec(["/usr/bin/env"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  const line = String(result.stdout || "").split("\n").find((entry) => entry.startsWith("HOME="));
  cachedHome = line ? line.slice(5) : "";
  return cachedHome;
}

export async function writeStatusCache(exec, snapshots, preferences) {
  if (typeof exec !== "function") return;
  try {
    const home = await readHome(exec);
    const path = statusCachePath(home);
    if (!path) return;
    const dir = await exec(["/bin/mkdir", "-p", statusCacheDir(home)], { timeoutMs: 3000 });
    if (!dir || dir.exitCode !== 0) return;
    const tmpPath = `${path}.tmp`;
    const written = await exec(["/usr/bin/tee", tmpPath], {
      stdin: statusCachePayload(snapshots, preferences),
      timeoutMs: 3000
    });
    if (!written || written.exitCode !== 0) return;
    await exec(["/bin/mv", "-f", tmpPath, path], { timeoutMs: 3000 });
  } catch (error) {
    console.warn("ai-usage status cache write failed", error);
  }
}
