import { h, clear } from "@/lib/dom";
import { drawSpark } from "./spark.mjs";
import { fmtBytes, fmtRateLong, fmtPct, DEFAULT_CONFIG } from "@/format.mjs";
import "./style.css";

const KEEPALIVE_MS = 10_000;
const PROCS_COLLAPSED = 8;
// The background host has no muxy.storage, so the once-a-minute snapshot that
// gives a cold-opened popover something to show is written from here instead.
const ROLLUP_SAVE_MS = 60_000;

const ui = {}; // element refs filled by build()
let sections = { ...DEFAULT_CONFIG.sections };
let history = { cpu: [], down: [], up: [] };
let snapshot = null;
let status = null;
let procs = [];
let procsExpanded = false;
let onboarding = false; // first-run note, shown until storage records it
let lastRollupAt = 0;

const root = document.getElementById("root");
build();
connect();

// ── layout ──────────────────────────────────────────────────────────────────

function build() {
  ui.banner = h("div", { class: "banner", hidden: true });

  ui.cpuValue = h("span", { class: "value" }, "—");
  ui.cpuLoad = h("span", { class: "detail" }, "load —");
  ui.cpuSpark = h("canvas", { class: "spark" });
  const cpu = section("CPU", h("div", { class: "row row-spread" }, ui.cpuValue, ui.cpuLoad), ui.cpuSpark);

  ui.gpuValue = h("span", { class: "value" }, "—");
  ui.gpuSpark = h("canvas", { class: "spark" });
  const gpu = section("GPU", h("div", { class: "row" }, ui.gpuValue), ui.gpuSpark);
  gpu.hidden = true;

  ui.memValue = h("span", { class: "value" }, "—");
  ui.memBreak = h("span", { class: "detail" }, "");
  ui.memFill = h("div", { class: "meter-fill", style: "width:0%" });
  ui.memSwap = h("div", { class: "note", hidden: true });
  const mem = section(
    "MEM",
    h("div", { class: "row row-spread" }, ui.memValue, ui.memBreak),
    h("div", { class: "meter" }, ui.memFill),
    ui.memSwap,
  );

  ui.netValue = h("span", { class: "value" }, "↓ — ↑ —");
  ui.netSpark = h("canvas", { class: "spark" });
  const net = section("NET", h("div", { class: "row" }, ui.netValue), ui.netSpark);

  ui.pwrValue = h("span", { class: "value" }, "—");
  ui.pwrDetail = h("span", { class: "detail" }, "");
  const power = section("PWR", h("div", { class: "row row-spread" }, ui.pwrValue, ui.pwrDetail));
  power.hidden = true;

  ui.diskValue = h("span", { class: "value" }, "—");
  ui.diskDetail = h("span", { class: "detail" }, "/");
  ui.diskFill = h("div", { class: "meter-fill", style: "width:0%" });
  const disk = section(
    "DISK",
    h("div", { class: "row row-spread" }, ui.diskValue, ui.diskDetail),
    h("div", { class: "meter" }, ui.diskFill),
  );

  ui.procsRows = h("div", { class: "procs" });
  ui.procsMore = h(
    "button",
    { class: "toggle", type: "button", onclick: toggleProcs, hidden: true },
    h("span", { class: "chevron" }, "⌄"),
    "more",
  );
  const top = section("Top processes", procsHeader(), ui.procsRows, ui.procsMore);

  const settings = section(
    null,
    h("button", { class: "toggle", type: "button", onclick: openSettings }, "⚙ settings…"),
  );

  ui.sections = { cpu, gpu, mem, net, power, disk, top };
  root.append(ui.banner, cpu, gpu, mem, net, power, disk, top, settings);
}

function section(label, ...children) {
  return h("div", { class: "section" }, label ? h("div", { class: "label" }, label) : null, ...children);
}

function procsHeader() {
  return h(
    "div",
    { class: "procs-head" },
    h("span", null, ""),
    h("span", { class: "proc-num" }, "cpu"),
    h("span", { class: "proc-num" }, "mem"),
  );
}

// ── rendering ───────────────────────────────────────────────────────────────

function render() {
  renderBanner();
  const s = snapshot ?? {};

  ui.cpuValue.textContent = Number.isFinite(s.cpu?.usage) ? fmtPct(s.cpu.usage, 1) : "—";
  ui.cpuValue.classList.toggle("warn", Boolean(status?.warn?.cpu));
  ui.cpuLoad.textContent = s.loadavg ? `load ${s.loadavg.map((n) => n.toFixed(1)).join(" ")}` : "load —";
  drawSpark(ui.cpuSpark, history.cpu, { max: 100 });

  if (Number.isFinite(s.gpu?.usage)) ui.gpuValue.textContent = fmtPct(s.gpu.usage, 1);
  drawSpark(ui.gpuSpark, history.gpu ?? [], { max: 100 });

  if (s.mem) {
    const pct = s.mem.totalB > 0 ? (s.mem.usedB / s.mem.totalB) * 100 : 0;
    ui.memValue.textContent = `${fmtBytes(s.mem.usedB)} / ${fmtBytes(s.mem.totalB)}`;
    ui.memValue.classList.toggle("warn", Boolean(status?.warn?.mem));
    ui.memBreak.textContent = `app ${fmtBytes(s.mem.appB)} wired ${fmtBytes(s.mem.wiredB)} cmpr ${fmtBytes(s.mem.compressedB)}`;
    ui.memFill.style.width = `${Math.min(100, pct).toFixed(1)}%`;
    ui.memFill.classList.toggle("warn-fill", Boolean(status?.warn?.mem));
    const hasSwap = s.swap && s.swap.usedB > 0;
    ui.memSwap.hidden = !hasSwap;
    if (hasSwap) ui.memSwap.textContent = `swap ${fmtBytes(s.swap.usedB)} of ${fmtBytes(s.swap.totalB)}`;
  }

  ui.netValue.textContent = s.net
    ? `↓ ${fmtRateLong(s.net.downBps)}   ↑ ${fmtRateLong(s.net.upBps)}`
    : "↓ —   ↑ —";
  drawSpark(ui.netSpark, history.down);

  const batt = s.power?.battery;
  if (batt) {
    ui.pwrValue.textContent = `🔋 ${fmtPct(batt.percent)}`;
    const bits = [batt.state];
    if (batt.remaining) bits.push(`${batt.remaining} left`);
    ui.pwrDetail.textContent = bits.join(" · ");
  }

  if (s.disk) {
    ui.diskValue.textContent = `${fmtBytes(s.disk.usedB)} / ${fmtBytes(s.disk.sizeB)}`;
    ui.diskValue.classList.toggle("warn", Boolean(status?.warn?.disk));
    ui.diskDetail.textContent = `/ · ${fmtPct(s.disk.pct)}`;
    ui.diskFill.style.width = `${Math.min(100, s.disk.pct).toFixed(1)}%`;
    ui.diskFill.classList.toggle("warn-fill", Boolean(status?.warn?.disk));
  }

  applySections();
}

// Config-driven visibility; gpu/power additionally require the machine to
// have the data at all.
function applySections() {
  const s = snapshot ?? {};
  const visible = {
    ...sections,
    gpu: sections.gpu && (Number.isFinite(s.gpu?.usage) || (history.gpu?.length ?? 0) > 0),
    power: sections.power && Boolean(s.power?.battery),
  };
  let changed = false;
  for (const [key, el] of Object.entries(ui.sections)) {
    const hidden = !visible[key];
    if (el.hidden !== hidden) {
      el.hidden = hidden;
      changed = true;
    }
  }
  if (changed) fit();
}

function renderBanner() {
  let text = null;
  if (onboarding) {
    text = "System Monitor runs three read-only commands (top, vm_stat, ps). Approve the prompts to start.";
  } else if (status?.paused) {
    text = "Paused — the active workspace is remote. Stats resume when a local workspace is active.";
  } else if (status && Object.values(status.denied ?? {}).some(Boolean)) {
    text = "Consent denied for a snapshot command — review it in Settings → Extensions → Permissions.";
  } else if (snapshot?.stale) {
    text = "Waiting for the first sample…";
  }
  ui.banner.hidden = !text;
  if (text) ui.banner.textContent = text;
}

function renderProcs(payload) {
  procs = payload.procs ?? [];
  clear(ui.procsRows);
  if (payload.denied) {
    ui.procsRows.append(h("div", { class: "note" }, "Process list denied — review in Settings → Extensions → Permissions."));
    ui.procsMore.hidden = true;
    fit();
    return;
  }
  const shown = procsExpanded ? procs : procs.slice(0, PROCS_COLLAPSED);
  for (const p of shown) {
    ui.procsRows.append(
      h(
        "div",
        { class: "proc-row" },
        h("span", { class: "proc-name", title: String(p.pid) }, p.name),
        h("span", { class: "proc-num" }, fmtPct(p.cpu, 1)),
        h("span", { class: "proc-num" }, fmtBytes(p.rssB)),
      ),
    );
  }
  if (!shown.length) ui.procsRows.append(h("div", { class: "note" }, "—"));
  ui.procsMore.hidden = procs.length <= PROCS_COLLAPSED;
  ui.procsMore.lastChild.textContent = procsExpanded ? "less" : "more";
  ui.procsMore.firstChild.classList.toggle("open", procsExpanded);
  fit();
}

function toggleProcs() {
  procsExpanded = !procsExpanded;
  renderProcs({ procs });
}

// ── settings ────────────────────────────────────────────────────────────────

// Settings live in a webview modal (their own popup); opening it dismisses
// this popover, and the modal saves + notifies the background itself.
function openSettings() {
  muxy.modal.openWebview({ entry: "modal/settings.html", width: 460, height: 500 }).catch((error) => {
    console.warn("system-monitor: settings modal failed to open", error);
  });
}

// ── protocol ────────────────────────────────────────────────────────────────

function connect() {
  muxy.events.subscribe("extension.mon.state", (payload) => {
    sections = { ...sections, ...(payload.config?.sections ?? {}) };
    history = payload.history ?? history;
    snapshot = payload.snapshot;
    status = payload.status;
    render();
    fit();
  });

  muxy.events.subscribe("extension.mon.tick", (payload) => {
    snapshot = payload.snapshot;
    status = payload.status;
    if (Number.isFinite(snapshot?.cpu?.usage)) pushLocal(history.cpu, snapshot.cpu.usage);
    if (Number.isFinite(snapshot?.gpu?.usage)) pushLocal((history.gpu ??= []), snapshot.gpu.usage);
    if (snapshot?.net) {
      pushLocal(history.down, snapshot.net.downBps);
      pushLocal(history.up, snapshot.net.upBps);
    }
    // Once real samples arrive the prompts have been approved, so step aside
    // and let the banner show paused/denied/stale states again.
    if (onboarding && snapshot && !snapshot.stale) onboarding = false;
    saveRollup();
    render();
  });

  muxy.events.subscribe("extension.mon.procsResult", renderProcs);

  hello();
  setInterval(() => muxy.events.emit("extension.mon.keepalive", {}).catch(() => {}), KEEPALIVE_MS);
  window.addEventListener("pagehide", () => {
    muxy.events.emit("extension.mon.bye", {}).catch(() => {});
  });

  muxy.onThemeChange?.(() => {
    drawSpark(ui.cpuSpark, history.cpu, { max: 100 });
    drawSpark(ui.gpuSpark, history.gpu ?? [], { max: 100 });
    drawSpark(ui.netSpark, history.down);
  });

  window.addEventListener("load", fit);
}

// Persist the latest snapshot at most once a minute, so the next cold open has
// something to render before the first tick arrives.
function saveRollup() {
  if (!snapshot) return;
  const now = Date.now();
  if (now - lastRollupAt < ROLLUP_SAVE_MS) return;
  lastRollupAt = now;
  muxy.storage.set("lastRollup", snapshot).catch(() => {
    // not fatal — the popover just starts empty next time
  });
}

// Show the cached snapshot immediately on a cold open, marked stale so the
// banner explains itself until the first live tick replaces it.
async function hydrateRollup() {
  if (snapshot) return; // a tick already beat us to it
  try {
    const rollup = await muxy.storage.get("lastRollup");
    if (rollup && typeof rollup === "object" && !snapshot) {
      snapshot = { ...rollup, stale: true };
      render();
    }
  } catch {
    // no cached snapshot — the first tick fills it in
  }
}

// The first-run note lives here rather than in background.js: it needs
// once-ever semantics, and only webviews have working storage.
async function checkOnboarding() {
  try {
    if ((await muxy.storage.get("onboarded")) === true) return;
    onboarding = true;
    render();
    await muxy.storage.set("onboarded", true);
  } catch {
    // storage unreadable — skip the note rather than repeat it every open
  }
}

async function hello() {
  // Include the stored config: the background host has no working
  // muxy.storage, so after a reload it only learns the config from us.
  let config = null;
  try {
    config = await muxy.storage.get("config");
  } catch {
    // storage unreadable here too — background keeps whatever it has
  }
  checkOnboarding();
  hydrateRollup();
  if (config?.sections) {
    // Apply visibility immediately instead of waiting for the round-trip.
    sections = { ...sections, ...config.sections };
    render();
  }
  try {
    await muxy.events.emit("extension.mon.hello", { config });
  } catch {
    ui.banner.hidden = false;
    ui.banner.textContent = "Background monitor isn't running — try reloading the extension in Settings → Extensions.";
    fit();
  }
}

function pushLocal(arr, value) {
  arr.push(value);
  if (arr.length > 120) arr.splice(0, arr.length - 120);
}

function fit() {
  requestAnimationFrame(() => {
    muxy.popover?.resize(340, Math.min(700, document.documentElement.scrollHeight)).catch(() => {});
  });
}
