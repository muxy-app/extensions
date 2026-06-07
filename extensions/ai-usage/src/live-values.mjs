import { clamp, nonEmptyString, numberOrNull, parseDate } from "./values.mjs";

export function row(label, value, resetAt, rowDetail, periodDuration = null) {
  return { id: label, label, percent: value === null ? null : clamp(value, 0, 100), resetAt, detail: rowDetail, periodDuration };
}

export function percent(used, limit) {
  if (used === null || limit === null || limit <= 0) return null;
  return clamp((used / limit) * 100, 0, 100);
}

export function detail(used, limit) {
  if (used === null || limit === null) return null;
  return `${formatNumber(used)}/${formatNumber(limit)}`;
}

export function firstNumber(source, keys) {
  for (const key of keys) {
    const value = numberOrNull(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

export function firstDate(source, keys) {
  for (const key of keys) {
    const value = parseDate(source?.[key]);
    if (value) return value;
  }
  return null;
}

export function upperString(source, keys) {
  for (const key of keys) {
    const value = nonEmptyString(source?.[key]);
    if (value) return value.toUpperCase();
  }
  return "";
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number >= 100 ? String(Math.round(number)) : number.toFixed(1);
}

export function currency(value) {
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function displayLabel(raw) {
  if (raw === "premium_interactions") return "Premium";
  if (raw === "chat") return "Chat";
  return String(raw).replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

export function parseGenericWindows(payload, definitions) {
  return definitions.flatMap(([key, label]) => {
    const window = payload?.[key];
    if (!window) return [];
    const used = firstNumber(window, ["used", "usage", "consumed", "current", "spent"]);
    const limit = firstNumber(window, ["limit", "max", "quota", "total", "entitlement"]);
    const resetAt = firstDate(window, ["reset_at", "resets_at", "resetAt", "reset", "window_end", "period_end", "end_time", "quota_reset_date", "limited_user_reset_date"]);
    if (used === null && limit === null && !resetAt) return [];
    return [row(label, percent(used, limit), resetAt, detail(used, limit))];
  });
}
