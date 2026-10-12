import { serializeSnapshots } from "./cache.mjs";
import { fetchLiveSnapshots } from "./live.mjs";
import { providerCatalog } from "./providers.mjs";
import { statusCacheDir, statusCachePath } from "./status-cache.mjs";

try {
  muxy.events.subscribe("extension.ai-usage.keepalive", () => {});

  const home = readHome();
  const startMs = Date.now();
  let polling = false;

  // ── Startup: restore status bar from cache ──
  let autoRefreshSeconds = 300;
  let cachePayload = null;
  try {
    cachePayload = readCache(home);
    if (cachePayload) {
      autoRefreshSeconds = cachePayload.autoRefreshSeconds || 300;
      const presentation = statusBarPresentation(cachePayload);
      if (presentation) {
        muxy.statusbar.set({ id: "ai-usage", icon: presentation.icon, text: presentation.text });
        console.log(`ai-usage status bar restored ${presentation.text}`);
      } else {
        console.log("ai-usage status cache has no displayable usage");
      }
    } else {
      console.log("ai-usage status cache missing");
    }
  } catch (error) {
    console.warn("ai-usage background restore failed", error);
  }

  /*
   * 변경 전 정책: background는 popover와 별개인 동기 수집 코드(codex, opencode-go, kimi, claude,
   *   grok, factory)만 갖고 있었고, 나머지 provider는 popover를 열 때만 갱신됐다. 복제 코드가 live
   *   경로와 어긋나 codex/kimi/factory/claude는 응답 형식 불일치로 항상 null을 반환해 캐시가 멈춰 있었다.
   * 변경 후 정책: popover와 같은 live collector(fetchLiveSnapshots)를 muxy.exec 동기 결과를 감싼
   *   exec로 호출해, 캐시에 available로 남아 있는 모든 provider를 갱신한다.
   * 변경 이유: provider별 background 복제 구현이 계속 drift되어 조용히 실패했다. 수집 경로를 하나로
   *   합쳐 새 provider도 별도 작업 없이 background에서 갱신되게 한다.
   * 영향 범위: background poll 대상 provider 전체. token을 회전시키는 kimi/claude는 popover가 활성일
   *   때 계속 건너뛰고, 실패하거나 사용 가능한 값이 없으면 이전 snapshot을 유지한다. poll이 겹치면 건너뛴다.
   */
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const nowMs = Date.now();
      const payload = readCache(home);

      // No cache yet — nothing to refresh
      if (!payload || !Array.isArray(payload.snapshots)) return;

      const displayMode = payload.displayMode === "remaining" ? "remaining" : "used";
      const pinnedPreview = payload.pinnedPreview || "";
      const currentInterval = payload.autoRefreshSeconds || 300;

      // Popover heartbeat: if popover wrote a recent heartbeat, it is active
      const heartbeatAge = payload.popoverHeartbeat ? nowMs - payload.popoverHeartbeat : Infinity;
      const popoverActive = heartbeatAge < currentInterval * 1000 * 1.5;

      // Untracked (hidden) providers are excluded from refresh and cache output
      const tracked = payload.trackedProviderIDs;
      const isTracked = Array.isArray(tracked)
        ? (id) => tracked.includes(id)
        : () => true; // backward compat — no tracked list means allow all

      // Re-fetch each previously-available provider through the live collectors.
      // On failure the old snapshot is kept so the status bar doesn't flicker.
      // Token-refresh providers (kimi, claude) are skipped when popover is active.
      const oldSnapshots = payload.snapshots.filter((snapshot) => isTracked(snapshot.id));
      const refreshIDs = oldSnapshots
        .filter((snapshot) => snapshot.state && snapshot.state.kind === "available")
        .map((snapshot) => snapshot.id)
        .filter((id) => providerCatalog.some((provider) => provider.id === id))
        .filter((id) => !(popoverActive && needsTokenRefresh(id)));
      const fetched = refreshIDs.length > 0 ? await fetchLiveSnapshots({ exec: backgroundExec, providerIDs: refreshIDs }) : [];
      const freshByID = new Map(fetched
        .filter((snapshot) => snapshot.state.kind === "available" && snapshot.rows.length > 0)
        .map((snapshot) => [snapshot.id, snapshot]));
      const updatedSnapshots = oldSnapshots.map((snapshot) => freshByID.get(snapshot.id) || snapshot);

      // Build new cache payload (no popoverHeartbeat — distinguishes background writes)
      const newPayload = JSON.stringify({
        version: 1,
        displayMode,
        pinnedPreview,
        autoRefreshSeconds: currentInterval,
        trackedProviderIDs: tracked,
        snapshots: JSON.parse(serializeSnapshots(updatedSnapshots)).snapshots,
      });

      // Write atomically: temp → rename
      const cachePath = statusCachePath(home);
      const dir = muxy.exec(["/bin/mkdir", "-p", statusCacheDir(home)], { timeoutMs: 3000 });
      if (dir && dir.exitCode === 0) {
        const tmpPath = `${cachePath}.tmp`;
        const tee = muxy.exec(["/usr/bin/tee", tmpPath], { stdin: newPayload, timeoutMs: 3000 });
        if (tee && tee.exitCode === 0) {
          muxy.exec(["/bin/mv", "-f", tmpPath, cachePath], { timeoutMs: 3000 });
        }
      }

      // Update status bar
      const presentation = statusBarPresentation(JSON.parse(newPayload));
      if (presentation) {
        muxy.statusbar.set({ id: "ai-usage", icon: presentation.icon, text: presentation.text });
      }
    } catch (error) {
      console.warn("ai-usage background poll failed", error);
    } finally {
      polling = false;
    }
  }

  function needsTokenRefresh(id) {
    return id === "kimi" || id === "claude";
  }

  // Schedule polling. If cache was present, do an initial poll right away.
  if (cachePayload && Array.isArray(cachePayload.snapshots) && cachePayload.snapshots.length > 0) {
    poll();
  }
  if (typeof setInterval === "function") {
    setInterval(poll, autoRefreshSeconds * 1000);
  } else {
    console.warn("ai-usage background polling timer unavailable");
  }

  console.log(`ai-usage background polling started (interval=${autoRefreshSeconds}s, elapsed=${Date.now() - startMs}ms)`);
} catch (error) {
  console.warn("ai-usage background init failed", error);
}

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

// Background muxy.exec is synchronous; the live collectors expect a Promise of
// { exitCode, stdout }. Promise.resolve also covers a host that returns one.
function backgroundExec(argv, options) {
  try {
    return Promise.resolve(muxy.exec(argv, options)).then(normalizeExecResult, () => normalizeExecResult(null));
  } catch {
    return Promise.resolve(normalizeExecResult(null));
  }
}

function normalizeExecResult(result) {
  if (!result) return { exitCode: 1, stdout: "", stderr: "" };
  return { ...result, exitCode: Number.isFinite(result.exitCode) ? result.exitCode : 1, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function readCache(home) {
  const path = statusCachePath(home);
  if (!path) return null;
  const result = muxy.exec(["/bin/cat", path], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return null;
  const trimmed = String(result.stdout || "").trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function readHome() {
  const result = muxy.exec(["/usr/bin/env"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  const line = String(result.stdout || "").split("\n").find((entry) => entry.startsWith("HOME="));
  return line ? line.slice(5) : "";
}

// ═══════════════════════════════════════════════════
//  Status bar helpers (kept from original background.mjs)
// ═══════════════════════════════════════════════════

function statusBarPresentation(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.snapshots)) return null;
  const displayMode = payload.displayMode === "remaining" ? "remaining" : "used";
  const selected = selectPreview(payload.snapshots, payload.pinnedPreview);
  if (!selected) return null;
  const percent = selected.row ? selected.row.percent : maxPercent(selected.snapshot);
  if (percent === null || percent === undefined) return null;
  const clamped = clamp(Number(percent), 0, 100);
  const displayed = displayMode === "remaining" ? clamp(100 - clamped, 0, 100) : clamped;
  return {
    icon: { svg: `assets/${selected.snapshot.icon}.svg` },
    text: `${Math.round(displayed)}%`
  };
}

function selectPreview(snapshots, pinnedRawValue) {
  const pin = parsePin(pinnedRawValue);
  if (pin) {
    const snapshot = snapshots.find((item) => item.id === pin.providerID && item.state && item.state.kind === "available");
    if (snapshot) {
      if (pin.rowLabel) {
        const row = (snapshot.rows || []).find((candidate) => candidate.label === pin.rowLabel && candidate.percent !== null && candidate.percent !== undefined);
        if (row) return { snapshot, row };
      } else if ((snapshot.rows || []).some((row) => row.percent !== null && row.percent !== undefined)) {
        return { snapshot, row: null };
      }
    }
  }
  const available = snapshots.filter((snapshot) => snapshot.state && snapshot.state.kind === "available");
  const ranked = available.sort((left, right) => maxPercent(right) - maxPercent(left));
  return ranked[0] ? { snapshot: ranked[0], row: null } : null;
}

function parsePin(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split("::");
  return {
    providerID: parts.shift(),
    rowLabel: parts.length === 0 ? null : parts.join("::") || null
  };
}

function maxPercent(snapshot) {
  const values = (snapshot.rows || []).map((row) => row.percent).filter((value) => value !== null && value !== undefined);
  return values.length === 0 ? null : Math.max(...values);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
