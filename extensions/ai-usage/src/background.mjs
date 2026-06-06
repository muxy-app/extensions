try {
  const home = readHome();
  const result = home
    ? muxy.exec(["/bin/cat", `${home}/.config/muxy/extensions/ai-usage/status-cache.json`], { timeoutMs: 3000 })
    : null;
  if (result && result.exitCode === 0 && String(result.stdout || "").trim()) {
    const payload = JSON.parse(result.stdout);
    const presentation = statusBarPresentation(payload);
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

function readHome() {
  const result = muxy.exec(["/usr/bin/env"], { timeoutMs: 3000 });
  if (!result || result.exitCode !== 0) return "";
  const line = String(result.stdout || "").split("\n").find((entry) => entry.startsWith("HOME="));
  return line ? line.slice(5) : "";
}

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
