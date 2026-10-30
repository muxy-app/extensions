// focus-timer popover — a viewer over the background engine. The countdown
// ticks locally from `endsAt`; only state changes cross the event channel.

import { h, clear, cls } from "@/lib/dom.js";
import { fmtClock, fmtDuration } from "@/shared/format.js";
import "./style.css";

const KEEPALIVE_MS = 10_000;
const MIRROR_WRITE_MIN_MS = 5_000;

const ui = {};
let latest = null; // last extension.ft.state payload
let settingsOpen = false;
let lastMirrorWrite = 0;

const root = document.getElementById("root");
build();
connect();

// ── layout ──────────────────────────────────────────────────────────────────

function build() {
  ui.banner = h("div", { class: "banner", hidden: true });

  ui.clock = h("div", { class: "pomo-clock" }, "–:––");
  ui.phase = h("div", { class: "pomo-phase" }, "Ready");
  ui.dots = h("div", { class: "pomo-dots" });
  ui.buttons = h("div", { class: "pomo-buttons" });
  const pomoCard = h("div", { class: "section" }, ui.clock, ui.phase, ui.dots, ui.buttons);

  ui.todayTotal = h("span", { class: "today-total" }, "0m");
  ui.todayMeta = h("span", { class: "note" }, "");
  ui.projects = h("div");
  ui.pauseBtn = h(
    "button",
    { class: "toggle", type: "button", onclick: () => cmd("tracking.toggle") },
    "⏸ pause tracking",
  );
  const today = h(
    "div",
    { class: "section" },
    h("div", { class: "row row-spread" }, h("span", { class: "label" }, "Today"), ui.todayMeta),
    h("div", { class: "row row-spread" }, ui.todayTotal, ui.pauseBtn),
    ui.projects,
  );

  // Inline SVG on currentColor so the icon tracks the theme like a template
  // image, instead of a color emoji.
  const chartIcon = h("span", {
    class: "icon",
    html:
      '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
      '<path d="M3 12V8"/><path d="M7 12V3"/><path d="M11 12V6"/></g></svg>',
  });
  const report = h(
    "div",
    { class: "section" },
    h("button", { class: "toggle", type: "button", onclick: openReport }, chartIcon, "Open report ↗"),
  );

  ui.settingsBody = h("div", { class: "settings-grid", hidden: true });
  ui.settingsChevron = h("span", { class: "chevron" }, "⌄");
  const settingsToggle = h(
    "button",
    { class: "toggle", type: "button", onclick: toggleSettings },
    ui.settingsChevron,
    "settings",
  );
  const settings = h("div", { class: "section" }, settingsToggle, ui.settingsBody);

  root.append(ui.banner, pomoCard, today, report, settings);
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  ui.settingsChevron.classList.toggle("open", settingsOpen);
  ui.settingsBody.hidden = !settingsOpen;
  if (settingsOpen && latest) renderSettings(latest.config);
  fit();
}

// ── rendering ───────────────────────────────────────────────────────────────

const PHASE_LABEL = {
  focus: "Focus",
  break: "Break",
  longBreak: "Long break",
  idle: "Ready",
};

function render() {
  if (!latest) return;
  renderBanner();
  renderPomo();
  renderToday();
  if (settingsOpen) renderSettings(latest.config);
  fit();
}

function renderBanner() {
  const t = latest.tracking;
  let text = null;
  if (latest.persist?.canWrite === false) {
    text = "State-file write denied — history persists only while this popover or the report is open. Re-enable in Settings → Extensions → Permissions.";
  } else if (t.probeDenied) {
    text = "Idle probe denied — tracking from workspace events only; totals are approximate (~). Re-enable in Settings → Extensions → Permissions.";
  } else if (t.degraded) {
    text = "Idle detection unavailable (remote workspace?) — tracking from events only; totals are approximate (~).";
  } else if (t.status === "fenced") {
    text = "Outside working hours — tracking is fenced off.";
  }
  ui.banner.hidden = !text;
  if (text) ui.banner.textContent = text;
}

function renderPomo() {
  const p = latest.pomo;
  const remaining = remainingNow();
  ui.clock.textContent = remaining !== null ? fmtClock(remaining) : "–:––";
  const label =
    p.phase === "idle" && p.pending
      ? `Next: ${PHASE_LABEL[p.pending] ?? p.pending}`
      : `${PHASE_LABEL[p.phase] ?? p.phase}${p.paused ? " — paused" : ""}`;
  ui.phase.textContent = label;
  ui.phase.className = cls("pomo-phase", p.phase === "focus" && "focus");

  clear(ui.dots);
  for (let i = 0; i < p.cadence; i += 1) {
    ui.dots.append(h("span", { class: cls("dot", i < p.dotsFilled && "filled") }));
  }
  if (latest.today.pomos > 0) {
    ui.dots.append(h("span", null, ` ${latest.today.pomos} today`));
  }

  clear(ui.buttons);
  const btn = (label, command, primary = false) =>
    h(
      "button",
      { class: cls("btn", primary && "btn-primary"), type: "button", onclick: () => cmd(command) },
      label,
    );
  if (p.running) {
    ui.buttons.append(btn("Pause", "pomo.pause", true), btn("Skip", "pomo.skip"), btn("Abandon", "pomo.abandon"));
  } else if (p.paused) {
    ui.buttons.append(btn("Resume", "pomo.resume", true), btn("Skip", "pomo.skip"), btn("Abandon", "pomo.abandon"));
  } else if (p.pending) {
    ui.buttons.append(btn(`Start ${PHASE_LABEL[p.pending].toLowerCase()}`, "pomo.start", true), btn("Skip", "pomo.skip"));
  } else {
    ui.buttons.append(btn("Start focus", "pomo.start", true));
  }
}

function remainingNow() {
  const p = latest?.pomo;
  if (!p) return null;
  if (p.running && p.endsAt) return Math.max(0, p.endsAt - Date.now());
  if (p.paused) return p.remainingMs;
  return null;
}

function renderToday() {
  const t = latest.today;
  const approx = latest.tracking.degraded || t.degraded;
  ui.todayTotal.textContent = `${approx ? "~" : ""}${fmtDuration(t.total)}`;
  const bits = [];
  if (t.agentTotal > 0) bits.push(`agents ${fmtDuration(t.agentTotal)}`);
  if (t.pomos > 0) bits.push(`${t.pomos} pomo${t.pomos === 1 ? "" : "s"}`);
  ui.todayMeta.textContent = bits.join(" · ");
  ui.pauseBtn.textContent = latest.config.paused ? "▶ resume tracking" : "⏸ pause tracking";

  clear(ui.projects);
  const top = t.byProject.slice(0, 5);
  const max = Math.max(1, ...top.map((p) => Math.max(p.you, p.agent)));
  for (const p of top) {
    const row = h(
      "div",
      { class: cls("proj-row", p.active && "active") },
      h(
        "div",
        { class: "proj-head" },
        h("span", { class: "proj-name" }, p.name),
        h(
          "span",
          { class: "proj-time" },
          `${fmtDuration(p.you)}${p.agent > 0 ? ` · 🤖 ${fmtDuration(p.agent)}` : ""}`,
        ),
      ),
      h("div", { class: "bar" }, h("div", { class: "bar-fill", style: `width:${(p.you / max) * 100}%` })),
    );
    if (p.agent > 0) {
      row.append(
        h("div", { class: "bar" }, h("div", { class: "bar-fill agent", style: `width:${(p.agent / max) * 100}%` })),
      );
    }
    ui.projects.append(row);
  }
  if (!top.length) ui.projects.append(h("div", { class: "note" }, "No tracked time yet today."));
}

// ── settings ────────────────────────────────────────────────────────────────

function renderSettings(config) {
  clear(ui.settingsBody);
  const g = ui.settingsBody;
  const numInput = (value, min, max, onchange) =>
    h("input", { type: "number", value, min, max, onchange: (e) => onchange(Number(e.target.value)) });
  const check = (checked, onchange) =>
    h("input", { type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) });

  g.append(h("label", null, "Focus (min)"), numInput(config.pomo.focusMin, 1, 240, (v) => setConfig({ pomo: { focusMin: v } })));
  g.append(h("label", null, "Break (min)"), numInput(config.pomo.breakMin, 1, 120, (v) => setConfig({ pomo: { breakMin: v } })));
  g.append(h("label", null, "Long break (min)"), numInput(config.pomo.longBreakMin, 1, 240, (v) => setConfig({ pomo: { longBreakMin: v } })));
  g.append(h("label", null, "Long break every"), numInput(config.pomo.cadence, 1, 12, (v) => setConfig({ pomo: { cadence: v } })));
  g.append(h("label", null, "Auto-start breaks"), check(config.pomo.autoStartBreaks, (v) => setConfig({ pomo: { autoStartBreaks: v } })));
  g.append(h("label", null, "Auto-start focus"), check(config.pomo.autoStartFocus, (v) => setConfig({ pomo: { autoStartFocus: v } })));
  g.append(h("label", null, "Notifications"), check(config.pomo.notify, (v) => setConfig({ pomo: { notify: v } })));

  const modeSelect = h(
    "select",
    { onchange: (e) => setConfig({ mode: e.target.value }) },
    h("option", { value: "muxy", selected: config.mode === "muxy" || null }, "Muxy only"),
    h("option", { value: "machine", selected: config.mode === "machine" || null }, "Whole machine"),
  );
  g.append(h("label", null, "Count time in"), modeSelect);
  g.append(h("label", null, "Idle threshold (s)"), numInput(config.idleSec, 30, 3600, (v) => setConfig({ idleSec: v })));

  const fenceOn = config.workHours !== null;
  g.append(
    h("label", null, "Working hours"),
    check(fenceOn, (v) => setConfig({ workHours: v ? { start: "09:00", end: "18:00" } : null })),
  );
  if (fenceOn) {
    const start = h("input", {
      type: "time",
      value: config.workHours.start,
      onchange: (e) => setConfig({ workHours: { ...config.workHours, start: e.target.value } }),
    });
    const end = h("input", {
      type: "time",
      value: config.workHours.end,
      onchange: (e) => setConfig({ workHours: { ...config.workHours, end: e.target.value } }),
    });
    g.append(h("div", { class: "settings-span hours-row" }, start, h("span", { class: "note" }, "to"), end));
  }

  fit();
}

function setConfig(partial) {
  fire(muxy.events.emit("extension.ft.cmd", { cmd: "config.set", config: partial }));
}

async function openReport() {
  try {
    await muxy.tabs.open({
      kind: "extensionWebView",
      extension: { id: muxy.extensionID, tabType: "report", singleton: true },
    });
    muxy.popover.close().catch(() => {});
  } catch (e) {
    console.warn("focus-timer: open report failed", e?.message ?? e);
  }
}

// ── protocol ────────────────────────────────────────────────────────────────

function fire(p) {
  Promise.resolve(p).catch((e) => console.warn("focus-timer:", e?.message ?? e));
}

function cmd(name) {
  fire(muxy.events.emit("extension.ft.cmd", { cmd: name }));
}

function connect() {
  muxy.events.subscribe("extension.ft.state", (payload) => {
    latest = payload;
    render();
    maybeMirror(payload);
  });

  hello();
  setInterval(() => fire(muxy.events.emit("extension.ft.keepalive", {})), KEEPALIVE_MS);
  window.addEventListener("pagehide", () => {
    muxy.events.emit("extension.ft.bye", {}).catch(() => {});
  });

  // Local countdown tick — no event spam.
  setInterval(() => {
    if (latest?.pomo?.running) {
      const remaining = remainingNow();
      if (remaining !== null) ui.clock.textContent = fmtClock(remaining);
    }
  }, 500);

  window.addEventListener("load", fit);
}

async function hello() {
  const payload = { surface: "popover" };
  // The background can't call these — supply names, colors and live agent
  // statuses so history and the agent meter stay accurate.
  try {
    const projects = await muxy.projects.list();
    payload.ctx = { projects: {}, worktrees: {} };
    for (const p of projects) {
      payload.ctx.projects[p.id] = { name: p.name, path: p.path, iconColor: p.iconColor ?? null };
    }
    try {
      const worktrees = await muxy.worktrees.list();
      for (const w of worktrees) {
        payload.ctx.worktrees[w.id] = { name: w.name, branch: w.branch ?? null, path: w.path ?? null };
      }
    } catch {
      // worktrees disabled — fine
    }
  } catch (e) {
    console.warn("focus-timer: projects.list failed", e?.message ?? e);
  }
  try {
    payload.agents = await muxy.agents.list();
  } catch {
    payload.agents = [];
  }
  try {
    payload.mirror = await muxy.storage.get("mirror");
  } catch {
    payload.mirror = null;
  }
  try {
    await muxy.events.emit("extension.ft.hello", payload);
  } catch {
    ui.banner.hidden = false;
    ui.banner.textContent =
      "Background engine isn't running — try reloading the extension in Settings → Extensions.";
    fit();
  }
}

// Mirror fallback: when the background can't write its state file, it hands
// us the state to persist through webview storage.
function maybeMirror(payload) {
  if (!payload.mirror) return;
  const now = Date.now();
  if (now - lastMirrorWrite < MIRROR_WRITE_MIN_MS) return;
  lastMirrorWrite = now;
  fire(muxy.storage.set("mirror", payload.mirror));
}

function fit() {
  requestAnimationFrame(() => {
    muxy.popover?.resize(340, Math.min(680, document.documentElement.scrollHeight)).catch(() => {});
  });
}
