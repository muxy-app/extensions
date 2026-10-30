// focus-timer background script — the whole engine, alive whether or not any
// UI is open. Owns attribution, the heartbeat probe, the segment engine, the
// agent meter, the pomodoro machine, persistence, and the status-bar item.
//
// Persistence note: muxy.storage is not available in the background host
// (verbs are rejected), so durable state lives in a local JSON file written
// through two frozen, consent-stable shell commands (see shared/consts.js and
// the README). Webview surfaces still use muxy.storage for the mirror
// fallback when the file write is denied.

import {
  HB_V1,
  READ_V1,
  WRITE_V1,
  HB_INTERVAL_MS,
  FLUSH_INTERVAL_MS,
  FLUSH_MIN_GAP_MS,
  DENIED_RETRY_MS,
  FAILURE_BACKOFF_MS,
  POPOVER_TTL_MS,
  STATE_FILE_VERSION,
} from "./shared/consts.js";
import {
  normalizeConfig,
  dayKey,
  splitByDay,
  fmtDuration,
  fmtCountdown,
  basename,
} from "./shared/format.js";
import { parseProbe, parseStateRead, isMuxyFrontmost } from "./shared/probe.js";
import {
  initialEngine,
  initialAgents,
  step,
  agentStatus,
  agentGap,
  inWorkHours,
} from "./shared/engine.js";
import {
  applyDeltas,
  addPomo,
  mergeDays,
  pruneDays,
  sliceRange,
  daySummary,
  pushPomoLog,
  settlePomoLog,
  mergePomoLog,
} from "./shared/rollup.js";
import * as Pomo from "./shared/pomo.js";

const STATUS_ITEM = "timer";
const MIRROR_DAYS = 60; // mirror fallback keeps this many days (event-size cap)

const state = {
  config: normalizeConfig(null),
  engine: initialEngine(),
  agents: initialAgents(),
  pomo: Pomo.initialPomo(),
  baseDays: {}, // hydrated from the store
  sessionDays: {}, // deltas since hydration/last successful flush
  ctx: { projects: {}, worktrees: {} },
  pomoLog: [],
  onboarded: false,
  configTouched: false,
  dirty: false,
  lastFlushAt: 0,
  persist: {
    canRead: null, // null = unprobed
    canWrite: null,
    hydrated: false,
    adoptedSavedAt: 0,
    mode: "unknown", // 'file' | 'mirror' | 'unknown'
    notifiedDenied: false,
  },
  probe: { denied: false, retryAt: 0, failures: 0, backoffUntil: 0 },
  popoverSeen: 0,
  lastStatus: { text: undefined, icon: undefined },
  pomoTimer: null,
  beatTimer: null,
};

function fire(p) {
  Promise.resolve(p).catch((e) => console.log("focus-timer:", e?.message ?? e));
}

async function emitSafe(name, payload) {
  try {
    await muxy.events.emit(name, payload);
  } catch (e) {
    console.warn(`focus-timer: emit ${name} failed`, e?.message ?? e);
  }
}

function isDenialError(error) {
  return /denied|blocked|consent|cancel/i.test(String(error?.message ?? error));
}

// The merged base+session view is read every second by the status bar —
// memoize it and invalidate whenever either side changes.
let mergedCache = null;

function invalidateDays() {
  mergedCache = null;
}

function mergedDays() {
  return (mergedCache ??= mergeDays(state.baseDays, state.sessionDays));
}

function markDirty() {
  state.dirty = true;
}

// ── engine plumbing ─────────────────────────────────────────────────────────

function fold(deltas) {
  if (!deltas.length) return;
  applyDeltas(state.sessionDays, deltas);
  invalidateDays();
  markDirty();
}

function dispatch(signal) {
  const prevBeat = state.engine.lastBeatAt;
  const { state: next, deltas, gap } = step(state.engine, signal, state.config);
  state.engine = next;
  fold(deltas);
  if (gap && prevBeat != null) {
    const r = agentGap(state.agents, prevBeat, signal.at);
    state.agents = r.agents;
    fold(r.deltas);
    // Wake also re-checks pomodoro phases that expired during sleep.
    expirePomo();
  }
  if (deltas.length) requestFlush();
  updateStatusBar();
  pushState();
}

function onAgentStatus(payload) {
  const { agents, deltas } = agentStatus(state.agents, {
    at: Date.now(),
    worktreeID: payload.worktreeID,
    projectID: payload.projectID ?? null,
    status: payload.status,
  });
  state.agents = agents;
  fold(deltas);
  if (deltas.length) requestFlush();
  pushState();
}

// ── context map ─────────────────────────────────────────────────────────────

function harvestPane(p) {
  if (!p || typeof p !== "object") return;
  if (p.projectID && p.projectPath) {
    state.ctx.projects[p.projectID] = {
      ...state.ctx.projects[p.projectID],
      name: basename(p.projectPath) ?? String(p.projectID),
      path: p.projectPath,
    };
    markDirty();
  }
  if (p.worktreeID) {
    const wt = state.ctx.worktrees[p.worktreeID] ?? {};
    if (p.cwd) {
      wt.path = p.cwd;
      wt.name = basename(p.cwd) ?? wt.name;
    }
    if (p.projectID) wt.projectID = p.projectID;
    wt.lastSeen = Date.now();
    state.ctx.worktrees[p.worktreeID] = wt;
    markDirty();
  }
}

function onCtxSync(p) {
  if (!p || typeof p !== "object") return;
  for (const [id, v] of Object.entries(p.projects ?? {})) {
    if (v && typeof v === "object") state.ctx.projects[id] = { ...state.ctx.projects[id], ...v };
  }
  for (const [id, v] of Object.entries(p.worktrees ?? {})) {
    if (v && typeof v === "object") {
      state.ctx.worktrees[id] = { ...state.ctx.worktrees[id], ...v, lastSeen: Date.now() };
    }
  }
  markDirty();
}

function projectName(projectID) {
  return state.ctx.projects[projectID]?.name ?? (projectID ? projectID.slice(0, 8) : "unknown");
}

// ── heartbeat ───────────────────────────────────────────────────────────────

async function beatTick() {
  const started = Date.now();
  try {
    await runBeat(started);
  } catch (e) {
    console.warn("focus-timer: heartbeat error", e?.message ?? e);
    dispatch({ type: "probeFail", at: Date.now() });
  }
  scheduleBeat(Date.now() - started);
}

async function runBeat(at) {
  const p = state.probe;
  if ((p.denied && at < p.retryAt) || at < p.backoffUntil) {
    // No exec this beat — but the engine still needs the tick for degraded
    // bookkeeping (assume-active expiry, sleep gaps).
    dispatch({ type: "probeFail", at });
    return;
  }
  let res = null;
  try {
    res = await Promise.resolve(muxy.exec({ shell: HB_V1, timeoutMs: 10_000 }));
    p.denied = false;
  } catch (e) {
    if (isDenialError(e)) {
      if (!p.denied) console.warn("focus-timer: probe consent denied — tracking from events only");
      p.denied = true;
      p.retryAt = Date.now() + DENIED_RETRY_MS;
    } else {
      noteProbeFailure(e?.message ?? e);
    }
    dispatch({ type: "probeFail", at });
    return;
  }
  const parsed = parseProbe(res?.stdout);
  const usable =
    parsed.idleNs !== null && (state.config.mode === "machine" || parsed.frontmost !== null);
  if (!res || res.timedOut || !usable) {
    // Unparseable — remote workspace (no ioreg / no GUI session) or output
    // drift. Degrade identically to a probe failure.
    noteProbeFailure(`unusable probe output (exit ${res?.exitCode})`);
    dispatch({ type: "probeFail", at });
    return;
  }
  p.failures = 0;
  p.backoffUntil = 0;
  const idleMs = parsed.idleNs / 1e6;
  const active =
    idleMs < state.config.idleSec * 1000 &&
    (state.config.mode === "machine" || isMuxyFrontmost(parsed.frontmost));
  dispatch({ type: "probe", at, active, idleMs });
}

function noteProbeFailure(message) {
  state.probe.failures += 1;
  if (state.probe.failures >= 3) {
    state.probe.failures = 0;
    state.probe.backoffUntil = Date.now() + FAILURE_BACKOFF_MS;
    console.warn(`focus-timer: probe failing, backing off 60s (${message})`);
  }
}

function scheduleBeat(elapsedMs = 0) {
  clearTimeout(state.beatTimer);
  state.beatTimer = setTimeout(beatTick, Math.max(1000, HB_INTERVAL_MS - elapsedMs));
}

// ── pomodoro ────────────────────────────────────────────────────────────────

function notifyPhase(event) {
  if (!state.config.pomo.notify || event.silent) return;
  const name = projectName(event.projectID);
  let title = null;
  let body = null;
  if (event.kind === "focus-complete") {
    title = "Focus done — take a break";
    body = `${state.config.pomo.focusMin} min on ${name} in the bank.`;
  } else if (event.kind === "break-over" || event.kind === "longBreak-over") {
    title = "Break's over";
    body = state.config.pomo.autoStartFocus ? "Next focus started." : "Start the next focus when ready.";
  }
  if (title) fire(muxy.notifications.notify({ title, body }));
}

function trackPomoTransition(prev, next) {
  // A focus phase just started (fresh startedAt) → open a history entry.
  if (
    next.phase === "focus" &&
    next.endsAt !== null &&
    (prev.phase !== "focus" || prev.startedAt !== next.startedAt)
  ) {
    state.pomoLog = pushPomoLog(state.pomoLog, {
      startedAt: next.startedAt,
      minutes: state.config.pomo.focusMin,
      projectID: next.projectID,
      completed: false,
    });
    markDirty();
  }
}

function expirePomo() {
  const now = Date.now();
  if (state.pomo.endsAt === null || now < state.pomo.endsAt) return;
  const prev = state.pomo;
  const { pomo, events } = Pomo.expire(prev, state.config, now, state.engine.active.projectID);
  state.pomo = pomo;
  for (const event of events) {
    if (event.kind === "focus-complete") {
      addPomo(state.sessionDays, dayKey(event.at), event.projectID);
      state.pomoLog = settlePomoLog(state.pomoLog, event.startedAt, true);
      markDirty();
    }
    notifyPhase(event);
  }
  trackPomoTransition(prev, state.pomo);
  if (events.length) {
    markDirty();
    requestFlush();
  }
  armPomoTimer();
}

function armPomoTimer() {
  clearTimeout(state.pomoTimer);
  state.pomoTimer = null;
  if (state.pomo.endsAt !== null) {
    state.pomoTimer = setTimeout(() => {
      expirePomo();
      updateStatusBar();
      pushState();
    }, Math.max(250, state.pomo.endsAt - Date.now()));
  }
}

function applyPomo(next) {
  const prev = state.pomo;
  state.pomo = next;
  trackPomoTransition(prev, next);
  // Abandoning a running focus settles its history entry as incomplete.
  if (prev.phase === "focus" && prev.startedAt !== null && next.phase === "idle" && !next.pending) {
    state.pomoLog = settlePomoLog(state.pomoLog, prev.startedAt, false);
  }
  markDirty();
  armPomoTimer();
  updateStatusBar();
  pushState();
}

function onPomoCommand(cmd) {
  const now = Date.now();
  const projectID = state.engine.active.projectID;
  const c = state.config;
  switch (cmd) {
    case "pomo.toggle":
      applyPomo(Pomo.toggle(state.pomo, c, now, projectID).pomo);
      break;
    case "pomo.start":
      if (Pomo.isPaused(state.pomo)) applyPomo(Pomo.resume(state.pomo, now));
      else applyPomo(Pomo.start(state.pomo, c, now, projectID));
      break;
    case "pomo.pause":
      applyPomo(Pomo.pause(state.pomo, now));
      break;
    case "pomo.resume":
      applyPomo(Pomo.resume(state.pomo, now));
      break;
    case "pomo.skip":
      applyPomo(Pomo.skip(state.pomo, c, now, projectID));
      break;
    case "pomo.abandon":
      applyPomo(Pomo.abandon(state.pomo));
      break;
    default:
      break;
  }
}

// ── tracking toggle & config ────────────────────────────────────────────────

function setTrackingPaused(paused) {
  if (state.config.paused === paused) return;
  const now = Date.now();
  state.config = { ...state.config, paused };
  state.configTouched = true;
  dispatch({ type: paused ? "pause" : "resume", at: now });
  markDirty();
  requestFlush();
  fire(
    muxy.notifications.notify({
      title: "Focus Timer",
      body: paused ? "Time tracking paused" : "Time tracking resumed",
    }),
  );
}

function onConfigSet(raw) {
  const prev = state.config;
  const next = normalizeConfig({ ...prev, ...raw, pomo: { ...prev.pomo, ...(raw?.pomo ?? {}) } });
  state.config = next;
  state.configTouched = true;
  const now = Date.now();
  if (next.mode !== prev.mode) dispatch({ type: "modeChanged", at: now });
  if (next.paused !== prev.paused) dispatch({ type: next.paused ? "pause" : "resume", at: now });
  markDirty();
  requestFlush();
  armPomoTimer();
  updateStatusBar();
  pushState();
}

// ── status bar ──────────────────────────────────────────────────────────────

function statusRender() {
  const now = Date.now();
  const pomo = state.pomo;
  if (Pomo.isRunning(pomo)) {
    const remaining = pomo.endsAt - now;
    const icon = pomo.phase === "focus" ? "timer" : "cup.and.saucer";
    return { icon, text: fmtCountdown(remaining) };
  }
  if (Pomo.isPaused(pomo)) {
    return { icon: "pause.circle", text: fmtCountdown(pomo.remainingMs) };
  }
  if (state.config.paused) {
    return { icon: "pause.circle", text: null };
  }
  const summary = daySummary(mergedDays(), dayKey(now));
  const active = summary.byProject.find((p) => p.projectID === state.engine.active.projectID);
  const seconds = active ? active.you : summary.total;
  const approx = state.engine.degraded || summary.degraded;
  return { icon: "hourglass", text: `${approx ? "~" : ""}${fmtDuration(seconds)}` };
}

function updateStatusBar() {
  const { icon, text } = statusRender();
  if (text === state.lastStatus.text && icon === state.lastStatus.icon) return;
  state.lastStatus = { text, icon };
  try {
    muxy.statusbar.set({ id: STATUS_ITEM, icon: { symbol: icon }, text });
  } catch (e) {
    console.warn("focus-timer: statusbar.set failed", e?.message ?? e);
  }
}

// ── persistence ─────────────────────────────────────────────────────────────

function serializeState(savedAt) {
  return {
    v: STATE_FILE_VERSION,
    savedAt,
    onboarded: true,
    config: state.config,
    days: pruneDays(mergedDays(), dayKey(savedAt)),
    ctx: state.ctx,
    pomoLog: state.pomoLog,
    checkpoint: {
      segment: state.engine.segment,
      agentSegments: state.agents,
      pomo: state.pomo,
    },
  };
}

function requestFlush() {
  if (Date.now() - state.lastFlushAt >= FLUSH_MIN_GAP_MS) fire(flush());
}

async function flush() {
  if (!state.dirty) return;
  if (state.persist.canWrite === false) return; // mirror mode — webviews persist
  if (!state.persist.hydrated) {
    // Never overwrite an unread file with session-only data.
    await hydrate({ quiet: true });
    if (!state.persist.hydrated) return;
  }
  state.lastFlushAt = Date.now();
  const payload = serializeState(state.lastFlushAt);
  let res = null;
  try {
    res = await Promise.resolve(
      muxy.exec({ shell: WRITE_V1, stdin: JSON.stringify(payload), timeoutMs: 10_000 }),
    );
  } catch (e) {
    if (isDenialError(e)) return enterMirrorMode("write consent denied");
    console.warn("focus-timer: state write failed", e?.message ?? e);
    return;
  }
  if (res?.exitCode === 90) {
    // Not a local GUI session (remote workspace active) — hold and retry.
    return;
  }
  if (res?.exitCode !== 0 || res?.timedOut) {
    console.warn(`focus-timer: state write exited ${res?.exitCode}${res?.timedOut ? " (timeout)" : ""}`);
    return;
  }
  state.persist.canWrite = true;
  state.persist.mode = "file";
  // Compact: the file now holds base + session, so fold them together.
  state.baseDays = payload.days;
  state.sessionDays = {};
  invalidateDays();
  state.onboarded = true;
  state.dirty = false;
}

function enterMirrorMode(reason) {
  state.persist.canWrite = false;
  state.persist.mode = "mirror";
  if (!state.persist.notifiedDenied) {
    state.persist.notifiedDenied = true;
    console.warn(`focus-timer: ${reason} — falling back to popover-mediated persistence`);
    fire(
      muxy.notifications.notify({
        title: "Focus Timer",
        body:
          "State-file write was denied, so history persists only while the popover or report is open (last 60 days). Re-enable in Settings → Extensions → Permissions.",
      }),
    );
  }
  pushState();
}

async function hydrate({ quiet = false } = {}) {
  let res = null;
  try {
    res = await Promise.resolve(muxy.exec({ shell: READ_V1, timeoutMs: 10_000 }));
    state.persist.canRead = true;
  } catch (e) {
    if (isDenialError(e)) {
      state.persist.canRead = false;
      enterMirrorMode("read consent denied");
    } else if (!quiet) {
      console.warn("focus-timer: state read failed", e?.message ?? e);
    }
    return;
  }
  const { local, state: stored } = parseStateRead(res?.stdout);
  if (!local) return; // remote workspace — retry before the first flush
  state.persist.hydrated = true;
  if (!stored) return; // fresh install
  adoptStored(stored, "file");
}

function adoptStored(stored, source) {
  const savedAt = Number(stored.savedAt) || 0;
  if (savedAt <= state.persist.adoptedSavedAt) return;
  state.persist.adoptedSavedAt = savedAt;
  state.onboarded = stored.onboarded === true;
  if (!state.configTouched && stored.config) state.config = normalizeConfig(stored.config);
  if (stored.days && typeof stored.days === "object") {
    state.baseDays = pruneDays(stored.days, dayKey(Date.now()));
    invalidateDays();
  }
  if (stored.ctx && typeof stored.ctx === "object") {
    state.ctx = {
      projects: { ...stored.ctx.projects, ...state.ctx.projects },
      worktrees: { ...stored.ctx.worktrees, ...state.ctx.worktrees },
    };
  }
  if (Array.isArray(stored.pomoLog)) state.pomoLog = mergePomoLog(state.pomoLog, stored.pomoLog);

  // Crash/quit recovery: credit the checkpointed open segments up to savedAt.
  const cp = stored.checkpoint;
  if (cp && typeof cp === "object" && savedAt > 0) {
    if (cp.segment && cp.segment.startedAt < savedAt) {
      fold(splitSegment(cp.segment, savedAt, "you"));
    }
    for (const seg of Object.values(cp.agentSegments ?? {})) {
      if (seg && seg.startedAt < savedAt) fold(splitSegment(seg, savedAt, "agent"));
    }
    if (cp.pomo && typeof cp.pomo === "object" && state.pomo.phase === "idle" && !state.pomo.endsAt) {
      state.pomo = { ...Pomo.initialPomo(), ...cp.pomo };
      expirePomo(); // phases that expired while we were gone complete silently
      armPomoTimer();
    }
  }
  console.log(`focus-timer: hydrated from ${source} (saved ${new Date(savedAt).toISOString()})`);
  updateStatusBar();
  pushState();
}

function splitSegment(seg, closeAt, series) {
  if (!seg.projectID || !(seg.startedAt < closeAt)) return [];
  return splitByDay(seg.startedAt, closeAt).map((part) => ({
    day: part.day,
    projectID: seg.projectID,
    worktreeID: seg.worktreeID ?? null,
    series,
    seconds: part.seconds,
    degraded: seg.degraded === true,
  }));
}

// ── UI protocol ─────────────────────────────────────────────────────────────

function popoverActive() {
  return Date.now() - state.popoverSeen < POPOVER_TTL_MS;
}

function trackingStatus() {
  if (state.config.paused) return "paused";
  if (!inWorkHours(state.config, Date.now())) return "fenced";
  if (state.engine.segment) return state.engine.degraded ? "approx" : "active";
  return state.engine.degraded ? "degraded" : "idle";
}

function statePayload() {
  const now = Date.now();
  const merged = mergedDays();
  const summary = daySummary(merged, dayKey(now));
  const byProject = summary.byProject.slice(0, 6).map((p) => ({
    ...p,
    name: projectName(p.projectID),
    iconColor: state.ctx.projects[p.projectID]?.iconColor ?? null,
    active: p.projectID === state.engine.active.projectID,
  }));
  const payload = {
    at: now,
    config: state.config,
    pomo: Pomo.describe(state.pomo, state.config, now),
    today: { ...summary, byProject },
    tracking: {
      status: trackingStatus(),
      degraded: state.engine.degraded,
      probeDenied: state.probe.denied,
      activeProjectID: state.engine.active.projectID,
      activeProjectName: state.engine.active.projectID ? projectName(state.engine.active.projectID) : null,
      segmentOpen: state.engine.segment !== null,
    },
    persist: { mode: state.persist.mode, canWrite: state.persist.canWrite },
  };
  if (state.persist.canWrite === false) {
    // Mirror fallback: the popover stores this via its working muxy.storage.
    const savedAt = now;
    const keys = Object.keys(merged).sort().slice(-MIRROR_DAYS);
    const mirrorDays = {};
    for (const k of keys) mirrorDays[k] = merged[k];
    payload.mirror = {
      v: STATE_FILE_VERSION,
      savedAt,
      onboarded: true,
      config: state.config,
      days: mirrorDays,
      ctx: state.ctx,
      pomoLog: state.pomoLog,
      checkpoint: { segment: state.engine.segment, agentSegments: state.agents, pomo: state.pomo },
    };
  }
  return payload;
}

function pushState() {
  if (!popoverActive()) return;
  fire(emitSafe("extension.ft.state", statePayload()));
}

function onHello(payload) {
  state.popoverSeen = Date.now();
  if (payload && typeof payload === "object") {
    if (payload.ctx) onCtxSync(payload.ctx);
    for (const a of payload.agents ?? []) {
      if (a?.worktreeID && a.status) {
        onAgentStatus({ worktreeID: a.worktreeID, projectID: a.projectID ?? null, status: a.status });
      }
    }
    if (payload.mirror && state.persist.canWrite === false) adoptStored(payload.mirror, "mirror");
  }
  fire(emitSafe("extension.ft.state", statePayload()));
}

function onQuery(payload) {
  state.popoverSeen = Date.now();
  const from = typeof payload?.from === "string" ? payload.from : dayKey(Date.now());
  const to = typeof payload?.to === "string" ? payload.to : from;
  fire(
    emitSafe("extension.ft.report", {
      from,
      to,
      days: sliceRange(mergedDays(), from, to),
      ctx: state.ctx,
      pomoLog: state.pomoLog,
      tracking: { degraded: state.engine.degraded, probeDenied: state.probe.denied },
      persist: { mode: state.persist.mode },
    }),
  );
}

function onCmd(payload) {
  state.popoverSeen = Date.now();
  const cmd = payload?.cmd;
  if (typeof cmd !== "string") return;
  if (cmd.startsWith("pomo.")) return onPomoCommand(cmd);
  if (cmd === "tracking.toggle") return setTrackingPaused(!state.config.paused);
  if (cmd === "config.set") return onConfigSet(payload.config);
  if (cmd === "data.clear") {
    state.baseDays = {};
    state.sessionDays = {};
    state.pomoLog = [];
    invalidateDays();
    markDirty();
    fire(flush());
    updateStatusBar();
    pushState();
  }
}

// ── startup ─────────────────────────────────────────────────────────────────

function subscribeAll() {
  muxy.events.subscribe("project.switched", (p) => {
    harvestPane(p);
    dispatch({ type: "context", at: Date.now(), projectID: p.projectID ?? null, worktreeID: null });
  });
  muxy.events.subscribe("worktree.switched", (p) =>
    dispatch({
      type: "context",
      at: Date.now(),
      projectID: p.projectID ?? null,
      worktreeID: p.worktreeID ?? null,
    }),
  );
  muxy.events.subscribe("pane.focused", (p) =>
    dispatch({
      type: "context",
      at: Date.now(),
      projectID: p.projectID ?? null,
      worktreeID: p.worktreeID ?? null,
    }),
  );
  muxy.events.subscribe("pane.created", (p) => {
    harvestPane(p);
    dispatch({ type: "activity", at: Date.now() });
  });
  muxy.events.subscribe("pane.closed", (p) => {
    harvestPane(p);
    dispatch({ type: "activity", at: Date.now() });
  });
  muxy.events.subscribe("worktree.headChanged", (p) => {
    if (p.worktreeID) {
      const wt = state.ctx.worktrees[p.worktreeID] ?? {};
      if (p.branch) wt.branch = p.branch;
      if (p.path) {
        wt.path = p.path;
        wt.name = basename(p.path) ?? wt.name;
      }
      if (p.projectID) wt.projectID = p.projectID;
      wt.lastSeen = Date.now();
      state.ctx.worktrees[p.worktreeID] = wt;
      markDirty();
    }
    dispatch({ type: "activity", at: Date.now() });
  });
  muxy.events.subscribe("agent.status", onAgentStatus);

  muxy.events.subscribe("command.pomodoro-toggle", () => onPomoCommand("pomo.toggle"));
  muxy.events.subscribe("command.toggle-tracking", () => setTrackingPaused(!state.config.paused));

  muxy.events.subscribe("extension.ft.hello", onHello);
  muxy.events.subscribe("extension.ft.keepalive", () => {
    state.popoverSeen = Date.now();
  });
  muxy.events.subscribe("extension.ft.bye", () => {
    state.popoverSeen = 0;
  });
  muxy.events.subscribe("extension.ft.cmd", onCmd);
  muxy.events.subscribe("extension.ft.query", onQuery);
  muxy.events.subscribe("extension.ft.ctx", (p) => {
    state.popoverSeen = Date.now();
    onCtxSync(p);
  });
}

async function firstRun() {
  if (state.onboarded) return;
  fire(
    muxy.notifications.notify({
      title: "Focus Timer",
      body:
        "Focus Timer runs two consented local commands: a read-only idle probe and a state file under ~/Library/Application Support. Approve the prompts to start — nothing ever leaves this Mac.",
    }),
  );
}

async function main() {
  subscribeAll();
  await hydrate();
  await firstRun();
  // Establish the write consent in the same burst as the read + probe, and
  // seed the file on fresh installs.
  markDirty();
  fire(flush());

  await beatTick(); // first probe now (also schedules the loop)
  armPomoTimer();
  updateStatusBar();

  setInterval(() => {
    expirePomo();
    if (state.dirty) fire(flush());
    // Re-probe hydration every cycle while a remote workspace blocks it.
    if (!state.persist.hydrated && state.persist.canRead !== false) fire(hydrate({ quiet: true }));
    updateStatusBar();
  }, FLUSH_INTERVAL_MS);

  // Status-bar countdown granularity: re-render every second; the dedupe in
  // updateStatusBar keeps actual statusbar.set calls to ~1/min outside the
  // final minute of a phase.
  setInterval(updateStatusBar, 1000);

  console.log("focus-timer: background ready");
}

main().catch((e) => {
  console.error("focus-timer: background failed to start", e?.message ?? e);
});
