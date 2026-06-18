import { el, clear } from "./dom.js";
import { killModalView } from "./kill-modal.js";
import { SORT_OPTIONS, DEFAULT_SORT, filterSessions, sortSessions } from "../sessions.js";

const REFRESH_OPTIONS = [
  { value: 10, label: "Every 10s" },
  { value: 30, label: "Every 30s" },
  { value: 60, label: "Every 1m" },
  { value: 300, label: "Every 5m" },
];

export function dashboardView({
  server,
  initialSort,
  initialRefreshSec,
  onStopRequested,
  onSortChange,
  onRefreshIntervalChange,
}) {
  const statsRow = el("div", { class: "stats-row" }, "Loading…");
  const list = el("ul", { class: "sessions" });
  const errBanner = el("div", { class: "error-banner", style: { display: "none" } });
  const modalHost = el("div");

  let lastSessions = [];
  let currentSort = SORT_OPTIONS.find((o) => o.value === initialSort) ? initialSort : DEFAULT_SORT;
  let currentSearch = "";

  const searchInput = el("input", {
    type: "search",
    class: "search",
    placeholder: "Search title, user, or device",
    "aria-label": "Filter sessions",
    title: "Filter sessions by title, user, or device",
    onInput: (e) => {
      currentSearch = e.target.value;
      renderList();
    },
  });

  const sortSelect = el(
    "select",
    {
      class: "sort",
      "aria-label": "Sort sessions",
      title: "Sort sessions",
      onChange: (e) => {
        currentSort = e.target.value;
        renderList();
        if (onSortChange) onSortChange(currentSort);
      },
    },
    SORT_OPTIONS.map((opt) =>
      el("option", { value: opt.value, selected: opt.value === currentSort }, opt.label),
    ),
  );

  const currentRefresh = REFRESH_OPTIONS.find((o) => o.value === initialRefreshSec)
    ? initialRefreshSec
    : 5;
  const refreshSelect = el(
    "select",
    {
      class: "refresh",
      "aria-label": "Refresh interval",
      title: "How often to refresh sessions",
      onChange: (e) => {
        const next = Number(e.target.value);
        if (onRefreshIntervalChange) onRefreshIntervalChange(next);
      },
    },
    REFRESH_OPTIONS.map((opt) =>
      el("option", { value: opt.value, selected: opt.value === currentRefresh }, opt.label),
    ),
  );

  const controls = el(
    "div",
    { class: "controls" },
    el("div", { class: "controls-row" }, sortSelect, refreshSelect),
    searchInput,
  );

  function showModal(node) {
    clear(modalHost);
    modalHost.append(node);
  }
  function closeModal() {
    clear(modalHost);
  }

  function renderList() {
    const filtered = filterSessions(lastSessions, currentSearch);
    const sorted = sortSessions(filtered, currentSort);
    renderSessions(list, sorted, currentSearch, lastSessions.length, (session) => {
      const modal = killModalView({
        session,
        defaultMessage: "",
        onConfirm: async (msg) => {
          await onStopRequested(session, msg);
          closeModal();
        },
        onCancel: closeModal,
      });
      showModal(modal);
    });
  }

  const root = el(
    "section",
    { class: "view view-dashboard" },
    el(
      "header",
      null,
      el("h1", null, server.name || "Plex"),
      el("p", { class: "muted server-sub" }, `${server.platform || ""} ${server.version || ""}`.trim()),
    ),
    errBanner,
    statsRow,
    controls,
    list,
    modalHost,
  );

  function update({ stats, sessions, error }) {
    if (error) {
      errBanner.style.display = "block";
      errBanner.textContent = error;
    } else {
      errBanner.style.display = "none";
      errBanner.textContent = "";
    }
    renderStats(statsRow, stats);
    if (Array.isArray(sessions)) lastSessions = sessions;
    renderList();
  }

  return { node: root, update };
}

function renderStats(host, stats) {
  clear(host);
  if (!stats) {
    for (let i = 0; i < 6; i++) {
      host.append(statItem("—", "—"));
    }
    return;
  }
  host.append(statItem("Sessions", stats.sessionsCount));
  host.append(statItem("Direct", stats.directCount));
  host.append(statItem("Transcode", stats.transcodingCount));
  host.append(statItem("Bandwidth", formatBandwidth(stats.totalBandwidthKbps)));
  host.append(statItem("CPU", formatPct(stats.cpuPct), pctTone(stats.cpuPct)));
  host.append(statItem("RAM", formatPct(stats.ramPct), pctTone(stats.ramPct)));
}

function statItem(label, value, tone) {
  const cls = tone ? `stat stat-${tone}` : "stat";
  return el(
    "div",
    { class: cls },
    el("span", { class: "stat-label" }, label),
    el("span", { class: "stat-value" }, value == null || value === "" ? "—" : String(value)),
  );
}

function formatPct(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)}%`;
}

function pctTone(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= 85) return "danger";
  if (v >= 65) return "warn";
  return null;
}

function renderSessions(host, sessions, query, totalCount, onStop) {
  clear(host);
  if (sessions.length === 0) {
    const msg =
      totalCount === 0
        ? "Nothing is playing right now."
        : query.trim()
          ? `No sessions match "${query.trim()}".`
          : "No sessions to show.";
    host.append(el("li", { class: "empty muted" }, msg));
    return;
  }
  for (const s of sessions) {
    host.append(sessionRow(s, () => onStop(s)));
  }
}

function sessionRow(s, onStop) {
  const pct =
    s.duration > 0 ? Math.max(0, Math.min(100, Math.round((s.viewOffset / s.duration) * 100))) : 0;
  const badges = [stateBadge(s.state)];
  if (s.isTranscoding) badges.push(badge("transcode", "Transcoding"));
  if (s.location === "wan") badges.push(badge("wan", "Remote"));

  return el(
    "li",
    { class: "session" },
    el(
      "div",
      { class: "session-top" },
      el("div", { class: "session-title" }, s.title),
      el(
        "button",
        { class: "danger small", onClick: onStop, title: "Stop this stream" },
        "Stop",
      ),
    ),
    el(
      "div",
      { class: "session-meta muted" },
      `${s.user} · ${s.device}`,
      s.bitrateKbps ? ` · ${formatBandwidth(s.bitrateKbps)}` : "",
    ),
    badges.length ? el("div", { class: "badges" }, badges) : null,
    el(
      "div",
      { class: "progress" },
      el("div", { class: "bar", style: { width: `${pct}%` } }),
    ),
    el(
      "div",
      { class: "progress-meta muted" },
      `${formatTime(s.viewOffset)} / ${formatTime(s.duration)}`,
    ),
  );
}

function badge(kind, text) {
  return el("span", { class: `badge badge-${kind}` }, text);
}

const STATE_LABELS = {
  playing: "Playing",
  paused: "Paused",
  buffering: "Buffering",
  stopped: "Stopped",
};

function stateBadge(rawState) {
  const state = (rawState || "unknown").toLowerCase();
  const label = STATE_LABELS[state] || state.charAt(0).toUpperCase() + state.slice(1);
  return badge(`state-${state}`, label);
}

function formatBandwidth(kbps) {
  if (!kbps) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps} Kbps`;
}

function formatTime(ms) {
  if (!ms || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
