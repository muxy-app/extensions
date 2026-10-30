// Pomodoro state machine — pure and timestamp-based, never tick-counted.
// A phase stores `endsAt`; the caller arms one setTimeout and recomputes
// from timestamps on wake. Pausing stores the remaining time.
//
// Shape: { phase: 'idle'|'focus'|'break'|'longBreak', endsAt, remainingMs,
//          pending, cycle, projectID, startedAt }
//   - endsAt !== null        → phase running
//   - remainingMs !== null   → phase paused (endsAt null)
//   - phase 'idle' + pending → waiting for the user to start `pending`

import { SILENT_EXPIRY_MS } from "./consts.js";

export function initialPomo() {
  return {
    phase: "idle",
    endsAt: null,
    remainingMs: null,
    pending: null, // 'focus' | 'break' | 'longBreak' — invited next phase
    cycle: 0, // completed focus sessions in the current cadence run
    projectID: null, // project active when the focus session started
    startedAt: null,
  };
}

export function phaseDurationMs(config, phase) {
  const p = config.pomo;
  if (phase === "focus") return p.focusMin * 60_000;
  if (phase === "longBreak") return p.longBreakMin * 60_000;
  return p.breakMin * 60_000;
}

function enter(pomo, config, now, phase, projectID) {
  return {
    ...pomo,
    phase,
    endsAt: now + phaseDurationMs(config, phase),
    remainingMs: null,
    pending: null,
    projectID: phase === "focus" ? (projectID ?? pomo.projectID) : pomo.projectID,
    startedAt: now,
  };
}

export function isRunning(pomo) {
  return pomo.endsAt !== null;
}

export function isPaused(pomo) {
  return pomo.endsAt === null && pomo.remainingMs !== null && pomo.phase !== "idle";
}

export function start(pomo, config, now, projectID) {
  const phase = pomo.phase === "idle" ? (pomo.pending ?? "focus") : pomo.phase;
  return enter(pomo, config, now, phase === "idle" ? "focus" : phase, projectID);
}

export function pause(pomo, now) {
  if (!isRunning(pomo)) return pomo;
  return { ...pomo, endsAt: null, remainingMs: Math.max(0, pomo.endsAt - now) };
}

export function resume(pomo, now) {
  if (!isPaused(pomo)) return pomo;
  return { ...pomo, endsAt: now + pomo.remainingMs, remainingMs: null };
}

// ⌘⌃T: idle → start focus; running → pause; paused → resume.
export function toggle(pomo, config, now, projectID) {
  if (isRunning(pomo)) return { pomo: pause(pomo, now), action: "paused" };
  if (isPaused(pomo)) return { pomo: resume(pomo, now), action: "resumed" };
  return { pomo: start(pomo, config, now, projectID), action: "started" };
}

// Advance to the next phase immediately. Skipping a focus session earns no
// completion credit.
export function skip(pomo, config, now, projectID) {
  if (pomo.phase === "focus" && (isRunning(pomo) || isPaused(pomo))) {
    const nextPhase = nextBreak(pomo, config);
    return enter(pomo, config, now, nextPhase);
  }
  if ((pomo.phase === "break" || pomo.phase === "longBreak") && (isRunning(pomo) || isPaused(pomo))) {
    return enter(pomo, config, now, "focus", projectID);
  }
  if (pomo.phase === "idle" && pomo.pending) {
    return enter(pomo, config, now, pomo.pending, projectID);
  }
  return pomo;
}

export function abandon(pomo) {
  return { ...pomo, phase: "idle", endsAt: null, remainingMs: null, pending: null, startedAt: null };
}

function nextBreak(pomo, config) {
  // The cycle counter is incremented on completion; a *skipped* focus keeps
  // the counter, so compute against cycle + 1 as if it had finished.
  return (pomo.cycle + 1) % config.pomo.cadence === 0 ? "longBreak" : "break";
}

// Advance past any expired phases. Returns { pomo, events } where each event
// is { kind: 'focus-complete'|'break-over'|'longBreak-over', at, silent,
// projectID }. `silent` marks phases that expired long ago (sleep) — they
// complete without a late alarm. Chained expiries (focus ended during sleep,
// its auto-started break also ended) all resolve in one call.
export function expire(pomo, config, now, activeProjectID) {
  let state = pomo;
  const events = [];
  let guard = 0;
  while (state.endsAt !== null && now >= state.endsAt && guard < 32) {
    guard += 1;
    const endedAt = state.endsAt;
    const silent = now - endedAt > SILENT_EXPIRY_MS;
    if (state.phase === "focus") {
      const cycle = state.cycle + 1;
      const completed = { ...state, cycle };
      events.push({ kind: "focus-complete", at: endedAt, silent, projectID: state.projectID, startedAt: state.startedAt });
      const breakPhase = cycle % config.pomo.cadence === 0 ? "longBreak" : "break";
      if (config.pomo.autoStartBreaks) {
        state = { ...enter(completed, config, endedAt, breakPhase), cycle };
      } else {
        state = { ...completed, phase: "idle", endsAt: null, remainingMs: null, pending: breakPhase, startedAt: null };
      }
    } else {
      const kind = state.phase === "longBreak" ? "longBreak-over" : "break-over";
      events.push({ kind, at: endedAt, silent, projectID: state.projectID });
      const cycle = state.phase === "longBreak" ? 0 : state.cycle;
      if (config.pomo.autoStartFocus) {
        state = { ...enter(state, config, endedAt, "focus", activeProjectID), cycle };
      } else {
        state = { ...state, cycle, phase: "idle", endsAt: null, remainingMs: null, pending: "focus", startedAt: null };
      }
    }
  }
  return { pomo: state, events };
}

// UI description: remaining time and cadence dots.
export function describe(pomo, config, now) {
  const remainingMs = isRunning(pomo)
    ? Math.max(0, pomo.endsAt - now)
    : isPaused(pomo)
      ? pomo.remainingMs
      : null;
  return {
    phase: pomo.phase,
    running: isRunning(pomo),
    paused: isPaused(pomo),
    pending: pomo.pending,
    remainingMs,
    endsAt: pomo.endsAt,
    cycle: pomo.cycle,
    cadence: config.pomo.cadence,
    dotsFilled: pomo.cycle % config.pomo.cadence || (pomo.cycle > 0 ? config.pomo.cadence : 0),
  };
}
