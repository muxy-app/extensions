import { clamp, nonEmptyString, numberOrNull } from "./values.mjs";
import { currency, detail, displayLabel, firstDate, firstNumber, formatNumber, parseGenericWindows, percent, row, upperString } from "./live-values.mjs";

export function parseClaudeRows(payload) {
  const planName = payload?.plan?.display_name || payload?.plan?.name || payload?.plan || payload?.plan_name || payload?.planName || payload?.subscription?.plan || "";
  const rows = [
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
  return { rows, planName };
}

export function parseCodexRows(payload) {
  const rawPlan = payload?.plan_type || payload?.planType || payload?.account?.plan || payload?.plan || payload?.plan_name || payload?.planName || "";
  const planName = rawPlan.toLowerCase() === "prolite" ? "Pro 5x" : rawPlan.toLowerCase() === "pro" ? "Pro 20x" : rawPlan;
  const rateLimit = payload?.rate_limit;
  if (!rateLimit) return { rows: parseGenericWindows(payload, [["monthly", "Monthly"], ["daily", "Daily"], ["hourly", "Hourly"], ["current_billing_period", "Billing"]]), planName };
  return {
    rows: [
      rowForWindow(rateLimit.primary_window, "5h"),
      rowForWindow(rateLimit.secondary_window, "7d"),
      rowForWindow(payload?.code_review_rate_limit?.primary_window, "Reviews"),
    ].filter(Boolean),
    planName,
  };
}

export function parseAmpRows(payload) {
  const planName = payload?.plan || payload?.plan_name || payload?.planName || payload?.subscription?.plan || payload?.product?.name || "";
  const text = nonEmptyString(payload?.result?.displayText ?? payload?.result?.display_text);
  if (!text) return { rows: [], planName };
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
  return { rows, planName };
}

export function parseCopilotRows(payload) {
  const planName = payload?.copilot_plan || payload?.plan || payload?.plan_name || payload?.planName || payload?.product?.name || payload?.subscription?.plan || "";
  const quotaResetAt = firstDate(payload, ["quota_reset_date"]);
  const limitedResetAt = firstDate(payload, ["limited_user_reset_date"]);
  const resetAt = quotaResetAt || limitedResetAt;
  if (!resetAt) return { rows: [], planName };
  const rows = [];

  // Paid tier: quota_snapshots
  const snapshots = payload?.quota_snapshots || {};
  for (const key of Object.keys(snapshots)) {
    const item = snapshots[key];
    const limit = firstNumber(item, ["entitlement", "quota", "limit"]);
    const remaining = firstNumber(item, ["remaining"]);
    const percentRemaining = firstNumber(item, ["percent_remaining"]);
    const value = percentRemaining === null ? percent(limit === null || remaining === null ? null : limit - remaining, limit) : clamp(100 - percentRemaining, 0, 100);
    rows.push(row(displayLabel(key), value, resetAt, detail(limit === null || remaining === null ? null : limit - remaining, limit), 2592000));
  }

  // Free tier: limited_user_quotas (monthly limited accounts)
  if (payload?.limited_user_quotas && payload?.monthly_quotas && limitedResetAt) {
    const lq = payload.limited_user_quotas;
    const mq = payload.monthly_quotas;

    const chatRemaining = firstNumber(lq, ["chat"]);
    const chatTotal = firstNumber(mq, ["chat"]);
    if (chatRemaining !== null && chatTotal !== null && chatTotal > 0) {
      const chatUsed = Math.max(0, chatTotal - chatRemaining);
      rows.push(row("Chat", percent(chatUsed, chatTotal), limitedResetAt, detail(chatUsed, chatTotal), 2592000));
    }

    const completionsRemaining = firstNumber(lq, ["completions"]);
    const completionsTotal = firstNumber(mq, ["completions"]);
    if (completionsRemaining !== null && completionsTotal !== null && completionsTotal > 0) {
      const completionsUsed = Math.max(0, completionsTotal - completionsRemaining);
      rows.push(row("Completions", percent(completionsUsed, completionsTotal), limitedResetAt, detail(completionsUsed, completionsTotal), 2592000));
    }
  }

  return { rows: rows.filter((item) => item.percent !== null || item.resetAt || item.detail), planName };
}

export function parseKimiRows(payload) {
  const membershipLevel = payload?.user?.membership?.level;
  const planName = membershipLevel ? String(membershipLevel).replace(/^LEVEL_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : payload?.plan || payload?.plan_name || payload?.planName || payload?.data?.plan || payload?.data?.plan_name || payload?.data?.planName || payload?.product || payload?.product_name || "";
  const data = payload?.data || payload || {};
  const candidates = (Array.isArray(data.limits) ? data.limits : []).flatMap((item) => {
    const quota = parseQuota(item.detail || item);
    return quota ? [{ quota, periodMs: parseWindowMs(item.window) }] : [];
  });
  const session = [...candidates].sort((left, right) => (left.periodMs ?? Infinity) - (right.periodMs ?? Infinity))[0];
  const weekly = parseQuota(data.usage) || candidates.find((candidate) => candidate !== session)?.quota;
  return { rows: [session && quotaRow("Session", session.quota, session.periodMs), weekly && weekly !== session?.quota && quotaRow("Weekly", weekly, null)].filter(Boolean), planName };
}

export function parseFactoryRows(payload) {
  const planName = payload?.plan_name || payload?.planName || payload?.usage?.plan_name || payload?.usage?.planName || "";
  const usage = payload?.usage;
  if (!usage) return { rows: [], planName };
  const startAt = firstDate(usage, ["startDate", "start_date"]);
  const endAt = firstDate(usage, ["endDate", "end_date"]);
  const duration = startAt && endAt ? Math.max(0, (endAt.getTime() - startAt.getTime()) / 1000) : null;
  return { rows: [factoryBucketRow("Standard", usage.standard, endAt, duration), factoryBucketRow("Premium", usage.premium, endAt, duration)].filter(Boolean), planName };
}

export function parseMiniMaxRows(payload) {
  const planName = payload?.data?.plan_name || payload?.data?.planName || payload?.data?.result?.plan_name || payload?.data?.result?.planName || "";
  const candidates = [payload, payload?.data, payload?.data?.result, payload?.result].filter(Boolean);
  for (const candidate of candidates) {
    const remains = candidate.model_remains || candidate.modelRemains;
    if (!Array.isArray(remains) || remains.length === 0) continue;
    const selected = remains.find((item) => firstNumber(item, ["current_interval_total_count", "currentIntervalTotalCount", "total", "limit"]) > 0) || remains[0];
    const parsed = parseLimit(selected, ["current_interval_total_count", "currentIntervalTotalCount", "total", "limit"], ["current_interval_remaining_count", "currentIntervalRemainingCount", "remaining", "remains"]);
    if (!parsed) continue;
    const resetAt = firstDate(selected, ["end_time", "endTime", "reset_at", "resetAt"]);
    return { rows: [row("Session", percent(parsed.used, parsed.total), resetAt, `${formatNumber(parsed.used)}/${formatNumber(parsed.total)}`, 18000)], planName };
  }
  const rows = parseGenericWindows(payload, [["monthly", "Monthly"], ["daily", "Daily"], ["requests", "Requests"]]);
  return { rows, planName };
}

export function parseZaiRows(payload, planName) {
  const limits = payload?.data?.limits || payload?.limits || (Array.isArray(payload?.data) ? payload.data : []);
  const session = limits.find((item) => upperString(item, ["limitType", "type", "name"]) === "TOKENS_LIMIT" && Number(item.unit) === 3);
  const weekly = limits.find((item) => upperString(item, ["limitType", "type", "name"]) === "TOKENS_LIMIT" && Number(item.unit) === 6);
  const web = limits.find((item) => upperString(item, ["limitType", "type", "name"]) === "TIME_LIMIT");
  return [
    session && percentOnlyRow("Session", session, 18000),
    weekly && percentOnlyRow("Weekly", weekly, 604800),
    web && row("Web", firstNumber(web, ["percentage", "usedPercent", "used_percent"]), firstDate(web, ["nextResetTime", "resetAt", "reset_at"]) || new Date(Date.now() + 2592000000), null, 2592000),
  ].filter(Boolean);
}

export function parseZaiPlanName(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  return entries.map((item) => nonEmptyString(item.productName || item.product_name || item.name)).find(Boolean) || "";
}

export function parseGrokRows(payload) {
  const config = payload?.config;
  if (!config || typeof config !== "object") return [];

  const used = numberOrNull(config.used?.val);
  const limit = numberOrNull(config.monthlyLimit?.val);
  if (used === null || limit === null || limit <= 0) return [];

  const pct = clamp((used / limit) * 100, 0, 100);
  const billingEnd = firstDate(config, ["billingPeriodEnd"]);

  return [row("Credits", pct, billingEnd, `${formatNumber(used)} / ${formatNumber(limit)} units`, 2592000)];
}

export function parseCursorRows(payload) {
  const planUsage = payload?.planUsage;
  if (!planUsage || typeof planUsage !== "object") return { rows: [], planName: nonEmptyString(payload?.planInfo?.planName) || "" };

  const limit = numberOrNull(planUsage.limit);
  if (!limit || limit <= 0) return { rows: [], planName: nonEmptyString(payload?.planInfo?.planName) || "" };

  const totalSpend = numberOrNull(planUsage.totalSpend) ?? 0;
  const pct = firstNumber(planUsage, ["totalPercentUsed"]) ?? clamp((totalSpend / limit) * 100, 0, 100);
  const billingEnd = firstDate(payload, ["billingCycleEnd"]);

  return {
    rows: [row("Monthly", pct, billingEnd, `$${(totalSpend / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`, 2592000)],
    planName: nonEmptyString(payload?.planInfo?.planName) || "",
  };
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

export function parseOpenCodeGoRows(rows, nowMs) {
  const LIMITS = { session: 12, weekly: 30, monthly: 60 };
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const sessionCost = sumRange(rows, nowMs - FIVE_HOURS_MS, nowMs);
  const weeklyStartMs = startOfUtcWeek(nowMs);
  const weeklyCost = sumRange(rows, weeklyStartMs, weeklyStartMs + WEEK_MS);
  const monthlyStartMs = startOfUtcMonth(nowMs);
  const monthlyEndMs = startOfNextUtcMonth(nowMs);
  const monthlyCost = sumRange(rows, monthlyStartMs, monthlyEndMs);
  const sessionReset = new Date(nextRollingReset(rows, nowMs, FIVE_HOURS_MS));

  return [
    row("Session", percent(sessionCost, LIMITS.session), sessionReset, `${formatNumber(sessionCost)} / ${LIMITS.session} credits`, FIVE_HOURS_MS / 1000),
    row("Weekly", percent(weeklyCost, LIMITS.weekly), new Date(weeklyStartMs + WEEK_MS), `${formatNumber(weeklyCost)} / ${LIMITS.weekly} credits`, WEEK_MS / 1000),
    row("Monthly", percent(monthlyCost, LIMITS.monthly), new Date(monthlyEndMs), `${formatNumber(monthlyCost)} / ${LIMITS.monthly} credits`, (monthlyEndMs - monthlyStartMs) / 1000),
  ];
}

function sumRange(rows, startMs, endMs) {
  let total = 0;
  for (const row of rows) {
    if (row.createdMs >= startMs && row.createdMs < endMs) total += row.cost;
  }
  return Math.round(total * 10000) / 10000;
}

function startOfUtcWeek(nowMs) {
  const date = new Date(nowMs);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfUtcMonth(nowMs) {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfNextUtcMonth(nowMs) {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function nextRollingReset(rows, nowMs, windowMs) {
  const startMs = nowMs - windowMs;
  let oldest = null;
  for (const row of rows) {
    if (row.createdMs >= startMs && row.createdMs < nowMs) {
      if (oldest === null || row.createdMs < oldest) oldest = row.createdMs;
    }
  }
  return (oldest === null ? nowMs : oldest) + windowMs;
}

function percentOnlyRow(label, item, duration) {
  const value = firstNumber(item, ["percentage", "usedPercent", "used_percent"]);
  const resetAt = firstDate(item, ["nextResetTime", "resetAt", "reset_at"]) || new Date(Date.now() + duration * 1000);
  return row(label, value ?? 0, resetAt, `${formatNumber(value ?? 0)}/100`, duration);
}
