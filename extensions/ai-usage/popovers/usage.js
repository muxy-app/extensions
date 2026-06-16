import {
  composeSnapshots,
  computePace,
  fixtureFromSearch,
  parseFixture,
  providerCatalog,
  rowDisplay,
  selectPreview,
  statusBarPresentation,
  usageIsCritical
} from "../src/core.mjs";
import { parseCachedSnapshots, serializeSnapshots } from "../src/cache.mjs";
import { fetchLiveSnapshots } from "../src/live.mjs";
import { preferencesFromStorage } from "../src/preferences.mjs";
import { writeStatusCache } from "../src/status-cache.mjs";

const storagePrefix = "ai-usage.";
const popoverWidth = 360;
const elements = {
  displayMode: document.getElementById("displayMode"),
  autoRefresh: document.getElementById("autoRefresh"),
  refresh: document.getElementById("refresh"),
  status: document.getElementById("status"),
  providers: document.getElementById("providers")
};

const providerAccents = {
  amp: "#00b894",
  claude: "#d97742",
  codex: "#2f80ed",
  copilot: "#7c3aed",
  cursor: "#f5c542",
  factory: "#00a6a6",
  grok: "#a78bfa",
  kimi: "#4f7cff",
  minimax: "#ff6b6b",
  "opencode-go": "#e879f9",
  zai: "#22c55e"
};

let snapshots = [];
let timer = null;

function readPreferences() {
  const storageKey = (key) => `${storagePrefix}${key}`;
  const preferences = preferencesFromStorage(
    (key) => localStorage.getItem(storageKey(key)),
    (key, value) => localStorage.setItem(storageKey(key), value)
  );
  preferences.enabled = true;
  preferences.includeSecondary = true;
  return preferences;
}

function writePreferences(preferences) {
  localStorage.setItem(`${storagePrefix}enabled`, "true");
  localStorage.setItem(`${storagePrefix}displayMode`, preferences.displayMode);
  localStorage.setItem(`${storagePrefix}autoRefreshSeconds`, String(preferences.autoRefreshSeconds));
  localStorage.setItem(`${storagePrefix}includeSecondary`, "true");
  localStorage.setItem(`${storagePrefix}pinnedPreview`, preferences.pinnedPreview);
  localStorage.setItem(`${storagePrefix}tracked`, JSON.stringify([...preferences.trackedProviderIDs]));
  localStorage.setItem(`${storagePrefix}providerEnabled`, JSON.stringify([...preferences.enabledProviderIDs]));
}

function syncControls(preferences) {
  elements.displayMode.value = preferences.displayMode;
  elements.autoRefresh.value = String(preferences.autoRefreshSeconds);
}

async function readFixture() {
  const fromSearch = fixtureFromSearch(window.location.search);
  if (fromSearch) return fromSearch;
  return localStorage.getItem(`${storagePrefix}fixture`) || "";
}

async function refresh() {
  const preferences = readPreferences();
  syncControls(preferences);
  const cacheApplied = await applyCachedUsage(preferences);
  if (!cacheApplied) elements.status.textContent = "Refreshing usage data...";
  const fixture = await readFixture();
  const providerIDs = [...preferences.trackedProviderIDs].filter((id) => preferences.enabledProviderIDs.has(id));
  const fetched = fixture
    ? parseFixture(fixture)
    : await fetchLiveSnapshots({ exec: window.muxy?.exec, providerIDs });
  await applyFetchedUsage(fetched, preferences, cacheApplied);
}

async function applyCachedUsage(preferences) {
  const cached = parseCachedSnapshots(localStorage.getItem(`${storagePrefix}snapshots`));
  if (cached.length === 0) return false;
  snapshots = composeSnapshots({ catalog: providerCatalog, fetchedSnapshots: cached, preferences });
  if (!hasAvailableUsage(snapshots)) return false;
  render(preferences, "Loaded cached usage. Refreshing...");
  await persistStatusCache(preferences);
  return true;
}

async function applyFetchedUsage(fetched, preferences, cacheApplied) {
  const nextSnapshots = composeSnapshots({ catalog: providerCatalog, fetchedSnapshots: fetched, preferences });
  if (hasAvailableUsage(nextSnapshots)) {
    localStorage.setItem(`${storagePrefix}snapshots`, serializeSnapshots(fetched));
  }
  snapshots = hasAvailableUsage(nextSnapshots) || !cacheApplied ? nextSnapshots : snapshots;
  const availableCount = snapshots.filter((snapshot) => snapshot.state.kind === "available").length;
  const statusText = availableCount > 0 ? `Updated ${new Date().toLocaleTimeString()}` : "No usage data yet.";
  render(preferences, statusText);
  await persistStatusCache(preferences);
}

function hasAvailableUsage(items) {
  return items.some((snapshot) => snapshot.state.kind === "available" && snapshot.rows.some((row) => row.percent !== null));
}

async function persistStatusCache(preferences) {
  if (hasAvailableUsage(snapshots)) {
    await writeStatusCache(window.muxy?.exec, snapshots, preferences);
  }
  await updateStatusBar(preferences);
}

async function updateStatusBar(preferences) {
  if (typeof window.muxy?.statusbar?.set !== "function") return;
  const presentation = statusBarPresentation(selectPreview(snapshots, preferences.pinnedPreview), preferences.displayMode);
  try {
    await window.muxy.statusbar.set({ id: "ai-usage", icon: presentation.icon, text: presentation.text });
  } catch (error) {
    console.warn("ai-usage status bar update failed", error);
  }
}

function render(preferences, statusText) {
  elements.status.textContent = statusText;
  const activeProviders = providerCatalog.filter((provider) => preferences.trackedProviderIDs.has(provider.id));
  const inactiveProviders = providerCatalog.filter((provider) => !preferences.trackedProviderIDs.has(provider.id));
  const views = activeProviders.map((provider) => providerView(provider, preferences));
  if (inactiveProviders.length > 0) views.push(collapsedProvidersView(inactiveProviders, preferences));
  elements.providers.replaceChildren(...views);
  fitPopover();
}

function collapsedProvidersView(providers, preferences) {
  const details = document.createElement("details");
  details.className = "provider-collapse";
  const summary = document.createElement("summary");
  summary.textContent = `Hidden providers (${providers.length})`;
  details.append(summary, ...providers.map((provider) => providerView(provider, preferences, true)));
  return details;
}

function providerView(provider, preferences, collapsed = false) {
  const snapshot = snapshots.find((item) => item.id === provider.id);
  const section = document.createElement("section");
  section.className = "provider";
  section.style.setProperty("--provider-accent", providerAccents[provider.id] || "var(--muxy-accent)");
  const head = document.createElement("div");
  head.className = "provider-head";
  const icon = document.createElement("span");
  icon.className = "provider-icon";
  icon.style.setProperty("--provider-icon-url", `url("../assets/${provider.icon}.svg")`);
  const title = document.createElement("div");
  title.className = "provider-title";
  title.append(textSpan(provider.name, "provider-name"));
  head.append(icon, title);
  const state = collapsed ? "Hidden" : snapshot?.state.kind === "available" ? (snapshot?.planName || "Live") : snapshot?.state.message || "No usage data";
  const stateClass = !collapsed && snapshot?.state.kind === "available" ? "provider-state available" : "provider-state";
  head.append(textSpan(state, stateClass));
  const toggle = document.createElement("input");
  toggle.className = "provider-toggle";
  toggle.type = "checkbox";
  toggle.checked = preferences.trackedProviderIDs.has(provider.id);
  toggle.addEventListener("change", () => {
    const next = readPreferences();
    if (toggle.checked) next.trackedProviderIDs.add(provider.id);
    else next.trackedProviderIDs.delete(provider.id);
    writePreferences(next);
refresh();
  });
  head.append(toggle);
  section.append(head);
  if (!collapsed && snapshot?.refreshMessage) {
    section.append(refreshMessageView(snapshot.refreshMessage));
  }
  if (!collapsed && snapshot?.state.kind === "available") {
    section.append(...snapshot.rows.map((row) => metricView(snapshot, row, preferences)));
  }
  return section;
}

function metricView(snapshot, row, preferences) {
  const display = rowDisplay(row, preferences.displayMode);
  const pace = row.percent === null || !row.resetAt || !row.periodDuration
    ? null
    : computePace({ usedPercent: row.percent, resetAt: row.resetAt, periodDuration: row.periodDuration, now: snapshot.fetchedAt });
  const wrap = document.createElement("div");
  wrap.className = usageIsCritical(row, preferences.displayMode) ? "metric high" : "metric";
  const head = document.createElement("div");
  head.className = "metric-head";
  head.append(textSpan(row.label, "metric-label"));
  if (pace) {
    const dot = document.createElement("span");
    dot.className = `pace-dot pace-${pace.status}`;
    head.append(dot);
  }
  const pin = document.createElement("button");
  pin.className = "pin";
  pin.type = "button";
  const encoded = `${snapshot.id}::${row.label}`;
  const pinned = preferences.pinnedPreview === encoded;
  pin.textContent = pinned ? "★" : "☆";
  pin.title = pinned ? "Unpin from status bar" : "Pin to status bar";
  pin.setAttribute("aria-label", pin.title);
  pin.setAttribute("aria-pressed", String(pinned));
  pin.addEventListener("click", async () => {
    const next = readPreferences();
    next.pinnedPreview = next.pinnedPreview === encoded ? "" : encoded;
    writePreferences(next);
    render(next, elements.status.textContent);
    await persistStatusCache(next);
  });
  head.append(pin);
  if (display.percentText) {
    const modeLabel = preferences.displayMode === "used" ? "Used" : "Remaining";
    head.append(textSpan(`${modeLabel} ${display.percentText}`, "metric-value"));
  }
  wrap.append(head);
  if (display.percent !== null) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${display.percent}%`;
    bar.append(fill);
    wrap.append(bar);
  }
  if (row.resetAt) {
    const reset = document.createElement("div");
    reset.className = "reset-row";
    reset.append(textSpan(row.resetAt ? `Resets ${row.resetAt.toLocaleDateString([], { month: "short", day: "numeric" })} ${row.resetAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "", ""));
    wrap.append(reset);
  }
  return wrap;
}

function refreshMessageView(message) {
  const el = document.createElement("div");
  el.className = "refresh-message";
  el.textContent = message;
  return el;
}

function textSpan(text, className) {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function updateFromControls() {
  const preferences = readPreferences();
  preferences.displayMode = elements.displayMode.value;
  preferences.autoRefreshSeconds = Number(elements.autoRefresh.value);
  writePreferences(preferences);
  scheduleRefresh(preferences);
  refresh();
}

function scheduleRefresh(preferences) {
  if (timer !== null) clearInterval(timer);
  timer = setInterval(refresh, preferences.autoRefreshSeconds * 1000);
}

function fitPopover() {
  if (!window.muxy?.popover?.resize) return;
  muxy.popover.resize(popoverWidth, document.documentElement.scrollHeight);
}

elements.refresh.addEventListener("click", refresh);
elements.displayMode.addEventListener("change", updateFromControls);
elements.autoRefresh.addEventListener("change", updateFromControls);

const preferences = readPreferences();
syncControls(preferences);
scheduleRefresh(preferences);
refresh();
