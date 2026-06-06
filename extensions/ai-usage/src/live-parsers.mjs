import { clamp, nonEmptyString } from "./values.mjs";
import { currency, detail, displayLabel, firstDate, firstNumber, formatNumber, parseGenericWindows, percent, row, upperString } from "./live-values.mjs";

export function parseClaudeRows(payload) {
  return [
    ["five_hour", "5h", 18000],
    ["seven_day", "7d", 604800],
    ["seven_day_sonnet", "7d Sonnet", 604800],
    ["seven_day_omelette", "7d Omelette", 604800],
  ].flatMap(([key, label, periodDuration]) => {
    const window = payload?.[key];
    if (!window) return [];
    const value = firstNumber(window, ["utilization", "used_percent", "usedPercent"]);
    const resetAt = firstDate(window, ["resets_at", "reset_at", "resetAt", "window_end"]);
    if (value === null && resetAt === null) return [];
    return [row(label, value, resetAt, value === null ? null : `${formatNumber(value)}% used`, periodDuration)];
  });
}

export function parseCodexRows(payload) {
  const rateLimit = payload?.rate_limit;
  if (!rateLimit) return parseGenericWindows(payload, [["monthly", "Monthly"], ["daily", "Daily"], ["hourly", "Hourly"], ["current_billing_period", "Billing"]]);
  return [
    rowForWindow(rateLimit.primary_window, "5h"),
    rowForWindow(rateLimit.secondary_window, "7d"),
    rowForWindow(payload?.code_review_rate_limit?.primary_window, "Reviews"),
  ].filter(Boolean);
}

export function parseAmpRows(payload) {
  const text = nonEmptyString(payload?.result?.displayText ?? payload?.result?.display_text);
  if (!text) return [];
  const rows = [];
  const balance = text.match(/\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*\$([0-9]+(?:\.[0-9]+)?)\s*remaining/i);
  if (balance) {
    const remaining = Number(balance[1]);
    const total = Number(balance[2]);
    const used = Math.max(0, total - remaining);
    rows.push(row("Free balance", percent(used, total), null, `${formatNumber(used)}/${formatNumber(total)}`));
  }
  const credits = text.match(/Individual credits:\s*\$([0-9]+(?:\.[0-9]+)?)\s*remaining/i);
  if (credits) rows.push(row("Credits", null, null, currency(Number(credits[1]))));
  return rows;
}

export function parseCopilotRows(payload) {
  const resetAt = firstDate(payload, ["quota_reset_date", "limited_user_reset_date"]);
  if (!resetAt) return [];
  const rows = [];
  const snapshots = payload?.quota_snapshots || {};
  for (const key of Object.keys(snapshots)) {
    const item = snapshots[key];
    const limit = firstNumber(item, ["entitlement", "quota", "limit"]);
    const remaining = firstNumber(item, ["remaining"]);
    const percentRemaining = firstNumber(item, ["percent_remaining"]);
    const value = percentRemaining === null ? percent(limit === null || remaining === null ? null : limit - remaining, limit) : clamp(100 - percentRemaining, 0, 100);
    rows.push(row(displayLabel(key), value, resetAt, detail(limit === null || remaining === null ? null : limit - remaining, limit), 2592000));
  }
  return rows.filter((item) => item.percent !== null || item.resetAt || item.detail);
}

export function parseKimiRows(payload) {
  const data = payload?.data || payload || {};
  const candidates = (Array.isArray(data.limits) ? data.limits : []).flatMap((item) => {
    const quota = parseQuota(item.detail || item);
    return quota ? [{ quota, periodMs: parseWindowMs(item.window) }] : [];
  });
  const session = [...candidates].sort((left, right) => (left.periodMs ?? Infinity) - (right.periodMs ?? Infinity))[0];
  const weekly = parseQuota(data.usage) || candidates.find((candidate) => candidate !== session)?.quota;
  return { rows: [session && quotaRow("Session", session.quota, session.periodMs), weekly && weekly !== session?.quota && quotaRow("Weekly", weekly, null)].filter(Boolean) };
}

export function parseFactoryRows(payload) {
  const usage = payload?.usage;
  if (!usage) return { rows: [] };
  const startAt = firstDate(usage, ["startDate", "start_date"]);
  const endAt = firstDate(usage, ["endDate", "end_date"]);
  const duration = startAt && endAt ? Math.max(0, (endAt.getTime() - startAt.getTime()) / 1000) : null;
  return { rows: [factoryBucketRow("Standard", usage.standard, endAt, duration), factoryBucketRow("Premium", usage.premium, endAt, duration)].filter(Boolean) };
}

export function parseMiniMaxRows(payload) {
  const candidates = [payload, payload?.data, payload?.data?.result, payload?.result].filter(Boolean);
  for (const candidate of candidates) {
    const remains = candidate.model_remains || candidate.modelRemains;
    if (!Array.isArray(remains) || remains.length === 0) continue;
    const selected = remains.find((item) => firstNumber(item, ["current_interval_total_count", "currentIntervalTotalCount", "total", "limit"]) > 0) || remains[0];
    const parsed = parseLimit(selected, ["current_interval_total_count", "currentIntervalTotalCount", "total", "limit"], ["current_interval_remaining_count", "currentIntervalRemainingCount", "remaining", "remains"]);
    if (!parsed) continue;
    const resetAt = firstDate(selected, ["end_time", "endTime", "reset_at", "resetAt"]);
    return [row("Session", percent(parsed.used, parsed.total), resetAt, `${formatNumber(parsed.used)}/${formatNumber(parsed.total)}`, 18000)];
  }
  return parseGenericWindows(payload, [["monthly", "Monthly"], ["daily", "Daily"], ["requests", "Requests"]]);
}

export function parseZaiRows(payload, planName) {
  const limits = payload?.data?.limits || payload?.limits || (Array.isArray(payload?.data) ? payload.data : []);
  const session = limits.find((item) => upperString(item, ["limitType", "type", "name"]) === "TOKENS_LIMIT" && Number(item.unit) === 3);
  const weekly = limits.find((item) => upperString(item, ["limitType", "type", "name"]) === "TOKENS_LIMIT" && Number(item.unit) === 6);
  return [
    session && percentOnlyRow(planName ? `Session (${planName})` : "Session", session, 18000),
    weekly && percentOnlyRow("Weekly", weekly, 604800),
  ].filter(Boolean);
}

export function parseZaiPlanName(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  return entries.map((item) => nonEmptyString(item.productName || item.product_name || item.name)).find(Boolean) || "";
}

function rowForWindow(window, fallbackLabel) {
  if (!window) return null;
  const value = firstNumber(window, ["used_percent"]);
  const resetAt = firstDate(window, ["reset_at"]);
  const duration = firstNumber(window, ["limit_window_seconds"]);
  if (value === null && resetAt === null) return null;
  return row(labelForWindow(window, fallbackLabel), value, resetAt, value === null ? null : `${formatNumber(value)}% used`, duration);
}

function labelForWindow(window, fallback) {
  const seconds = firstNumber(window, ["limit_window_seconds"]);
  if (seconds === 18000) return "5h";
  if (seconds === 604800) return fallback === "Reviews" ? "Reviews" : "7d";
  return fallback;
}

function factoryBucketRow(label, bucket, resetAt, duration) {
  if (!bucket) return null;
  const limit = firstNumber(bucket, ["totalAllowance", "total_allowance"]);
  if (!limit || limit <= 0) return null;
  const used = firstNumber(bucket, ["orgTotalTokensUsed", "org_total_tokens_used", "tokensUsed", "tokens_used", "used"]) ?? 0;
  return row(label, percent(used, limit), resetAt, `${formatNumber(used)} / ${formatNumber(limit)} tokens`, duration);
}

function parseLimit(item, totalKeys, remainingKeys) {
  const total = firstNumber(item, totalKeys);
  const remaining = firstNumber(item, remainingKeys);
  const used = firstNumber(item, ["used_count", "current_interval_used_count", "currentIntervalUsedCount", "used"]) ?? (total !== null && remaining !== null ? total - remaining : null);
  return total === null || used === null || total <= 0 ? null : { total, used };
}

function parseQuota(item) {
  if (!item) return null;
  const limit = firstNumber(item, ["limit", "max", "total"]);
  if (!limit || limit <= 0) return null;
  const directUsed = firstNumber(item, ["used", "current"]);
  const remaining = firstNumber(item, ["remaining", "remains", "left"]);
  const used = directUsed ?? (remaining === null ? null : Math.max(0, limit - remaining));
  return used === null ? null : { used: Math.min(used, limit), limit, resetAt: firstDate(item, ["resetTime", "reset_at", "resetAt", "reset_time"]) };
}

function quotaRow(label, quota, periodMs) {
  const value = percent(quota.used, quota.limit);
  return row(label, value, quota.resetAt, value === null ? null : `${formatNumber(value)}% used`, periodMs ? periodMs / 1000 : null);
}

function parseWindowMs(window) {
  const duration = firstNumber(window, ["duration"]);
  const unit = upperString(window, ["timeUnit", "time_unit"]);
  if (!duration || !unit) return null;
  if (unit.includes("MINUTE")) return duration * 60000;
  if (unit.includes("HOUR")) return duration * 3600000;
  if (unit.includes("DAY")) return duration * 86400000;
  return unit.includes("SECOND") ? duration * 1000 : null;
}

function percentOnlyRow(label, item, duration) {
  const value = firstNumber(item, ["percentage", "usedPercent", "used_percent"]);
  const resetAt = firstDate(item, ["nextResetTime", "resetAt", "reset_at"]) || new Date(Date.now() + duration * 1000);
  return row(label, value ?? 0, resetAt, `${formatNumber(value ?? 0)}/100`, duration);
}
