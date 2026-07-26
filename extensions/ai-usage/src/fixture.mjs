import { canonicalProviderID, providerCatalog } from "./providers.mjs";
import { clamp, nonEmptyString, numberOrNull, parseDate } from "./values.mjs";

export function parseFixture(raw) {
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    if (!parsed || !Array.isArray(parsed.providers)) return [];
    return parsed.providers.map(parseFixtureProvider).filter(Boolean);
  } catch {
    return [];
  }
}

export function fixtureFromSearch(search) {
  try {
    return new URLSearchParams(String(search ?? "")).get("fixture") ?? "";
  } catch {
    return "";
  }
}

function parseFixtureProvider(provider) {
  const id = canonicalProviderID(provider?.id);
  if (!id) return null;
  const catalogEntry = providerCatalog.find((entry) => entry.id === id);
  const rows = Array.isArray(provider.rows) ? provider.rows.map(parseFixtureRow).filter(Boolean) : [];
  const stateKind = provider.state === "error" ? "error" : provider.state === "available" ? "available" : "unavailable";
  const state = stateKind === "available" && rows.length > 0
    ? { kind: "available" }
    : { kind: stateKind === "error" ? "error" : "unavailable", message: String(provider.message || "No usage data") };
  return {
    id,
    name: String(provider.name || catalogEntry?.name || id),
    icon: String(catalogEntry?.icon || "sparkles"),
    fetchedAt: parseDate(provider.fetchedAt) ?? new Date(),
    planName: nonEmptyString(provider.planName) || undefined,
    state,
    rows
  };
}

function parseFixtureRow(row) {
  const label = String(row?.label ?? "").trim();
  if (!label) return null;
  const percent = numberOrNull(row.percent);
  const detail = nonEmptyString(row.detail);
  const resetAt = parseDate(row.resetAt ?? row.resetDate);
  const periodDuration = numberOrNull(row.periodDuration);
  if (percent === null && detail === null && resetAt === null) return null;
  return {
    id: label,
    label,
    percent: percent === null ? null : clamp(percent, 0, 100),
    resetAt,
    detail,
    periodDuration
  };
}
