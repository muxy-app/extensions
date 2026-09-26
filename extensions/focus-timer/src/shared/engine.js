// Segment engine — a pure reducer over attribution/idle signals. One open
// segment at a time; closing emits day-split rollup deltas. Driven by an
// injected clock (`at` on every signal) so every edge case is a unit test.
//
// Signals:
//   { type: "context",   at, projectID, worktreeID }   project/worktree/pane focus
//   { type: "activity",  at }                          any workspace event (degraded evidence)
//   { type: "probe",     at, active, idleMs }          heartbeat succeeded
//   { type: "probeFail", at }                          heartbeat failed / denied / unparseable
//   { type: "pause",     at } / { type: "resume", at } manual tracking toggle
//   { type: "modeChanged", at }                        muxy↔machine switch mid-segment
//
// step() returns { state, deltas, gap } — `gap` is true when a sleep gap was
// detected (the caller uses it to gap agent segments too).

import { splitByDay, minutesOf, startOfDay } from "./format.js";
import { HB_INTERVAL_MS, SLEEP_GAP_MS } from "./consts.js";

export function initialEngine() {
  return {
    active: { projectID: null, worktreeID: null },
    segment: null, // { projectID, worktreeID, startedAt, degraded }
    probe: null, // { at, active, idleMs } — last successful heartbeat
    lastBeatAt: null, // last heartbeat of either kind (sleep-gap detection)
    lastActivityAt: null, // last workspace-event evidence
    degraded: false, // probe currently unavailable
  };
}

// ── working-hours fence ─────────────────────────────────────────────────────

export function inWorkHours(config, at) {
  if (!config.workHours) return true;
  const start = minutesOf(config.workHours.start);
  const end = minutesOf(config.workHours.end);
  const d = new Date(at);
  const m = d.getHours() * 60 + d.getMinutes();
  if (start < end) return m >= start && m < end;
  return m >= start || m < end; // overnight window, e.g. 20:00–02:00
}

// The most recent instant ≤ at when the working-hours window ended — used to
// backdate a close when a heartbeat lands outside the fence.
export function lastFenceEnd(config, at) {
  if (!config.workHours) return at;
  const endMin = minutesOf(config.workHours.end);
  for (let back = 0; back < 3; back += 1) {
    const boundary = startOfDay(at - back * 86_400_000) + endMin * 60_000;
    if (boundary <= at) return boundary;
  }
  return at;
}

function allowed(config, at) {
  return !config.paused && inWorkHours(config, at);
}

// ── segment open/close ──────────────────────────────────────────────────────

function closeSegment(state, at, { degraded = false } = {}) {
  const seg = state.segment;
  if (!seg) return [];
  const closeAt = Math.max(seg.startedAt, at);
  const deltas = [];
  for (const part of splitByDay(seg.startedAt, closeAt)) {
    deltas.push({
      day: part.day,
      projectID: seg.projectID,
      worktreeID: seg.worktreeID,
      series: "you",
      seconds: part.seconds,
      degraded: seg.degraded || degraded,
    });
  }
  state.segment = null;
  return deltas;
}

function openSegment(state, at) {
  if (!state.active.projectID) return;
  state.segment = {
    projectID: state.active.projectID,
    worktreeID: state.active.worktreeID,
    startedAt: at,
    degraded: state.degraded,
  };
}

// ── the reducer ─────────────────────────────────────────────────────────────

export function step(prev, signal, config) {
  const state = {
    ...prev,
    active: { ...prev.active },
    segment: prev.segment ? { ...prev.segment } : null,
  };
  const at = signal.at;
  let deltas = [];
  let gap = false;

  switch (signal.type) {
    case "context": {
      state.lastActivityAt = at;
      const projectID = signal.projectID ?? null;
      const worktreeID = signal.worktreeID ?? null;
      const changed =
        state.active.projectID !== projectID || state.active.worktreeID !== worktreeID;
      state.active = { projectID, worktreeID };
      if (state.segment && changed) deltas = closeSegment(state, at);
      // The event itself is evidence the user is here (switching projects
      // means driving Muxy), so open immediately when tracking is allowed.
      if (!state.segment && allowed(config, at)) openSegment(state, at);
      break;
    }

    case "activity": {
      state.lastActivityAt = at;
      // In probe mode heartbeats govern opening; in degraded mode events are
      // the only heartbeat, so an event may open a segment directly.
      if (state.degraded && !state.segment && allowed(config, at)) openSegment(state, at);
      break;
    }

    case "probe": {
      const prevBeat = state.lastBeatAt;
      if (prevBeat != null && at - prevBeat > SLEEP_GAP_MS) {
        // The machine slept: close retroactively at the last heartbeat so
        // the gap contributes nothing.
        gap = true;
        deltas = deltas.concat(closeSegment(state, prevBeat));
      }
      state.lastBeatAt = at;
      state.degraded = false;
      state.probe = { at, active: signal.active, idleMs: signal.idleMs };

      if (state.segment) {
        if (!signal.active) {
          const idleCrossed = signal.idleMs >= config.idleSec * 1000;
          // Idle run-ups are backdated to when input stopped; a frontmost
          // loss is only discovered at the beat, so close at the previous one.
          const closeAt = idleCrossed
            ? Math.max(state.segment.startedAt, at - signal.idleMs)
            : Math.max(state.segment.startedAt, prevBeat ?? at);
          deltas = deltas.concat(closeSegment(state, closeAt));
        } else if (!allowed(config, at)) {
          const closeAt = config.paused ? at : Math.max(state.segment.startedAt, lastFenceEnd(config, at));
          deltas = deltas.concat(closeSegment(state, closeAt));
        }
      } else if (signal.active && allowed(config, at)) {
        // Capture the active run-up inside this beat, but never reach past
        // the previous heartbeat.
        const backdate = Math.min(signal.idleMs, HB_INTERVAL_MS);
        const openAt = Math.max(at - backdate, prevBeat ?? at - backdate);
        openSegment(state, openAt);
      }
      break;
    }

    case "probeFail": {
      const prevBeat = state.lastBeatAt;
      if (prevBeat != null && at - prevBeat > SLEEP_GAP_MS) {
        gap = true;
        deltas = deltas.concat(closeSegment(state, prevBeat));
      }
      state.lastBeatAt = at;
      state.degraded = true;
      state.probe = null;
      if (state.segment) {
        state.segment.degraded = true;
        const expiry = (state.lastActivityAt ?? state.segment.startedAt) + config.assumeActiveMin * 60_000;
        if (at >= expiry) {
          deltas = deltas.concat(closeSegment(state, expiry, { degraded: true }));
        } else if (!allowed(config, at)) {
          const closeAt = config.paused ? at : Math.max(state.segment.startedAt, lastFenceEnd(config, at));
          deltas = deltas.concat(closeSegment(state, closeAt, { degraded: true }));
        }
      }
      break;
    }

    case "pause": {
      deltas = closeSegment(state, at);
      break;
    }

    case "resume": {
      const evidence = state.degraded
        ? state.lastActivityAt != null && at - state.lastActivityAt < config.assumeActiveMin * 60_000
        : state.probe != null && state.probe.active && at - state.probe.at < 2 * HB_INTERVAL_MS;
      if (!state.segment && evidence && allowed(config, at)) openSegment(state, at);
      break;
    }

    case "modeChanged": {
      // Close under the old rules; the next heartbeat reopens under the new.
      deltas = closeSegment(state, at);
      break;
    }

    default:
      break;
  }

  return { state, deltas, gap };
}

// ── agent meter ─────────────────────────────────────────────────────────────
// Independent accumulator from agent.status. No idle-gating — agents don't
// drift off to Safari. Sleep gaps are handled via agentGap() when the
// heartbeat detects one.

export function initialAgents() {
  return {}; // worktreeID → { projectID, worktreeID, startedAt }
}

function closeAgentSegment(seg, at) {
  const deltas = [];
  for (const part of splitByDay(seg.startedAt, Math.max(seg.startedAt, at))) {
    deltas.push({
      day: part.day,
      projectID: seg.projectID,
      worktreeID: seg.worktreeID,
      series: "agent",
      seconds: part.seconds,
    });
  }
  return deltas;
}

export function agentStatus(prev, { at, worktreeID, projectID, status }) {
  if (!worktreeID) return { agents: prev, deltas: [] };
  const agents = { ...prev };
  const open = agents[worktreeID];
  let deltas = [];
  if (status === "working") {
    if (!open) {
      agents[worktreeID] = { projectID: projectID ?? null, worktreeID, startedAt: at };
    }
  } else if (open) {
    deltas = closeAgentSegment(open, at);
    delete agents[worktreeID];
  }
  return { agents, deltas };
}

// The machine slept: close every open agent segment at the last heartbeat and
// reopen at wake, so the gap contributes nothing.
export function agentGap(prev, lastBeatAt, at) {
  const agents = {};
  let deltas = [];
  for (const [id, seg] of Object.entries(prev)) {
    deltas = deltas.concat(closeAgentSegment(seg, lastBeatAt));
    agents[id] = { ...seg, startedAt: at };
  }
  return { agents, deltas };
}
