import { parseFixture, fixtureFromSearch } from "./fixture.mjs";
import { rowDisplay, statusBarPresentation, usageIsCritical } from "./format.mjs";
import { computePace } from "./pace.mjs";
import { canonicalProviderID, defaultPreferences, providerCatalog } from "./providers.mjs";

const primaryPrefixes = ["session", "5h", "premium", "hourly", "primary", "claude", "credits", "key limit"];
const secondaryPrefixes = ["weekly", "week", "7d", "monthly", "month", "daily", "day", "billing", "mcp", "today", "this week", "this month", "balance", "extra usage", "pay as you go"];

export { canonicalProviderID, computePace, defaultPreferences, fixtureFromSearch, parseFixture, providerCatalog, rowDisplay, statusBarPresentation, usageIsCritical };

export function composeSnapshots({ catalog, fetchedSnapshots, preferences }) {
  const fetchedByID = new Map(fetchedSnapshots.map((snapshot) => [canonicalProviderID(snapshot.id), snapshot]));
  return catalog
    .filter((provider) => preferences.trackedProviderIDs.has(provider.id))
    .map((provider) => {
      if (!preferences.enabledProviderIDs.has(provider.id)) return unavailableSnapshot(provider);
      const fetched = fetchedByID.get(provider.id);
      if (!fetched) return unavailableSnapshot(provider);
      if (fetched.state.kind !== "available") return fetched;
      const rows = visibleRows(fetched.rows, preferences.includeSecondary);
      if (rows.length === 0) return unavailableSnapshot(provider, fetched.fetchedAt);
      return { ...fetched, rows };
    });
}

export function visibleRows(rows, includeSecondary) {
  return rows.filter((row) => isPrimary(row) || (includeSecondary && isSecondary(row)));
}

export function selectPreview(snapshots, pinnedRawValue) {
  const pin = parsePin(pinnedRawValue);
  if (pin) {
    const snapshot = snapshots.find((item) => item.id === pin.providerID && item.state.kind === "available");
    if (snapshot) {
      if (pin.rowLabel) {
        const row = snapshot.rows.find((candidate) => candidate.label === pin.rowLabel && candidate.percent !== null);
        if (row) return { snapshot, row };
      } else if (snapshot.rows.some((row) => row.percent !== null)) {
        return { snapshot, row: null };
      }
    }
  }
  const available = snapshots.filter((snapshot) => snapshot.state.kind === "available");
  const ranked = [...available].sort((left, right) => maxPercent(right) - maxPercent(left));
  return ranked[0] ? { snapshot: ranked[0], row: null } : null;
}

function unavailableSnapshot(provider, fetchedAt = new Date()) {
  return {
    id: provider.id,
    name: provider.name,
    icon: provider.icon,
    fetchedAt,
    state: { kind: "unavailable", message: "No usage data" },
    rows: []
  };
}

function isPrimary(row) {
  return matchesPrefix(row, primaryPrefixes);
}

function isSecondary(row) {
  return matchesPrefix(row, secondaryPrefixes);
}

function matchesPrefix(row, prefixes) {
  const label = String(row.label ?? "").trim().toLowerCase();
  return prefixes.some((prefix) => label.startsWith(prefix));
}

function parsePin(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const [providerID, ...labelParts] = trimmed.split("::");
  return {
    providerID: canonicalProviderID(providerID),
    rowLabel: labelParts.length === 0 ? null : labelParts.join("::") || null
  };
}

function maxPercent(snapshot) {
  const values = snapshot.rows.map((row) => row.percent).filter((value) => value !== null && value !== undefined);
  return values.length === 0 ? 0 : Math.max(...values);
}
