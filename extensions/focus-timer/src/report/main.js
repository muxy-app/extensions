// focus-timer report tab — day/week/month views over the background's day
// rollups, the you-vs-agents chart, the project table with worktree
// drill-down, pomodoro history, and CSV export.

import { h, clear, cls } from "@/lib/dom.js";
import { dayKey, addDays, fmtDuration } from "@/shared/format.js";
import { drawBars, colorForProject } from "./charts.js";
import "./style.css";

const KEEPALIVE_MS = 10_000;

const ui = {};
let range = "week"; // 'day' | 'week' | 'month'
let anchor = dayKey(Date.now());
let report = null; // last extension.ft.report payload
let showAgent = true;
let expanded = new Set(); // projectIDs with open worktree rows
let queryPending = 0;

const root = document.getElementById("root");
build();
connect();

// ── range math ──────────────────────────────────────────────────────────────

function rangeBounds() {
  if (range === "day") return { from: anchor, to: anchor };
  if (range === "week") {
    const [y, m, d] = anchor.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 6) % 7; // Monday-start
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 6) };
  }
  const [y, m] = anchor.split("-").map(Number);
  const from = `${anchor.slice(0, 7)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  return { from, to: `${anchor.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

function shiftAnchor(direction) {
  if (range === "day") anchor = addDays(anchor, direction);
  else if (range === "week") anchor = addDays(anchor, 7 * direction);
  else {
    const [y, m] = anchor.split("-").map(Number);
    const date = new Date(y, m - 1 + direction, 1);
    anchor = dayKey(date.getTime());
  }
  query();
}

function rangeLabel() {
  const { from, to } = rangeBounds();
  if (range === "day") return from;
  if (range === "month") return from.slice(0, 7);
  return `${from} → ${to}`;
}

// ── layout ──────────────────────────────────────────────────────────────────

function build() {
  ui.rangeLabel = h("span", { class: "range-label" }, rangeLabel());
  ui.segButtons = {};
  const seg = h(
    "div",
    { class: "seg" },
    ...["day", "week", "month"].map((r) =>
      (ui.segButtons[r] = h(
        "button",
        { type: "button", class: cls(r === range && "on"), onclick: () => setRange(r) },
        r[0].toUpperCase() + r.slice(1),
      )),
    ),
  );

  const topbar = h(
    "header",
    { class: "topbar" },
    h("span", { class: "title" }, "Time Report"),
    seg,
    h("button", { class: "iconbtn", type: "button", onclick: () => shiftAnchor(-1), title: "Previous" }, "‹"),
    ui.rangeLabel,
    h("button", { class: "iconbtn", type: "button", onclick: () => shiftAnchor(1), title: "Next" }, "›"),
    h("button", { class: "btn", type: "button", onclick: goToday }, "Today"),
    h("span", { class: "spacer" }),
    h("button", { class: "btn", type: "button", onclick: copyCSV }, "Copy CSV"),
  );

  ui.banner = h("div", { class: "note", hidden: true });
  ui.canvas = h("canvas", { class: "chart" });
  ui.legend = h("div", { class: "legend" });
  const chartCard = h("div", { class: "card" }, h("div", { class: "card-title" }, "Focused time — you vs. agents"), ui.canvas, ui.legend);

  ui.tableBody = h("tbody");
  const tableCard = h(
    "div",
    { class: "card" },
    h("div", { class: "card-title" }, "Projects"),
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h("tr", null, h("th", null, "Project"), h("th", null, "You"), h("th", null, "Agents"), h("th", null, "Pomos")),
      ),
      ui.tableBody,
    ),
  );

  ui.pomoStrip = h("div", { class: "pomo-strip" });
  const pomoCard = h("div", { class: "card" }, h("div", { class: "card-title" }, "Pomodoro sessions"), ui.pomoStrip);

  ui.footnote = h("div", { class: "note", hidden: true });

  const footer = h(
    "div",
    { class: "report-footer" },
    h("button", { class: "btn-quiet", type: "button", onclick: clearHistory }, "Delete all history…"),
  );

  const content = h("div", { class: "content" }, ui.banner, chartCard, tableCard, pomoCard, ui.footnote, footer);
  root.append(topbar, content);
}

function setRange(r) {
  range = r;
  for (const [key, btn] of Object.entries(ui.segButtons)) btn.classList.toggle("on", key === r);
  query();
}

function goToday() {
  anchor = dayKey(Date.now());
  query();
}

// ── data ────────────────────────────────────────────────────────────────────

function query() {
  ui.rangeLabel.textContent = rangeLabel();
  const { from, to } = rangeBounds();
  const stamp = ++queryPending;
  fire(muxy.events.emit("extension.ft.query", { from, to, stamp }));
}

function projectTotals() {
  const totals = new Map(); // projectID → { you, agent, pomos, worktrees: Map }
  if (!report) return totals;
  for (const day of Object.values(report.days ?? {})) {
    for (const [projectID, p] of Object.entries(day.projects ?? {})) {
      const t = totals.get(projectID) ?? { you: 0, agent: 0, pomos: 0, worktrees: new Map() };
      t.you += p.you ?? 0;
      t.agent += p.agent ?? 0;
      t.pomos += p.pomos ?? 0;
      totals.set(projectID, t);
    }
    for (const [worktreeID, w] of Object.entries(day.worktrees ?? {})) {
      const projectID = report.ctx?.worktrees?.[worktreeID]?.projectID;
      if (!projectID || !totals.has(projectID)) continue;
      const t = totals.get(projectID);
      const wt = t.worktrees.get(worktreeID) ?? { you: 0, agent: 0 };
      wt.you += w.you ?? 0;
      wt.agent += w.agent ?? 0;
      t.worktrees.set(worktreeID, wt);
    }
  }
  return totals;
}

function projectName(projectID) {
  return report?.ctx?.projects?.[projectID]?.name ?? projectID.slice(0, 8);
}

function worktreeName(worktreeID) {
  const wt = report?.ctx?.worktrees?.[worktreeID];
  if (!wt) return worktreeID.slice(0, 8);
  const branch = wt.branch ? ` (${wt.branch})` : "";
  return `${wt.name ?? worktreeID.slice(0, 8)}${branch}`;
}

// ── rendering ───────────────────────────────────────────────────────────────

function render() {
  if (!report) return;

  const degradedDays = Object.values(report.days ?? {}).filter((d) => d.degraded).length;
  ui.banner.hidden = !report.tracking?.degraded;
  if (report.tracking?.degraded) {
    ui.banner.textContent = report.tracking.probeDenied
      ? "Idle probe denied — current tracking is event-only and approximate."
      : "Idle detection currently unavailable — tracking is event-only and approximate.";
  }
  ui.footnote.hidden = degradedDays === 0;
  if (degradedDays > 0) {
    ui.footnote.textContent = `· Dotted days were tracked without idle detection (approximate, event-only).`;
  }

  renderChart();
  renderTable();
  renderPomos();
}

function orderedProjects() {
  return [...projectTotals().entries()].sort((a, b) => b[1].you - a[1].you);
}

function renderChart() {
  const { from, to } = rangeBounds();
  const projects = orderedProjects();
  const colorIndex = new Map(projects.map(([id], i) => [id, i]));

  const bars = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const data = report.days?.[day];
    const parts = [];
    let agent = 0;
    if (data) {
      for (const [projectID, p] of Object.entries(data.projects ?? {})) {
        parts.push({
          projectID,
          color: colorForProject(projectID, report.ctx, colorIndex.get(projectID) ?? 0),
          value: p.you ?? 0,
        });
        agent += p.agent ?? 0;
      }
      parts.sort((a, b) => (colorIndex.get(a.projectID) ?? 0) - (colorIndex.get(b.projectID) ?? 0));
    }
    bars.push({ day, label: day.slice(8), parts, agent, degraded: data?.degraded === true });
  }
  drawBars(ui.canvas, bars, { showAgent });

  clear(ui.legend);
  projects.slice(0, 10).forEach(([projectID], i) => {
    ui.legend.append(
      h(
        "span",
        { class: "chip" },
        h("span", {
          class: "swatch",
          style: `background:${colorForProject(projectID, report.ctx, i)}`,
        }),
        projectName(projectID),
      ),
    );
  });
  ui.legend.append(
    h(
      "button",
      { type: "button", class: cls("chip", !showAgent && "off"), onclick: toggleAgent },
      h("span", { class: "swatch", style: "background: color-mix(in srgb, currentColor 35%, transparent)" }),
      "agents",
    ),
  );
}

function toggleAgent() {
  showAgent = !showAgent;
  renderChart();
}

function renderTable() {
  clear(ui.tableBody);
  const projects = orderedProjects();
  if (!projects.length) {
    ui.tableBody.append(
      h("tr", null, h("td", { class: "name", colspan: 4 }, h("span", { class: "note" }, "No tracked time in this range."))),
    );
    return;
  }
  for (const [projectID, t] of projects) {
    const isOpen = expanded.has(projectID);
    const hasWorktrees = t.worktrees.size > 0;
    ui.tableBody.append(
      h(
        "tr",
        {
          class: "project-row",
          onclick: () => {
            if (!hasWorktrees) return;
            if (isOpen) expanded.delete(projectID);
            else expanded.add(projectID);
            renderTable();
          },
        },
        h(
          "td",
          { class: "name" },
          h("span", { class: "disclose" }, hasWorktrees ? (isOpen ? "▾" : "▸") : ""),
          projectName(projectID),
        ),
        h("td", null, fmtDuration(t.you)),
        h("td", null, t.agent > 0 ? fmtDuration(t.agent) : "—"),
        h("td", null, t.pomos > 0 ? String(t.pomos) : "—"),
      ),
    );
    if (isOpen) {
      const rows = [...t.worktrees.entries()].sort((a, b) => b[1].you - a[1].you);
      for (const [worktreeID, wt] of rows) {
        ui.tableBody.append(
          h(
            "tr",
            { class: "worktree-row" },
            h("td", { class: "name" }, worktreeName(worktreeID)),
            h("td", null, fmtDuration(wt.you)),
            h("td", null, wt.agent > 0 ? fmtDuration(wt.agent) : "—"),
            h("td", null, ""),
          ),
        );
      }
    }
  }
}

function renderPomos() {
  clear(ui.pomoStrip);
  const { from, to } = rangeBounds();
  let total = 0;
  const perDay = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const data = report.days?.[day];
    let pomos = 0;
    for (const p of Object.values(data?.projects ?? {})) pomos += p.pomos ?? 0;
    total += pomos;
    perDay.push({ day, pomos });
  }
  const inRange = (report.pomoLog ?? []).filter((e) => {
    const day = dayKey(e.startedAt);
    return day >= from && day <= to;
  });
  const completed = inRange.filter((e) => e.completed).length;
  const rate = inRange.length ? Math.round((completed / inRange.length) * 100) : null;

  ui.pomoStrip.append(h("span", null, `${total} completed`));
  if (rate !== null) ui.pomoStrip.append(h("span", null, `${rate}% completion rate (${completed}/${inRange.length} started)`));
  if (range !== "day") {
    const best = perDay.reduce((a, b) => (b.pomos > a.pomos ? b : a), perDay[0]);
    if (best && best.pomos > 0) ui.pomoStrip.append(h("span", null, `best day ${best.day} (${best.pomos})`));
  }
}

async function clearHistory() {
  const choice = await muxy.dialog.confirm({
    title: "Delete all Focus Timer history?",
    message: "All tracked time and pomodoro history on this Mac will be erased. This cannot be undone.",
    buttons: ["Delete", "Cancel"],
    cancel: "Cancel",
    style: "warning",
  });
  if (choice !== "Delete") return;
  fire(muxy.events.emit("extension.ft.cmd", { cmd: "data.clear" }));
  // Events are delivered in order, so this re-query lands after the clear.
  query();
}

// ── CSV export ──────────────────────────────────────────────────────────────

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function copyCSV() {
  if (!report) return;
  const { from, to } = rangeBounds();
  const lines = ["day,project,worktree,you_seconds,agent_seconds,pomos"];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const data = report.days?.[day];
    if (!data) continue;
    for (const [projectID, p] of Object.entries(data.projects ?? {})) {
      lines.push(
        [day, csvEscape(projectName(projectID)), "", Math.round(p.you ?? 0), Math.round(p.agent ?? 0), p.pomos ?? 0].join(","),
      );
    }
    for (const [worktreeID, w] of Object.entries(data.worktrees ?? {})) {
      const projectID = report.ctx?.worktrees?.[worktreeID]?.projectID ?? "";
      lines.push(
        [
          day,
          csvEscape(projectID ? projectName(projectID) : ""),
          csvEscape(worktreeName(worktreeID)),
          Math.round(w.you ?? 0),
          Math.round(w.agent ?? 0),
          "",
        ].join(","),
      );
    }
  }
  const csv = lines.join("\n");
  try {
    await navigator.clipboard.writeText(csv);
  } catch {
    const ta = h("textarea", null, csv);
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  fire(muxy.toast({ title: "Focus Timer", body: `CSV for ${rangeLabel()} copied (${lines.length - 1} rows).` }));
}

// ── protocol ────────────────────────────────────────────────────────────────

function fire(p) {
  Promise.resolve(p).catch((e) => console.warn("focus-timer:", e?.message ?? e));
}

let refreshTimer = null;

function connect() {
  muxy.events.subscribe("extension.ft.report", (payload) => {
    // Ignore replies for a range we've since navigated away from.
    const { from, to } = rangeBounds();
    if (payload.from !== from || payload.to !== to) return;
    report = payload;
    render();
  });

  // Live refresh: background state changes re-query the visible range,
  // throttled, only when it includes today.
  muxy.events.subscribe("extension.ft.state", () => {
    const { from, to } = rangeBounds();
    const today = dayKey(Date.now());
    if (today < from || today > to || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      query();
    }, 5000);
  });

  hello();
  query();
  setInterval(() => fire(muxy.events.emit("extension.ft.keepalive", {})), KEEPALIVE_MS);
  window.addEventListener("pagehide", () => {
    muxy.events.emit("extension.ft.bye", {}).catch(() => {});
  });
  window.addEventListener("resize", () => report && renderChart());
  muxy.onThemeChange?.(() => report && renderChart());
}

async function hello() {
  const payload = { surface: "report" };
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
  fire(muxy.events.emit("extension.ft.hello", payload));
}
