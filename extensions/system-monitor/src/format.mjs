// Formatting helpers shared by the background (status bar) and the popover.

const UNITS = ["B", "K", "M", "G", "T"];

// 6.4G / 680M / 43K — compact, 1024-based, one decimal below 10.
export function fmtBytes(bytes, { space = false, unitSuffix = "" } = {}) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const num = value >= 10 || i === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${num}${space ? " " : ""}${UNITS[i]}${unitSuffix}`;
}

// 1.2 MB/s — popover style.
export function fmtRateLong(bps) {
  if (!Number.isFinite(bps)) return "—";
  return fmtBytes(bps, { space: true, unitSuffix: bps < 1000 ? "/s" : "B/s" });
}

// 1.2M/s — status bar style.
export function fmtRate(bps) {
  if (!Number.isFinite(bps)) return "—";
  return `${fmtBytes(bps)}/s`;
}

export function fmtPct(p, digits = 0) {
  if (!Number.isFinite(p)) return "—";
  return `${p.toFixed(digits)}%`;
}

// Status bar template: tokens {cpu} {mem} {memPct} {down} {up} {batt} {load1}.
export function renderTemplate(template, snapshot) {
  const cpu = snapshot?.cpu?.usage;
  const mem = snapshot?.mem;
  const net = snapshot?.net;
  const batt = snapshot?.power?.battery;
  const tokens = {
    cpu: Number.isFinite(cpu) ? fmtPct(cpu) : "—",
    gpu: Number.isFinite(snapshot?.gpu?.usage) ? fmtPct(snapshot.gpu.usage) : "—",
    mem: mem ? fmtBytes(mem.usedB) : "—",
    memPct: mem && mem.totalB > 0 ? fmtPct((mem.usedB / mem.totalB) * 100) : "—",
    down: net && Number.isFinite(net.downBps) ? fmtRate(net.downBps) : "—",
    up: net && Number.isFinite(net.upBps) ? fmtRate(net.upBps) : "—",
    batt: batt ? fmtPct(batt.percent) : "—",
    load1: snapshot?.loadavg ? snapshot.loadavg[0].toFixed(1) : "—",
  };
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, key) => tokens[key] ?? `{${key}}`);
}

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  fastSec: 3,
  slowSec: 45,
  template: "CPU {cpu} · {mem}",
  thresholds: Object.freeze({ cpu: 90, mem: 90, disk: 92, notify: false }),
  // Popover section visibility. `power`/`gpu` additionally hide themselves
  // when the machine has no battery / publishes no GPU utilization.
  sections: Object.freeze({ cpu: true, gpu: true, mem: true, net: true, power: true, disk: true, top: true }),
});

// Merge a stored/received config over the defaults, clamping to sane ranges.
export function normalizeConfig(raw) {
  const cfg = {
    ...DEFAULT_CONFIG,
    thresholds: { ...DEFAULT_CONFIG.thresholds },
    sections: { ...DEFAULT_CONFIG.sections },
  };
  if (!raw || typeof raw !== "object") return cfg;
  const clamp = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
  cfg.fastSec = clamp(raw.fastSec, 1, 60, cfg.fastSec);
  cfg.slowSec = clamp(raw.slowSec, 15, 600, cfg.slowSec);
  if (typeof raw.template === "string" && raw.template.length <= 200 && raw.template.trim()) {
    cfg.template = raw.template;
  }
  const t = raw.thresholds;
  if (t && typeof t === "object") {
    cfg.thresholds.cpu = clamp(t.cpu, 50, 100, cfg.thresholds.cpu);
    cfg.thresholds.mem = clamp(t.mem, 50, 100, cfg.thresholds.mem);
    cfg.thresholds.disk = clamp(t.disk, 50, 100, cfg.thresholds.disk);
    cfg.thresholds.notify = t.notify === true;
  }
  const sec = raw.sections;
  if (sec && typeof sec === "object") {
    for (const key of Object.keys(cfg.sections)) {
      if (sec[key] === false) cfg.sections[key] = false;
    }
  }
  return cfg;
}
