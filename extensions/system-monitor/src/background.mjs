import { parseFast, parseSlow, parseProcs, netRate } from "./parsers.mjs";
import { renderTemplate, normalizeConfig, fmtPct } from "./format.mjs";

// ── Consent contract ────────────────────────────────────────────────────────
// Shell-form exec consent is remembered by EXACT string. These three commands
// are frozen, versioned constants — never edit casually. Changing a single
// byte re-prompts every user on upgrade: bump to _V2 and note it in the
// release notes instead.
// V1 → V2 (0.1.0, pre-release): appended the ioreg GPU block.
const SNAP_FAST_V2 =
  "uname -s; echo @@; top -l 1 -n 0 -s 0; echo @@; vm_stat; echo @@; " +
  "sysctl -n hw.pagesize hw.memsize vm.loadavg vm.swapusage; echo @@; netstat -ibn; " +
  "echo @@; ioreg -r -d 1 -w 0 -c IOAccelerator";
const SNAP_SLOW_V1 = "pmset -g batt; echo @@; df -kP /";
const SNAP_PROCS_V1 = "ps -Areo pid,pcpu,pmem,rss,comm -r | head -40";

const HISTORY_MAX = 120; // ≈ 6 min at 3 s
const POPOVER_TTL_MS = 30_000; // procs loop expires this long after the last hello/keepalive
const PROCS_INTERVAL_MS = 5_000;
const DENIED_RETRY_MS = 10 * 60_000;
const FAILURE_BACKOFF_MS = 60_000;
const REMOTE_RECHECK_MS = 60_000;
const NOTIFY_COOLDOWN_MS = 15 * 60_000;
const STATUS_ITEM = "stats";
const ICON_NORMAL = { symbol: "gauge.with.dots.needle.33percent" };
const ICON_WARN = { symbol: "exclamationmark.triangle" };

const state = {
  config: normalizeConfig(null),
  snapshot: { at: 0, os: null, cpu: null, loadavg: null, mem: null, swap: null, net: null, gpu: null, power: null, disk: null, stale: true },
  history: { cpu: [], gpu: [], down: [], up: [] },
  prevNet: null, // { ibytes, obytes, at }
  paused: false, // remote (non-Darwin) workspace active
  denied: { fast: false, slow: false, procs: false },
  retryAt: { fast: 0, slow: 0, procs: 0 },
  failures: { fast: 0, slow: 0 },
  backoffUntil: { fast: 0, slow: 0 },
  warn: { cpuTicks: 0, cpu: false, mem: false, disk: false, lastNotify: {} },
  popoverSeen: 0,
  procsTimer: null,
  fastTimer: null,
  slowTimer: null,
  lastStatus: { text: undefined, icon: undefined },
};

// ── exec plumbing ───────────────────────────────────────────────────────────

async function snap(kind, shell, timeoutMs) {
  const now = Date.now();
  if (state.denied[kind] && now < state.retryAt[kind]) return null;
  try {
    const res = await muxy.exec({ shell, timeoutMs });
    state.denied[kind] = false;
    if (kind !== "procs") {
      state.failures[kind] = 0;
      state.backoffUntil[kind] = 0;
    }
    return res;
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/denied|blocked|consent|cancel/i.test(message)) {
      // Deny / Deny & remember / unanswered prompt. Retry at most once per 10 min.
      state.denied[kind] = true;
      state.retryAt[kind] = Date.now() + DENIED_RETRY_MS;
      console.warn(`system-monitor: ${kind} snapshot denied (${message})`);
    } else if (kind !== "procs") {
      noteFailure(kind, message);
    }
    return null;
  }
}

// 3 consecutive failures → status bar ⚠, back off 60 s, recover automatically.
function noteFailure(kind, message) {
  state.failures[kind] += 1;
  if (state.failures[kind] >= 3) {
    state.backoffUntil[kind] = Date.now() + FAILURE_BACKOFF_MS;
    state.failures[kind] = 0;
    console.warn(`system-monitor: ${kind} snapshot failing, backing off 60s (${message})`);
  }
}

// ── status bar ──────────────────────────────────────────────────────────────

function warnActive() {
  return state.warn.cpu || state.warn.mem || state.warn.disk;
}

function statusText() {
  if (state.paused) return "—";
  if (state.denied.fast) return "⚠";
  if (!state.snapshot.at || state.snapshot.stale) return null; // manifest default (icon only)
  return renderTemplate(state.config.template, state.snapshot);
}

function updateStatusBar() {
  const text = statusText();
  const anyDenied = state.denied.fast || state.denied.slow || state.denied.procs;
  const icon = warnActive() || anyDenied ? ICON_WARN : ICON_NORMAL;
  if (text === state.lastStatus.text && icon.symbol === state.lastStatus.icon) return;
  state.lastStatus = { text, icon: icon.symbol };
  try {
    muxy.statusbar.set({ id: STATUS_ITEM, icon, text });
  } catch (error) {
    console.warn("system-monitor: statusbar.set failed", error);
  }
}

// ── thresholds ──────────────────────────────────────────────────────────────

function maybeNotify(metric, body) {
  if (!state.config.thresholds.notify) return;
  const last = state.warn.lastNotify[metric] ?? 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) return;
  state.warn.lastNotify[metric] = Date.now();
  try {
    muxy.notifications.notify({ title: "System Monitor", body });
  } catch (error) {
    console.warn("system-monitor: notify failed", error);
  }
}

function updateWarnings() {
  const t = state.config.thresholds;
  const s = state.snapshot;

  const cpuHot = Number.isFinite(s.cpu?.usage) && s.cpu.usage > t.cpu;
  state.warn.cpuTicks = cpuHot ? state.warn.cpuTicks + 1 : 0;
  const cpuWarn = state.warn.cpuTicks >= 3; // sustained, not a spike
  if (cpuWarn && !state.warn.cpu) maybeNotify("cpu", `CPU above ${t.cpu}% (now ${fmtPct(s.cpu.usage)})`);
  state.warn.cpu = cpuWarn;

  const memPct = s.mem && s.mem.totalB > 0 ? (s.mem.usedB / s.mem.totalB) * 100 : NaN;
  const memWarn = Number.isFinite(memPct) && memPct > t.mem;
  if (memWarn && !state.warn.mem) maybeNotify("mem", `Memory used above ${t.mem}% (now ${fmtPct(memPct)})`);
  state.warn.mem = memWarn;

  const diskWarn = Number.isFinite(s.disk?.pct) && s.disk.pct > t.disk;
  if (diskWarn && !state.warn.disk) maybeNotify("disk", `Disk above ${t.disk}% full (now ${fmtPct(s.disk.pct)})`);
  state.warn.disk = diskWarn;
}

// ── popover protocol ────────────────────────────────────────────────────────

function popoverActive() {
  return Date.now() - state.popoverSeen < POPOVER_TTL_MS;
}

function statusPayload() {
  return {
    paused: state.paused,
    denied: { ...state.denied },
    warn: { cpu: state.warn.cpu, mem: state.warn.mem, disk: state.warn.disk },
  };
}

async function emitSafe(name, payload) {
  try {
    await muxy.events.emit(name, payload);
  } catch (error) {
    console.warn(`system-monitor: emit ${name} failed`, error);
  }
}

function sendState() {
  return emitSafe("extension.mon.state", {
    config: state.config,
    snapshot: state.snapshot,
    history: state.history,
    status: statusPayload(),
  });
}

async function procsTick() {
  // Stop while the popover is gone or the Top section is hidden — the config
  // handler restarts the loop if the section is re-enabled while open.
  if (!popoverActive() || state.config.sections.top === false) {
    clearInterval(state.procsTimer);
    state.procsTimer = null;
    return;
  }
  const res = await snap("procs", SNAP_PROCS_V1, 10_000);
  if (state.denied.procs) return emitSafe("extension.mon.procsResult", { denied: true, procs: [] });
  if (!res) return;
  await emitSafe("extension.mon.procsResult", { denied: false, procs: parseProcs(res.stdout) });
}

function startProcsLoop() {
  if (state.procsTimer) return;
  procsTick();
  state.procsTimer = setInterval(procsTick, PROCS_INTERVAL_MS);
}

// ── ticks ───────────────────────────────────────────────────────────────────

function fastDelayMs() {
  const now = Date.now();
  if (state.paused) return REMOTE_RECHECK_MS;
  if (state.denied.fast) return Math.max(1000, state.retryAt.fast - now);
  if (now < state.backoffUntil.fast) return state.backoffUntil.fast - now;
  return state.config.fastSec * 1000;
}

function slowDelayMs() {
  const now = Date.now();
  if (state.paused) return REMOTE_RECHECK_MS;
  if (state.denied.slow) return Math.max(1000, state.retryAt.slow - now);
  if (now < state.backoffUntil.slow) return state.backoffUntil.slow - now;
  return state.config.slowSec * 1000;
}

// The snapshot itself takes a noticeable fraction of a second (mostly `top`),
// and exec is synchronous — so anchor the cadence by subtracting the tick's
// own duration, or the real period would be interval + exec time.
function scheduleFast(elapsedMs = 0) {
  clearTimeout(state.fastTimer);
  state.fastTimer = setTimeout(fastTick, Math.max(50, fastDelayMs() - elapsedMs));
}

function scheduleSlow(elapsedMs = 0) {
  clearTimeout(state.slowTimer);
  state.slowTimer = setTimeout(slowTick, Math.max(50, slowDelayMs() - elapsedMs));
}

async function fastTick() {
  const started = Date.now();
  const res = await snap("fast", SNAP_FAST_V2, 20_000);
  if (res) {
    const parsed = parseFast(res.stdout);
    if (!parsed.os) {
      // Command ran but produced nothing recognizable — a failure, not a
      // remote workspace.
      noteFailure("fast", `unrecognized snapshot output (exit ${res.exitCode})`);
    } else if (parsed.os !== "Darwin") {
      // Remote (SSH) workspace: the snapshot ran on the remote host. Pause
      // parsing and recheck every 60 s. (v2: Linux collector set.)
      if (!state.paused) console.log(`system-monitor: paused, active workspace is ${parsed.os}`);
      state.paused = true;
      state.prevNet = null;
    } else {
      state.paused = false;
      const at = Date.now();
      const intervalMs = fastDelayMs();
      const rate = parsed.net ? netRate(state.prevNet, parsed.net, at - (state.prevNet?.at ?? 0), intervalMs) : null;
      if (parsed.net) state.prevNet = { ...parsed.net, at };

      state.snapshot = {
        ...state.snapshot,
        at,
        stale: false,
        os: parsed.os,
        cpu: parsed.cpu,
        loadavg: parsed.loadavg,
        mem: parsed.mem,
        swap: parsed.swap,
        net: rate, // null on first tick, counter resets, and wake gaps → shown as "—"
        gpu: parsed.gpu,
      };

      if (Number.isFinite(parsed.cpu?.usage)) push(state.history.cpu, parsed.cpu.usage);
      if (Number.isFinite(parsed.gpu?.usage)) push(state.history.gpu, parsed.gpu.usage);
      if (rate) {
        push(state.history.down, rate.downBps);
        push(state.history.up, rate.upBps);
      }

      updateWarnings();
      if (popoverActive()) {
        emitSafe("extension.mon.tick", { snapshot: state.snapshot, status: statusPayload() });
      }
    }
  }
  updateStatusBar();
  scheduleFast(Date.now() - started);
}

async function slowTick() {
  const started = Date.now();
  if (!state.paused) {
    const res = await snap("slow", SNAP_SLOW_V1, 15_000);
    if (res) {
      const parsed = parseSlow(res.stdout);
      state.snapshot.power = parsed.power;
      state.snapshot.disk = parsed.disk;
      updateWarnings();
      updateStatusBar();
    }
  }
  scheduleSlow(Date.now() - started);
}

function push(arr, value) {
  arr.push(Math.round(value * 100) / 100);
  if (arr.length > HISTORY_MAX) arr.splice(0, arr.length - HISTORY_MAX);
}

// The once-a-minute snapshot that gives a cold-opened popover something to
// show is written by the popover itself, from the tick it already receives —
// background storage is unavailable here, so writing it from this side was a
// no-op. See saveRollup in popover/main.mjs.

// ── startup ─────────────────────────────────────────────────────────────────

// Apply a config supplied by a webview (hello payload or settings save):
// retime the loops and re-render the status bar under the new template.
function applyConfig(raw) {
  state.config = normalizeConfig(raw);
  state.lastStatus = { text: undefined, icon: undefined };
  updateStatusBar();
  scheduleFast();
  scheduleSlow();
}

async function loadStored() {
  // Optimistic: on Muxy builds where the background host gains storage this
  // gives us the real config at launch. Where it doesn't, the popover supplies
  // it with its hello, and the cold-start snapshot is restored popover-side
  // (see hydrateRollup in popover/main.mjs).
  try {
    state.config = normalizeConfig(await muxy.storage.get("config"));
  } catch {
    // Expected on current builds — "verb 'storage.get' is not available in
    // background context". Defaults stand until a webview says hello.
  }
}

async function firstRun() {
  // Anything needing once-ever semantics lives in the popover, which has
  // working storage — see the onboarding note and lastRollup in
  // popover/main.mjs. This used to be guarded on state.storageOk, which is
  // never true here, so none of it ran: the note never appeared and the
  // consent prompts below never got their deliberate single burst.
  //
  // Fire the procs snapshot once now so all three consent prompts arrive in
  // one burst at a moment the user understands (fast + slow follow below).
  await snap("procs", SNAP_PROCS_V1, 10_000);
}

async function main() {
  await loadStored();

  muxy.events.subscribe("extension.mon.hello", async (payload) => {
    state.popoverSeen = Date.now();
    // The popover sends the stored config along (webviews have working
    // storage; the background may not) — adopt it before replying.
    if (payload?.config) applyConfig(payload.config);
    await sendState();
    startProcsLoop();
  });

  muxy.events.subscribe("extension.mon.keepalive", () => {
    state.popoverSeen = Date.now();
  });

  muxy.events.subscribe("extension.mon.bye", () => {
    state.popoverSeen = 0;
    clearInterval(state.procsTimer);
    state.procsTimer = null;
  });

  muxy.events.subscribe("extension.mon.procs", () => {
    state.popoverSeen = Date.now();
    procsTick();
  });

  // The popover writes `config` to storage, then pushes the new value here so
  // the background retimes without a reread.
  muxy.events.subscribe("extension.mon.config", (payload) => {
    state.popoverSeen = Date.now();
    applyConfig(payload);
    if (popoverActive()) startProcsLoop();
    sendState();
  });

  await firstRun();
  await slowTick(); // battery/disk first so cadence + sections are right…
  await fastTick(); // …then the first fast sample (also schedules the loop)
}

main().catch((error) => {
  console.error("system-monitor: background failed to start", error);
});
