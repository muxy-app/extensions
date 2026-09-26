// Day rollups: { "<YYYY-MM-DD>": { projects: { id: { you, agent, pomos } },
// worktrees: { id: { you, agent } }, degraded?: true } }. Seconds are stored
// as numbers (fractional is fine); display rounds.

import { KEEP_DAYS, POMOLOG_MAX } from "./consts.js";
import { addDays } from "./format.js";

function projectSlot(day, projectID) {
  const p = (day.projects[projectID] ??= { you: 0, agent: 0, pomos: 0 });
  return p;
}

function worktreeSlot(day, worktreeID) {
  const w = (day.worktrees[worktreeID] ??= { you: 0, agent: 0 });
  return w;
}

export function applyDeltas(days, deltas) {
  for (const delta of deltas) {
    if (!delta || !delta.day || !delta.projectID || !(delta.seconds > 0)) continue;
    const day = (days[delta.day] ??= { projects: {}, worktrees: {} });
    const series = delta.series === "agent" ? "agent" : "you";
    projectSlot(day, delta.projectID)[series] += delta.seconds;
    if (delta.worktreeID) worktreeSlot(day, delta.worktreeID)[series] += delta.seconds;
    if (delta.degraded) day.degraded = true;
  }
  return days;
}

export function addPomo(days, dayKeyStr, projectID) {
  if (!projectID) return days;
  const day = (days[dayKeyStr] ??= { projects: {}, worktrees: {} });
  projectSlot(day, projectID).pomos += 1;
  return days;
}

// Leafwise sum — used to fold this session's deltas over a hydrated base.
export function mergeDays(base, add) {
  const out = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(add)])) {
    const a = base[key];
    const b = add[key];
    if (!a || !b) {
      const only = a ?? b;
      out[key] = {
        projects: structuredCloneish(only.projects ?? {}),
        worktrees: structuredCloneish(only.worktrees ?? {}),
        ...(only.degraded ? { degraded: true } : {}),
      };
      continue;
    }
    const day = { projects: {}, worktrees: {} };
    for (const id of new Set([...Object.keys(a.projects ?? {}), ...Object.keys(b.projects ?? {})])) {
      const pa = a.projects?.[id] ?? {};
      const pb = b.projects?.[id] ?? {};
      day.projects[id] = {
        you: (pa.you ?? 0) + (pb.you ?? 0),
        agent: (pa.agent ?? 0) + (pb.agent ?? 0),
        pomos: (pa.pomos ?? 0) + (pb.pomos ?? 0),
      };
    }
    for (const id of new Set([...Object.keys(a.worktrees ?? {}), ...Object.keys(b.worktrees ?? {})])) {
      const wa = a.worktrees?.[id] ?? {};
      const wb = b.worktrees?.[id] ?? {};
      day.worktrees[id] = { you: (wa.you ?? 0) + (wb.you ?? 0), agent: (wa.agent ?? 0) + (wb.agent ?? 0) };
    }
    if (a.degraded || b.degraded) day.degraded = true;
    out[key] = day;
  }
  return out;
}

function structuredCloneish(value) {
  return JSON.parse(JSON.stringify(value));
}

export function pruneDays(days, todayKey, keep = KEEP_DAYS) {
  const cutoff = addDays(todayKey, -keep);
  for (const key of Object.keys(days)) {
    if (key < cutoff) delete days[key];
  }
  return days;
}

// Day keys are sortable strings, so range filters are string compares.
export function sliceRange(days, fromKey, toKey) {
  const out = {};
  for (const [key, value] of Object.entries(days)) {
    if (key >= fromKey && key <= toKey) out[key] = value;
  }
  return out;
}

// Popover summary for one day: overall + per-project totals, largest first.
export function daySummary(days, dayKeyStr) {
  const day = days[dayKeyStr];
  const byProject = [];
  let total = 0;
  let agentTotal = 0;
  let pomos = 0;
  if (day) {
    for (const [projectID, p] of Object.entries(day.projects)) {
      byProject.push({ projectID, you: p.you ?? 0, agent: p.agent ?? 0, pomos: p.pomos ?? 0 });
      total += p.you ?? 0;
      agentTotal += p.agent ?? 0;
      pomos += p.pomos ?? 0;
    }
    byProject.sort((a, b) => b.you - a.you);
  }
  return { day: dayKeyStr, total, agentTotal, pomos, degraded: day?.degraded === true, byProject };
}

// ── pomodoro history ────────────────────────────────────────────────────────
// Ring buffer of { startedAt, minutes, projectID, completed }.

export function pushPomoLog(log, entry) {
  const next = [entry, ...log];
  if (next.length > POMOLOG_MAX) next.length = POMOLOG_MAX;
  return next;
}

export function settlePomoLog(log, startedAt, completed) {
  return log.map((entry) =>
    entry.startedAt === startedAt ? { ...entry, completed } : entry,
  );
}

export function mergePomoLog(a, b) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...a, ...b].sort((x, y) => y.startedAt - x.startedAt)) {
    if (!entry || seen.has(entry.startedAt)) continue;
    seen.add(entry.startedAt);
    merged.push(entry);
    if (merged.length >= POMOLOG_MAX) break;
  }
  return merged;
}
