/* Rendering, drag & drop and menus for the Workdeck sidebar. */
const drag = { kind: null, id: null, pending: false, hoverID: null, hoverTimer: null };
const SORTS = [["manual", tr("수동")], ["name", tr("이름순")], ["nameDescending", tr("이름 역순")], ["recentlyActive", tr("최근 활동순")], ["dateAdded", tr("추가한 날짜순")]];
const WS_SORTS = [["recent", tr("최근 활동순")], ["name", tr("이름순")], ["manual", tr("기본 순서")]];
const HOME_GROUP = "__home__";
const INDENT = 6; // px per nesting level
/* Collapsed (icon rail) mode: set by main.js from the page width. Text is hidden, so names live in tooltips,
 * clicks switch project directly, and menus open as Muxy pickers (a DOM menu would be clipped by the narrow page). */
const isCompact = () => document.body.classList.contains("compact");
const pick = (placeholder, items) => muxy.modal.open({ placeholder, items });
const shortPath = (path) => { const p = norm(path).split("/"); return p.length > 2 ? `…/${p.slice(-2).join("/")}` : path; };

/* Expand/collapse indicator at the right end of a row: down arrow when open, right arrow when closed. */
function chevron(open, onclick, cls = "") {
  const c = el("span", { class: "chev-r" + (open ? " open" : "") + (cls ? " " + cls : ""), title: open ? tr("접기") : tr("펼치기"), onclick });
  c.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
  return c;
}

/* ---------- render ---------- */

/* ---------- icons ---------- */

const SVG = {
  folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/>',
  repo: '<path d="M3.5 3.5A1.5 1.5 0 0 1 5 2h7.5v9.5H5A1.5 1.5 0 0 0 3.5 13V3.5Z"/><path d="M3.5 13A1.5 1.5 0 0 0 5 14.5h7.5v-3"/><path d="M6.5 5h3.5"/>',
  issueTab: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.6"/><circle cx="8" cy="11" r=".7" fill="currentColor"/>',
  deployTab: '<path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11Z"/><path d="M2.5 5 8 7.5 13.5 5M8 7.5v6"/>',
  cleanTab: '<circle cx="4.5" cy="4.5" r="1.7"/><circle cx="4.5" cy="11.5" r="1.7"/><path d="M5.8 5.7 13 11.5M5.8 10.3 13 4.5"/>',
  noteTab: '<path d="M4 2.5h6l2.5 2.5v8.5H4Z"/><path d="M6.5 8h3.5M6.5 10.5h3.5"/>',
  boardTab: '<path d="M2.5 11a5.5 5.5 0 1 1 11 0"/><path d="M8 11 10.5 6.5"/><circle cx="8" cy="11" r="1"/>',
  worktree: '<path d="M8 14V8.6"/><path d="M8 10.6 4.8 8.4M8 8.8l3.2-2.2"/><circle cx="4.2" cy="7.3" r="1.5"/><circle cx="11.8" cy="5.3" r="1.5"/><circle cx="8" cy="3.2" r="1.5"/>',
  branch: '<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8"/><path d="M11.5 7.1c0 2.3-1.8 3-7 4"/>',
  terminal: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="m4.6 6.4 2.2 1.8-2.2 1.8"/><path d="M8.4 10h3"/>',
  globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2c2.2 1.7 2.2 10.3 0 12M8 2c-2.2 1.7-2.2 10.3 0 12"/>',
  window: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M1.8 6h12.4"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="m10.3 10.3 3.2 3.2"/>',
  folderplus: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/><path d="M8 7.2v3.6M6.2 9h3.6"/>',
  layersplus: '<path d="M7 2.4 12 5 7 7.6 2 5Z"/><path d="M2 8 7 10.6 9.2 9.5"/><path d="M2 10.9 7 13.5 9.6 12.2"/><path d="M12.6 9.3v4.2M10.5 11.4h4.2"/>',
  layers: '<path d="M8 2.2 14 5.4 8 8.6 2 5.4Z"/><path d="M2 8.2 8 11.4l6-3.2"/><path d="M2 11 8 14.2 14 11"/>',
  bot: '<rect x="3" y="5.5" width="10" height="7.5" rx="2"/><path d="M8 5.5V3.2"/><circle cx="8" cy="2.5" r=".9"/><path d="M6 9v.01M10 9v.01"/>',
  expand: '<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  eyeoff: '<path d="M1.5 8S4 3.5 8 3.5c1.2 0 2.3.4 3.2 1M14.5 8s-2.5 4.5-6.5 4.5c-1.2 0-2.3-.4-3.2-1"/><path d="M2.5 2.5l11 11"/>',
  gear: '<path d="M2 4.5h6.2M11.8 4.5H14M2 11.5h2.2M7.8 11.5H14"/><circle cx="10" cy="4.5" r="1.7"/><circle cx="6" cy="11.5" r="1.7"/>',
  server: '<rect x="2" y="2.8" width="12" height="4.2" rx="1.2"/><rect x="2" y="9" width="12" height="4.2" rx="1.2"/><path d="M4.6 4.9h.01M4.6 11.1h.01"/>',
  puzzle: '<path d="M6 3.2a1.5 1.5 0 0 1 3 0V4.5h3.2V7.7H11a1.5 1.5 0 0 0 0 3h1.2V13.8H9V12.5a1.5 1.5 0 0 0-3 0v1.3H2.8V10.6H4a1.5 1.5 0 0 0 0-3H2.8V4.5H6Z"/>',
  refresh: '<path d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3"/><path d="M13.2 2.6v2.2h-2.2"/>',
  home: '<path d="M2 7.6 8 2.5l6 5.1"/><path d="M3.6 6.6v6.4a.7.7 0 0 0 .7.7h2.6V10h2.2v3.7h2.6a.7.7 0 0 0 .7-.7V6.6"/>',
};
/* Static, trusted SVG strings only. kind picks the color (see style.css .ico.*). */
function icon(name, kind = name) {
  const span = document.createElement("span");
  span.className = "ico " + kind;
  span.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name]}</svg>`;
  return span;
}

/* ---------- render ---------- */

/* Coalesces bursts of events into one paint, skips paints when nothing visible changed, and keeps the row
 * at the top of the list where it was, so selecting something never makes the list jump. */
let renderTimer = null;
let lastSig = "";

function render() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; renderNow(); }, 16);
}

function captureAnchor(list) {
  const top = list.getBoundingClientRect().top;
  for (const n of list.querySelectorAll("[data-key]")) {
    const r = n.getBoundingClientRect();
    if (r.bottom > top + 1) return { key: n.dataset.key, off: r.top - top };
  }
  return null;
}

function restoreAnchor(list, a) {
  if (!a) return;
  const n = [...list.querySelectorAll("[data-key]")].find((x) => x.dataset.key === a.key);
  if (!n) return;
  list.scrollTop += n.getBoundingClientRect().top - list.getBoundingClientRect().top - a.off;
}

/* Texts that change all the time (terminal tab titles, agent titles) must not trigger a rebuild: replacing the
 * element under the pointer resets the cursor (arrow <-> hand flicker). They are marked data-soft and patched in place. */
function softTexts() {
  const m = {};
  for (const tabs of Object.values(data.projectTabs)) for (const t of tabs) m["tab:" + t.id] = t.title;
  for (const a of data.agents) {
    const p = data.projects.find((x) => x.id === a.projectID);
    m["agent:" + a.paneID] = data.agentTitles[a.paneID] || (p ? p.name : "?");
  }
  return m;
}

function patchSoftTexts() {
  const m = softTexts();
  document.querySelectorAll("[data-soft]").forEach((n) => {
    const v = m[n.dataset.soft];
    if (v != null && n.textContent !== v) n.textContent = v;
  });
}

/* Everything that decides what is drawn, except the soft texts above. */
function structureSignature() {
  const hard = {
    ...data,
    agentTitles: null,
    projectTabs: Object.fromEntries(Object.entries(data.projectTabs).map(([k, tabs]) => [k, tabs.map(({ title, customTitle, ...rest }) => rest)])),
  };
  return JSON.stringify([hard, state]);
}

function renderNow() {
  if (drag.kind) { drag.pending = true; return; } // re-rendering mid-drag would cancel it
  // Before: a project was open only while current unless clicked, so moving to another project folded it (and with
  // worktrees, every worktree folded). Now: a project that was current stays open, and its last active worktree keeps
  // its tabs unfolded; only a click on the row folds it. Why: switching projects should not lose the open lists.
  let remembered = false;
  for (const p of data.projects) if (isCurrent(p) && state.expanded[p.id] === undefined) { state.expanded[p.id] = true; remembered = true; }
  for (const p of data.projects) { const w = (data.worktrees[p.id] || []).find((x) => x.isActive); if (w && state.lastWt[p.id] !== w.id) { state.lastWt[p.id] = w.id; remembered = true; } }
  if (remembered) save();
  const sig = structureSignature();
  if (sig === lastSig) { patchSoftTexts(); return; } // same structure: only text changed, nothing is replaced
  lastSig = sig;
  const list = $("#list");
  const oldTop = list.scrollTop;
  const anchor = captureAnchor(list);
  list.replaceChildren(...content());
  list.scrollTop = oldTop;
  restoreAnchor(list, anchor);
  renderHome();
  renderSections();
}

function content() {
  if (data.projects.length === 0 && data.workspaces.length === 0) {
    return [el("div", { class: "empty" }, tr("프로젝트가 없어요."), el("br"), tr("위의 폴더 추가 버튼으로 저장소를 추가해 보세요."))];
  }
  return groupedLayout();
}

/* Group order in the sidebar.
 * Before: workspaces always rendered in Muxy's list order; there was no workspace sort.
 * Now: state.wsSort picks the order — "recent" (default): the most recently focused group on top,
 *      ones with no focus history keep their relative order at the bottom; "name": alphabetical;
 *      "manual": Muxy's list order (remote connections after the workspaces, in server order).
 *      미분류 stays last in every mode.
 * Why: the owner asked for a recent-activity workspace sort as the default.
 * Affects: group order only; project order inside a group still follows Muxy's project sort. */
function sortedGroups() {
  const mode = state.wsSort || "recent";
  const list = [...data.workspaces.map((w) => ({ id: w.id, name: w.name, ws: w, members: projectsIn(w.id) })), ...remoteGroups()];
  if (mode === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  else if (mode === "recent") list.sort((a, b) => groupActivity(b.members) - groupActivity(a.members));
  return list;
}

/* Remote connections as groups.
 * Before: the projects of a remote server were listed in 미분류 next to the local ones, with nothing to tell them apart.
 * Now: every configured server that has projects here gets a group named after the connection, holding that server's
 *      projects (its Home included, which used to be pinned on top as a second Home). The group exists in this
 *      sidebar only: Muxy refuses to attach an SSH project to a workspace, so nothing is created or moved in Muxy.
 * Why: the owner asked for remote projects to be grouped under their connection name automatically.
 * Affects: where remote projects are drawn. Their rows cannot be dragged into another group and offer no "그룹 이동",
 *          because Muxy would refuse the move. Local workspaces are untouched. */
function remoteGroups() {
  return data.servers
    .map((srv) => ({ id: "srv:" + srv.id, name: srv.name, server: srv, members: data.projects.filter((p) => serverOf(p) === srv.id && !isHome(p)) }))
    .filter((g) => g.members.length);
}

/* Every Muxy workspace is a group, then each remote connection; projects in none of them go to 미분류. While searching,
 * only matching projects are listed (a group whose name matches keeps all of its projects) and folded groups stay open. */
function groupedLayout() {
  const out = [];
  const q = normQuery();
  if (!data.membersOK) {
    out.push(el(
      "div", { class: "notice" },
      el("span", {}, tr("워크스페이스 소속을 읽지 못해서 그룹 없이 보여요. Muxy의 승인 창에서 허용한 뒤 다시 읽어 주세요.")),
      el("button", { class: "notice-btn", onclick: () => refreshMembers() }, tr("다시 읽기"))
    ));
  }
  for (const g of sortedGroups()) {
    const members = q && !g.name.toLowerCase().includes(q) ? g.members.filter(matchesQuery) : g.members;
    if (q && !members.length) continue;
    out.push(groupBox(g.id, g.name, members, g.ws, g.server));
  }
  const loose = data.projects.filter((p) => !groupOf(p.id) && !isHome(p) && !isRemote(p) && matchesQuery(p));
  if (loose.length || (!q && data.workspaces.length === 0 && !remoteGroups().length)) out.push(groupBox(UNGROUPED, tr("미분류"), loose));
  if (q && !out.length) out.push(el("div", { class: "empty" }, tr("\"{0}\"에 맞는 프로젝트가 없어요.", data.query.trim())));
  out.push(newZone());
  return out;
}

/* ---------- groups ---------- */

/* Context menu of a connection: the same items on its Remote row and on its group header. */
const serverMenuItems = (srv) => [
  { label: tr("연결 열기"), run: () => openServerConnection(srv) },
  { label: tr("새 터미널 열기"), run: () => createServerSession(srv) },
  { label: tr("연결 확인"), run: () => checkServer(srv) },
];

/* One group. `ws` is its Muxy workspace; `server` is set instead for a remote connection's group (remoteGroups).
 * Before: a remote connection's group looked exactly like a local workspace's.
 * Now: it carries a globe icon before its name and the name is tinted blue (CSS .group-head.remote), so the two
 *      kinds can be told apart at a glance; the icon also stays in the icon rail.
 * Why: the owner asked for remote groups to stand out from workspaces by icon or colour.
 * Affects: the group header of remote connections only. */
function groupBox(id, name, members, ws, server) {
  const collapsed = !!state.collapsed[id] && !normQuery();
  const virtual = !!server;
  const real = id !== UNGROUPED && !virtual;
  const status = server ? data.serverStatus[server.id] : null;
  const head = el(
    "div",
    {
      class: "group-head" + (virtual ? " remote" : ""),
      "data-key": "g:" + id,
      title: server ? `${name}\n${server.ssh}` : name,
      onclick: () => { state.collapsed[id] = !state.collapsed[id]; save(); render(); },
      oncontextmenu: (e) => { e.preventDefault(); if (real) groupMenu(e, id); else if (virtual) showMenu(e, serverMenuItems(server)); },
    },
    server ? icon("globe", "globe") : null,
    el("span", { class: "group-name", "data-initials": initials(name) }, name),
    // a remote connection's group shows whether that server answers in place of a workspace's "current" mark
    server ? el("span", { class: "srv " + (status || "unknown"), title: status ? SERVER_LABEL[status] : undefined }) : null,
    ws && ws.isActive ? el("span", { class: "ws-active", title: tr("현재 워크스페이스") }) : null,
    el("span", { class: "count" }, String(members.length)),
    // hover "＋": add a repository straight into this group (Muxy's own folder picker); a remote group takes none
    !virtual ? el("button", {
      class: "grp-plus",
      title: real ? tr("\"{0}\"에 저장소 추가", name) : tr("저장소 추가"),
      onclick: (e) => { e.stopPropagation(); addFolder(id); },
    }, "＋") : null,
    chevron(!collapsed, null, "grp")
  );
  const rows = el(
    "div", { class: "rows" },
    layoutRows(members).map((item) => (item.type === "folder" ? folderRow(item, id) : projectBlock(item.project, item.depth, id))),
    real && members.length === 0 && !normQuery() ? el("div", { class: "hint" }, tr("프로젝트를 여기로 드래그하거나 폴더를 추가하세요")) : null
  );
  const box = el("div", { class: "group" + (collapsed ? " collapsed" : ""), "data-group": id }, head, rows);
  // a remote group takes no drops: Muxy refuses to move any project into it
  if (virtual) return box;

  box.addEventListener("dragover", (e) => {
    if (drag.kind !== "project") return;
    e.preventDefault();
    box.classList.add("drop");
    // hovering over a collapsed group for a moment opens it so the project can be placed inside
    if (box.classList.contains("collapsed") && drag.hoverID !== id) {
      clearTimeout(drag.hoverTimer);
      drag.hoverID = id;
      drag.hoverTimer = setTimeout(() => { box.classList.remove("collapsed"); state.collapsed[id] = false; save(); }, 450);
    }
  });
  box.addEventListener("dragleave", (e) => {
    if (box.contains(e.relatedTarget)) return;
    box.classList.remove("drop");
    clearMarks();
    clearTimeout(drag.hoverTimer);
    drag.hoverID = null;
  });
  box.addEventListener("drop", (e) => {
    if (drag.kind !== "project") return;
    e.preventDefault();
    handleDrop(id, null, false);
  });
  return box;
}

/* The folder that was picked when adding, shown above the repositories found inside it. */
function folderRow(item, groupID) {
  const key = "f:" + item.root;
  const closed = !!state.collapsed[key];
  return el(
    "div",
    {
      class: "row folder",
      "data-key": "f:" + item.root,
      title: `${item.name}\n${item.root}`,
      onclick: () => { state.collapsed[key] = !closed; save(); render(); },
      oncontextmenu: (e) => { e.preventDefault(); folderMenu(e, item, groupID); },
    },
    icon("folder"),
    el("div", { class: "text" }, el("div", { class: "name" }, item.name)),
    el("span", { class: "count" }, String(item.count)),
    chevron(!closed)
  );
}

function folderMenu(e, item, groupID) {
  showMenu(e, [
    {
      label: tr("이 폴더의 저장소를 다른 그룹으로…"),
      run: async () => {
        const ids = projectsIn(groupID).filter((p) => { const m = kindMeta(p.id); return m && m.root && norm(m.root) === item.root; }).map((p) => p.id);
        const items = [...data.workspaces.filter((w) => w.id !== groupID).map((w) => ({ id: w.id, title: w.name })), { id: UNGROUPED, title: tr("미분류") }];
        const picked = await pick(tr("\"{0}\" 폴더를 옮길 그룹", item.name), items);
        if (!picked) return;
        for (const id of ids) await moveProject(id, picked.id);
      },
    },
  ]);
}

/* Shown only while dragging a project: drop here to put it in a brand-new group. */
function newZone() {
  const zone = el("div", { class: "newzone" }, tr("＋ 새 그룹으로 이동"));
  zone.addEventListener("dragover", (e) => { if (drag.kind === "project") { e.preventDefault(); zone.classList.add("drop"); } });
  zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    const id = drag.id;
    endDrag();
    const g = await createGroup();
    if (g) await moveProject(id, g.id);
  });
  return zone;
}

function groupMenu(e, id) {
  showMenu(e, [
    { label: tr("노트…"), run: () => openNotesFor({ kind: "ws", id, name: ((data.workspaces.find((x) => x.id === id) || {}).name) || "" }) },
    "-",
    { label: tr("이 그룹에 폴더 추가"), run: () => addFolder(id) },
    { label: tr("이름 변경"), run: () => renameGroup(id) },
    { label: state.collapsed[id] ? tr("펼치기") : tr("접기"), run: () => { state.collapsed[id] = !state.collapsed[id]; save(); render(); } },
    "-",
    { label: tr("그룹 삭제"), danger: true, run: () => deleteGroup(id) },
  ].filter(Boolean));
}

/* ---------- drag helpers ---------- */

function mark(node, after) {
  clearMarks();
  node.classList.add(after ? "mark-after" : "mark-before");
}
function clearMarks() {
  document.querySelectorAll(".mark-before,.mark-after").forEach((n) => n.classList.remove("mark-before", "mark-after"));
}

function startDrag(e, kind, id) {
  drag.kind = kind; drag.id = id;
  document.body.classList.add("dragging");
  e.dataTransfer.setData("text/plain", id);
  e.dataTransfer.effectAllowed = "move";
}

function endDrag() {
  clearTimeout(drag.hoverTimer);
  drag.kind = null; drag.id = null; drag.hoverID = null;
  document.body.classList.remove("dragging");
  document.querySelectorAll(".drop").forEach((n) => n.classList.remove("drop"));
  clearMarks();
  if (drag.pending) { drag.pending = false; render(); }
}

function handleDrop(groupID, refID, after) {
  const id = drag.id;
  endDrag();
  if (!id) return;
  moveProject(id, groupID ?? UNGROUPED, refID, after);
}

/* ---------- project rows ---------- */

/* Git projects get the repo icon (tinted with the project's own color when it has one), plain folders the folder icon. */
function projectIcon(p, isRepo) {
  if (isHome(p)) return icon("home");
  const ic = icon(isRepo ? "repo" : "folder");
  if (isRepo && p.iconColor && p.iconColor.toLowerCase() !== "#808080") ic.style.color = p.iconColor;
  return ic;
}

/* An item with an active agent shows it by blinking its own icon (working: blue, waiting for input: orange, faster). */
function blinkIcon(ic, status) {
  if (status === "working" || status === "waiting") {
    ic.classList.add("blink", status);
    ic.title = { working: tr("agent 작업 중"), waiting: tr("agent 입력 대기") }[status];
  }
  return ic;
}

function statusDot(status, withIdle = false) {
  const shown = status === "working" || status === "waiting" || (withIdle && status === "idle");
  const label = { working: tr("agent 작업 중"), waiting: tr("agent 입력 대기"), idle: tr("agent 대기") }[status];
  return shown ? el("span", { class: "agent " + status, title: label }) : null;
}

/* Hover "＋" at the right of a row: opens a new tab right there. */
function plusButton(run, tip = tr("새 탭")) {
  return el("button", {
    class: "row-plus",
    title: tip,
    onclick: (e) => {
      e.stopPropagation();
      Promise.resolve().then(run).then(refreshTabs).catch((err) => muxy.dialog.alert({ title: tr("새 항목을 만들지 못했어요"), message: String((err && err.message) || err) }));
    },
  }, "＋");
}

/* Clicking a project row only folds/unfolds its tab list: switching project can make Muxy open a new
 * tab, so switching happens from a tab row or the context menu instead. */
function toggleProject(p) {
  state.expanded[p.id] = !isOpen(p);
  save();
  render();
  schedule("tabs", refreshTabs, 0);
}

/* A new tab in this project. Switching to a project that has no tab may already open one, so only add
 * another when the project still has none after the switch, or had some before. */
async function newTabIn(p) {
  const before = (await muxy.tabs.list({ project: p.id })).length;
  if (!isCurrent(p)) await muxy.projects.switchTo(p.id);
  const now = (await muxy.tabs.list()).length;
  if (before > 0 || now === 0) await muxy.tabs.new();
}

/* One project row.
 * Before: a remote server's project row looked exactly like a local one once its group was unfolded.
 * Now: a remote row carries a small globe mark next to its project icon, its name is tinted a lighter blue than the
 *      group header, and its tooltip names the server. The mark is hidden in the icon rail, where each row shows a
 *      single icon.
 * Why: the owner could not tell remote projects from local ones inside an expanded group.
 * Affects: rows of projects that belong to a configured remote server only. */
function projectBlock(p, depth, groupID) {
  const open = isOpen(p);
  const current = isCurrent(p);
  const branch = data.branches[p.id];
  const isRepo = (data.worktrees[p.id] || []).length > 0 || !!branch;
  const server = serverOfProject(p);

  const row = el(
    "div",
    {
      class: "row" + (current ? " active" : "") + (server ? " remote" : ""),
      "data-key": "p:" + p.id,
      title: server ? `${p.name}\n${p.path}\n${server.name} · ${server.ssh}` : `${p.name}\n${p.path}`,
      onclick: () => (isCompact() ? muxy.projects.switchTo(p.id) : toggleProject(p)),
      oncontextmenu: (e) => { e.preventDefault(); projectMenu(e, p); },
    },
    blinkIcon(projectIcon(p, isRepo), agentStatus((a) => a.projectID === p.id)),
    // left of the name: the hover "＋" is absolutely positioned over the right end of the row and would cover a mark there
    server ? remoteGlobe(server) : null,
    el("div", { class: "text" }, el("div", { class: "name" }, p.name)),
    (kindMeta(p.id) || {}).kind === "submodule" ? el("span", { class: "badge" }, "submodule") : null,
    plusButton(() => newTabIn(p)),
    chevron(open)
  );
  projectDnD(row, p, groupID);

  const block = el("div", { class: "block", style: depth ? `margin-left:${depth * INDENT}px` : null }, row);
  const wts = data.worktrees[p.id] || [];
  // two or more worktrees: the tab list is grouped by worktree, each with its own ＋
  if (open) block.append(wts.length >= 2 && !isHome(p) ? worktreesBlock(p, wts) : tabsBlock(p));
  return block;
}

/* Worktrees of a project. Muxy only lists the tabs of the active worktree, so only that one unfolds its tabs;
 * clicking another worktree switches to it, and its ＋ opens a new tab there. */
/* Which worktree's tab list is shown: the active one; while another project is being viewed none is active, so the one
 * that was active last stays unfolded (primary worktree when nothing was seen yet). */
function shownWt(p, wts) {
  const active = wts.find((x) => x.isActive);
  if (active) return active.id;
  const last = wts.find((x) => x.id === state.lastWt[p.id]);
  return (last || wts.find((x) => norm(x.path) === norm(p.path)) || wts[0]).id;
}

function worktreesBlock(p, wts) {
  const box = el("div", { class: "tabs wts" });
  for (const w of wts) {
    const here = !!w.isActive;
    const label = w.branch || w.name;
    const holds = w.id === shownWt(p, wts);
    const unfolded = holds && (state.expanded["w:" + w.id] ?? true);
    const primary = norm(w.path) === norm(p.path);
    box.append(el(
      "div",
      {
        class: "tab wt" + (here ? " active" : ""),
        "data-key": "w:" + w.id,
        title: `${label}\n${w.path}`,
        onclick: async () => {
          if (holds && (here || !isCurrent(p))) { state.expanded["w:" + w.id] = !unfolded; save(); render(); return; }
          if (!isCurrent(p)) await muxy.projects.switchTo(p.id);
          await muxy.worktrees.switchTo(w.id, p.id);
        },
      },
      blinkIcon(icon("worktree", "worktree"), agentStatus((a) => a.projectID === p.id && a.worktreeID === w.id)),
      el("span", { class: "tab-title" }, label),
      el("span", { class: "badge wtbadge", title: primary ? tr("프로젝트 폴더(기본 worktree)") : tr("Git worktree (별도 폴더)") }, primary ? "primary" : "worktree"),
      el("button", {
        class: "x", title: tr("이 worktree에 새 탭"),
        onclick: (e) => {
          e.stopPropagation();
          newTabInWorktree(p, w).then(refreshTabs).catch((err) => muxy.dialog.alert({ title: tr("새 항목을 만들지 못했어요"), message: String((err && err.message) || err) }));
        },
      }, "＋")
    ));
    if (unfolded) box.append(tabsBlock(p));
  }
  return box;
}

/* A new tab in one worktree: switch to it first (a new tab opens where the user is). */
async function newTabInWorktree(p, w) {
  if (!isCurrent(p)) await muxy.projects.switchTo(p.id);
  if (!w.isActive) await muxy.worktrees.switchTo(w.id, p.id);
  await muxy.tabs.new();
}

function projectDnD(row, p, groupID) {
  if (groupID === HOME_GROUP) return; // Home stays pinned on top
  if (isRemote(p)) return; // Muxy refuses to move a remote server's project into a workspace
  row.draggable = true;
  row.addEventListener("dragstart", (e) => startDrag(e, "project", p.id));
  row.addEventListener("dragend", endDrag);
  row.addEventListener("dragover", (e) => {
    if (drag.kind !== "project" || drag.id === p.id) return;
    e.preventDefault(); e.stopPropagation();
    mark(row, e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2);
  });
  row.addEventListener("dragleave", (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove("mark-before", "mark-after"); });
  row.addEventListener("drop", (e) => {
    if (drag.kind !== "project") return;
    e.preventDefault(); e.stopPropagation();
    if (drag.id === p.id) { endDrag(); return; }
    handleDrop(groupID, p.id, e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2);
  });
}

/* ---------- tabs ---------- */

const TAB_ICON = { terminal: ["terminal", "terminal"], browser: ["globe", "globe"] };

/* Workdeck's own tabs are told apart by their title (the sidebar is not told a tab's type). */
const EXT_TAB_ICON = [
  [/^(이슈|issues)(\s|·|$)/i, ["issueTab", "exttab"]],
  [/^(배포|deploys)(\s|·|$)/i, ["deployTab", "exttab"]],
  [/^(브랜치 청소|branch cleanup)(\s|·|$)/i, ["cleanTab", "exttab"]],
  [/^(노트|notes)(\s|·|$)/i, ["noteTab", "exttab"]],
  [/^(에이전트 관제|관제|agent control room|agent board|control room)/i, ["boardTab", "exttab"]],
];
const tabIconFor = (t) => (t.kind === "extensionWebView" && (EXT_TAB_ICON.find(([re]) => re.test(t.title || "")) || [])[1]) || TAB_ICON[t.kind] || ["window", "window"];

function tabRow(t, onOpen, highlight = t.isActive) {
  return el(
    "div",
    {
      class: "tab" + (highlight ? " active" : ""),
      "data-key": "t:" + t.id,
      onclick: onOpen || (() => muxy.tabs.switchTo(t.id)),
      oncontextmenu: (e) => { e.preventDefault(); tabMenu(e, t); },
    },
    el("span", { class: "tab-bar", style: t.color ? `background:${t.color}` : null }),
    icon(...tabIconFor(t)),
    el("span", { class: "tab-title", "data-soft": "tab:" + t.id }, t.title),
    t.isPinned ? el("span", { class: "pin" }, "📌") : null,
    el("button", { class: "x", title: tr("탭 닫기"), onclick: (e) => { e.stopPropagation(); muxy.tabs.close(t.id).then(refreshTabs); } }, "×")
  );
}

function tabsBlock(p) {
  const tabs = data.projectTabs[p.id];
  const box = el("div", { class: "tabs" });
  if (!tabs) return box; // still loading
  if (!tabs.length) { box.append(el("div", { class: "hint" }, tr("열린 탭 없음"))); return box; }
  const current = isCurrent(p);
  for (const t of tabs) {
    box.append(tabRow(t, async () => {
      if (!current) await muxy.projects.switchTo(p.id);
      await muxy.tabs.switchTo(t.id);
    }, t.isActive && current));
  }
  return box;
}

function tabMenu(e, t) {
  showMenu(e, [
    { label: tr("이름 변경"), run: async () => { const n = await muxy.dialog.prompt({ title: tr("탭 이름"), placeholder: t.title }); if (n && n.trim()) await muxy.tabs.rename(t.id, n.trim()); } },
    { label: t.isPinned ? tr("고정 해제") : tr("고정"), run: () => muxy.tabs.pin(t.id, !t.isPinned) },
    { label: tr("다른 탭 닫기"), run: () => muxy.tabs.close(t.id, { scope: "others" }) },
    "-",
    { label: tr("탭 닫기"), danger: true, run: () => muxy.tabs.close(t.id) },
  ]);
}

/* ---------- menus ---------- */

function showMenu(e, items) {
  if (isCompact()) { compactMenu(items); return; }
  const menu = $("#menu");
  menu.replaceChildren(
    ...items.map((it) =>
      it === "-"
        ? el("hr")
        : it.header
        ? el("div", { class: "menu-head" }, it.header)
        : el("button", {
            class: it.danger ? "danger" : "",
            disabled: !!it.disabled,
            onclick: () => {
              hideMenu();
              Promise.resolve().then(it.run).catch((err) => muxy.dialog.alert({ title: tr("실패했어요"), message: String((err && err.message) || err) }));
            },
          }, it.label)
    )
  );
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  // anchored menus sit right above/below their button, measured with the menu's real height
  const x = e.anchor ? e.anchor.left : e.clientX;
  const flipUp = e.anchor && !e.above && e.anchor.bottom + 4 + r.height > window.innerHeight - 6;
  const y = e.anchor ? (e.above || flipUp ? e.anchor.top - r.height - 4 : e.anchor.bottom + 4) : e.clientY;
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6)) + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + "px";
}
const hideMenu = () => { $("#menu").hidden = true; };
const anchor = (node, above = false) => ({ anchor: node.getBoundingClientRect(), above });

function projectMenu(e, p) {
  const here = async () => { await muxy.projects.switchTo(p.id); };
  const entries = data.worktrees[p.id] || [];
  showMenu(e, [
    entries.length > 1 ? { label: tr("Worktree 전환…"), run: () => pickWorktree(p, entries) } : null,
    { label: tr("새 Worktree…"), run: async () => { await here(); await muxy.commands.run("new_worktree"); } },
    "-",
    { header: tr("관리") },
    { label: tr(" 이슈 등록…"), run: () => muxy.modal.openWebview({ entry: "modal/create.html", width: 840, height: 760, dismissOnOutsideClick: false, data: { name: p.name, path: p.path } }) },
    { label: tr(" 이슈 관리 (GitHub · Linear)…"), run: () => openManager(p, "issues") },
    { label: tr(" 배포 관리 (PR 리뷰 · Actions)…"), run: () => openManager(p, "deploys") },
    { label: tr(" 브랜치 청소 (병합된 브랜치)…"), run: () => openManager(p, "cleanup") },
    { label: tr(" 노트…"), run: () => openManager(p, "notes", { scope: { kind: "proj", id: p.id, name: p.name } }) },
    "-",
    // never a scan of the whole home folder; Muxy refuses to move a remote server's project and its folder is not on this Mac
    isHome(p) || isRemote(p) ? null : { label: tr("그룹 이동…"), run: () => pickGroupFor(p) },
    isHome(p) || isRemote(p) ? null : { label: tr("저장소 다시 읽기"), run: () => rescanProject(p) },
    "-",
    { label: tr("이름 변경"), run: () => renameProject(p) },
    { label: tr("색상 변경…"), run: () => changeColor(p) },
    { label: tr("아이콘 변경…"), run: () => changeIcon(p) },
    "-",
    { label: "Open in…", run: () => openIn(p) },
    { label: tr("Finder에서 보기"), run: () => muxy.projects.reveal(p.id) },
    { label: tr("경로 복사"), run: () => muxy.clipboard.writeText(p.path) },
    "-",
    // Muxy refuses to delete a server's Home project ("the home project cannot be deleted"), so it is not offered
    isHomeProject(p) ? { label: tr("프로젝트 제거 — Home은 Muxy가 지우지 않아요"), disabled: true } : { label: tr("프로젝트 제거"), danger: true, run: () => removeProject(p) },
  ].filter(Boolean).filter((it, i, a) => !(it === "-" && (a[i - 1] === "-" || i === 0))));
}

async function pickWorktree(p, entries) {
  const picked = await pick(`"${p.name}" worktree`, entries.map((w) => ({ id: w.id, title: (w.isActive ? "✓ " : "") + (w.branch || w.name), subtitle: w.path })));
  if (picked) await muxy.worktrees.switchTo(picked.id, p.id);
}

async function pickGroupFor(p) {
  const items = [...data.workspaces.map((w) => ({ id: w.id, title: w.name })), { id: UNGROUPED, title: tr("미분류") }, { id: "__new__", title: tr("＋ 새 그룹…") }];
  const picked = await pick(tr("\"{0}\" 이동할 그룹", p.name), items);
  if (!picked) return;
  if (picked.id === "__new__") {
    const g = await createGroup();
    if (g) await moveProject(p.id, g.id);
  } else {
    await moveProject(p.id, picked.id);
  }
}

async function renameProject(p) {
  const name = await muxy.dialog.prompt({ title: tr("프로젝트 이름 변경"), placeholder: p.name });
  if (name && name.trim()) await muxy.projects.rename(p.id, name.trim());
}

async function changeColor(p) {
  const picked = await pick(tr("색상"), PALETTE.map(([title, id]) => ({ id, title, subtitle: id })));
  if (picked) await muxy.projects.setColor(p.id, picked.id);
}

async function changeIcon(p) {
  const name = await muxy.dialog.prompt({ title: tr("SF Symbol 이름 (비우면 기본값)"), placeholder: p.icon || "folder" });
  if (name === null) return;
  await muxy.projects.setIcon(p.id, name.trim() || null);
}

async function openIn(p) {
  const apps = await muxy.projects.apps();
  const picked = await pick(tr("열 앱"), [{ id: "__default__", title: tr("기본 앱") }, ...apps.map((a) => ({ id: a.id, title: a.name }))]);
  if (picked) await muxy.projects.openIn(p.id, picked.id === "__default__" ? undefined : picked.id);
}

async function removeProject(p) {
  const choice = await muxy.dialog.confirm({
    title: tr("\"{0}\" 프로젝트를 제거할까요?", p.name),
    message: tr("Muxy 목록에서만 빠지고 디스크의 폴더는 그대로 남아요."),
    buttons: [tr("제거"), tr("취소")], default: tr("취소"), cancel: tr("취소"),
  });
  if (choice !== tr("제거")) return;
  await muxy.projects.delete(p.id);
  delete state.kinds[p.id];
  await save();
}

/* ---------- header / footer ---------- */

/* ⋯ menu: a 정렬 section (project order), a 워크스페이스 정렬 section (group order) and a 사이드바 section
 * listing every sidebar that can be active. */
function moreMenu(e) {
  const build = () => {
    const sb = data.sidebars;
    const sorts = SORTS.map(([id, title]) => ({ label: "\u2003" + title, run: async () => { await muxy.projects.sort(id); refreshProjects(); } }));
    const wsSorts = WS_SORTS.map(([id, title]) => ({
      label: ((state.wsSort || "recent") === id ? "✓\u2002" : "\u2003") + title,
      run: async () => { state.wsSort = id; await save(); render(); },
    }));
    const sidebars = !sb
      ? [{ label: tr(" 불러오는 중…"), disabled: true }]
      : sb.items.map((i) => ({
          label: (i.id === sb.current ? "✓\u2002" : "\u2003") + i.title,
          run: async () => { if (i.id !== sb.current) await setActiveSidebar(i.id); },
        }));
    // language: the choice is saved for every Workdeck page; the sidebar reloads to apply it, other pages on next open
    const cur = hasLangOverride() ? LANG : "auto";
    const langs = [["auto", tr("자동")], ...LANGUAGES].map(([code, name]) => ({
      label: (code === cur ? "✓\u2002" : "\u2003") + name,
      run: () => { setLang(code); location.reload(); },
    }));
    return [{ header: tr("정렬") }, ...sorts, "-", { header: tr("워크스페이스 정렬") }, ...wsSorts, "-", { header: tr("사이드바") }, ...sidebars, "-", { header: tr("언어") }, ...langs];
  };
  showMenu(e, build());
  // the list is cached; refresh it in the background and redraw the menu if it is still open
  refreshSidebars().then(() => { if (!$("#menu").hidden) showMenu(e, build()); });
}

function extensionsMenu(e) {
  showMenu(e, [
    { label: "Create Extension…", run: () => muxy.commands.run("create_extension") },
    { label: "Manage Extensions", run: () => muxy.commands.run("manage_extensions") },
  ]);
}

/* ---------- bottom sections: active agents, remote connections ---------- */

const STATUS_RANK = { waiting: 0, working: 1 };

/* One small badge per agent type (monogram + brand-like color), so the kind is readable at a glance. */
const AGENT_BRAND = {
  claude: ["C", "#d97757", "Claude Code"], codex: ["Cx", "#10a37f", "Codex"], opencode: ["O", "#6b7280", "OpenCode"],
  cursor: ["Cu", "#5b5bd6", "Cursor"], copilot: ["Cp", "#8957e5", "Copilot"], droid: ["D", "#e5484d", "Droid"],
  pi: ["π", "#d6a100", "Pi"], grok: ["G", "#3b82f6", "Grok"], kiro: ["K", "#9046ff", "Kiro"], xal: ["X", "#0ea5a5", "Xal"], xita: ["Xt", "#0ea5a5", "XITA"],
  antigravity: ["A", "#4285f4", "Antigravity"], omp: ["Pi", "#c28a00", "Oh My Pi"], hermes: ["H", "#e67e22", "Hermes"],
};
function agentBadge(providerID) {
  const [label, color, name] = AGENT_BRAND[providerID] || ["•", "#808080", providerID || "agent"];
  return el("span", { class: "agent-badge", style: `background:${color}`, title: name }, label);
}

/* A running agent: type badge, the tab title it works under (truncated, full text on hover), and where it runs. */
/* An agent paired with its pane is matched by pane id. Only XITA rows still without a pane fall back to the focused
 * pane's folder, and when several share it, to the one whose session title is the pane's title.
 * Before: every XITA row went through the folder-and-title guess, which could not separate two agents in one folder.
 * Now: a row built from a pane's status line is matched by pane id, and a row still without a pane (terminal reading not
 *      allowed yet) falls back to the folder. When the focused pane already belongs to a row, the others stand down.
 * Why: the focused XITA agent was often not highlighted at all, and once some rows were paired the folder guess could
 *      highlight a second row alongside the paired one.
 * Affects: the highlight in the Agents section; unpaired XITA rows behave as before. */
function isFocusedAgent(a) {
  const f = data.focus;
  if (!f) return false;
  if (a.sub) return false; // a subagent has no pane of its own: it follows its parent's row
  if (a.paneID === f.paneID) return true;
  if (a.paneMatched) return false;
  // the focused pane already belongs to a paired row: an unpaired one in the same folder must not claim it too
  if (data.agents.some((x) => x.paneMatched && x.paneID === f.paneID)) return false;
  if (!a.external || norm(a.cwd) !== norm(f.cwd)) return false;
  const same = data.agents.filter((x) => x.external && !x.sub && !x.paneMatched && norm(x.cwd) === norm(f.cwd));
  if (same.length < 2) return true;
  const key = (t) => String(t || "").replace(/\s+/g, "").slice(0, 20);
  const fits = (x) => key(x.title).length >= 4 && (f.title.replace(/\s+/g, "").includes(key(x.title)) || String(x.title || "").replace(/\s+/g, "").includes(f.title.replace(/\s+/g, "").slice(0, 20)));
  return fits(a) && same.filter(fits).length === 1 ? true : false;
}

/* Click on an agent row (or a subagent row, which goes to its parent): show the tab that pane lives in.
 * Before: it called agents.focus, which answers "ok" but does not move the focus for an agent Muxy does not recognize —
 *         so clicking a XITA row, and any subagent row, did nothing at all.
 * Now: switch to the pane's project, then to its tab. Both are covered by permissions already declared.
 * Why: the owner clicked a subagent row and nothing happened.
 * Affects: clicks on Agents rows. A row with no pane yet only switches project. */
async function focusAgentRow(a) {
  if (a.remote) { await openServerConnection(a.server); return; } // a remote agent has no pane here: open its connection
  if (a.sub) { await openSubagentTab(a); return; }
  const pane = (data.panes || []).find((p) => p.id === a.paneID);
  if (!pane) { await muxy.projects.switchTo(a.projectID); return; }
  if (pane.projectID) await muxy.projects.switchTo(pane.projectID);
  await muxy.tabs.switchTo(pane.tabID);
}

/* A subagent's task and report open in their own tab: the sidebar column is too narrow to read a report in.
 * Before: they were shown inline under the row.
 * Now: the row opens a tab, and one already open for the same subagent is brought forward instead of duplicated.
 * Why: the owner asked to read it in a tab, not in the section list.
 * Affects: subagent rows only. */
async function openSubagentTab(a) {
  const title = tr("하위 작업 · {0}", a.title || a.childID);
  const mine = (data.projectTabs[a.projectID] || []).find((t) => t.title === title || t.customTitle === title);
  if (mine) { await muxy.tabs.switchTo(mine.id); return; }
  const proj = data.projects.find((p) => p.id === a.projectID) || {};
  await muxy.tabs.open({ kind: "extensionWebView", extension: { id: muxy.extensionID, tabType: "subagent", data: { parent: a.parentSess, child: a.childID, parentPane: a.parentPane, projectID: a.projectID, name: proj.name, path: proj.path } } });
}

/* Ends the terminal an agent runs in, for cleaning up. A subagent has no terminal of its own, so it ends its parent's.
 * Asks first: this kills whatever runs in that pane and cannot be undone. */
async function killAgentRow(a) {
  const paneID = a.sub ? a.parentPane : a.paneID;
  const label = data.agentTitles[a.paneID] || a.paneID;
  const yes = tr("종료");
  const answer = await muxy.dialog.confirm({
    title: tr("이 터미널을 종료할까요?"),
    message: a.sub ? tr("하위 작업은 별도 터미널이 없어서 상위 에이전트의 터미널을 종료해요.\n\n{0}", label) : label,
    buttons: [yes, tr("취소")], default: tr("취소"), cancel: tr("취소"),
  });
  if (answer !== yes) return;
  await muxy.panes.close(paneID);
  data.paneScreen.delete(paneID);
  await refreshFocus(); await refreshAgents(); refreshXita();
}

/* Right-click an agent row: name it yourself, clear that name, jump to the tab, or end the terminal. */
function agentMenu(e, a) {
  // a remote agent lives on another machine: nothing here can rename, move or end it
  if (a.remote) { showMenu(e, [{ label: tr("연결 열기"), run: () => openServerConnection(a.server).catch(failAlert(tr("연결을 열지 못했어요"))) }]); return; }
  const named = !!data.agentAlias[a.sub ? "sub:" + a.childID : a.sess || a.paneID];
  showMenu(e, [
    { label: tr("이름 변경"), run: async () => {
      const n = await muxy.dialog.prompt({ title: tr("에이전트 이름"), placeholder: data.agentTitles[a.paneID] || "" });
      if (n && n.trim()) await setAgentAlias(a, n.trim());
    } },
    named ? { label: tr("이름 되돌리기"), run: () => setAgentAlias(a, "") } : null,
    { label: a.sub ? tr("과제·보고 탭 열기") : tr("에이전트 탭으로 이동"), run: () => focusAgentRow(a).catch(failAlert(tr("에이전트 탭으로 이동하지 못했어요"))) },
    a.sub ? { label: tr("목록에서 정리"), run: () => hideSubagent(a).catch(failAlert(tr("정리하지 못했어요"))) } : null,
    { label: tr("세션 강제 종료"), run: () => killAgentRow(a).catch(failAlert(tr("터미널을 종료하지 못했어요"))) },
  ].filter(Boolean));
}

function agentRow(a, showIdle) {
  const p = data.projects.find((x) => x.id === a.projectID);
  const wt = (data.worktrees[a.projectID] || []).find((w) => w.id === a.worktreeID);
  const where = a.where || (wt && a.worktreeID !== a.projectID ? wt.branch || wt.name : null);
  const title = data.agentTitles[a.paneID];
  // selected = the agent's pane sits in the tab Muxy is showing right now
  const proj = data.projects.find((x) => x.id === a.projectID);
  const selected = isFocusedAgent(a)
    || (!!proj && isCurrent(proj) && (data.projectTabs[a.projectID] || []).some((t) => t.isActive && (t.paneIDs || []).includes(a.paneID)));
  const statusWord = { working: tr("작업 중"), waiting: tr("입력 대기"), idle: tr("대기") }[a.status] || a.status;
  const name = AGENT_BRAND[a.providerID] ? AGENT_BRAND[a.providerID][2] : a.providerID;
  const pane = (data.panes || []).find((p) => p.id === a.paneID);
  const own = pane && pane.title && pane.title !== title ? pane.title : null; // the agent's own tab title, kept on hover
  const kids = a.sub ? [] : data.agents.filter((x) => x.sub && x.parentSess && x.parentSess === a.sess);
  const kidsKey = "sub:" + a.sess;
  const kidsClosed = !!state.collapsed[kidsKey];
  return el(
    "div", { class: "row agent-row" + (a.sub ? " wt" : "") + (a.status === "idle" ? " idle" : "") + (selected ? " active" : "") + (a.remote ? " remote" : "") + (isStaleRemote(a) ? " stale" : ""), title: [title, own, p && p.name, where, a.remote ? tr("원격 서버 · {0}", a.server.name) : null, `${name} · ${statusWord}`].filter(Boolean).join("\n"), onclick: () => focusAgentRow(a).catch(failAlert(tr("에이전트 탭으로 이동하지 못했어요"))), oncontextmenu: (e) => { e.preventDefault(); agentMenu(e, a); } },
    agentBadge(a.providerID),
    a.remote ? remoteGlobe(a.server) : null,
    el("div", { class: "text" },
      el("div", { class: "name", "data-soft": "agent:" + a.paneID }, title || (p ? p.name : "?")),
      el("div", { class: "sub" }, [a.sub ? tr("하위 작업") + (a.kind ? " · " + a.kind : "") : null, p && p.name, where].filter(Boolean).join(" · "))),
    kids.length ? el("button", { class: "sec-btn", title: kidsClosed ? tr("하위 작업 펼치기") : tr("하위 작업 접기"), onclick: (e) => { e.stopPropagation(); state.collapsed[kidsKey] = !kidsClosed; save(); render(); } }, String(kids.length)) : null,
    kids.length ? chevron(!kidsClosed, (e) => { e.stopPropagation(); state.collapsed[kidsKey] = !kidsClosed; save(); render(); }) : null,
    statusDot(a.status, true)
  );
}
const SERVER_LABEL = { checking: tr("확인 중…"), online: tr("연결됨"), offline: tr("연결 안 됨") };

/* Home is not part of any workspace: it sits above all sections, always visible. */
function renderHome() {
  const slot = $("#home-slot");
  const home = data.projects.filter(isHome);
  slot.replaceChildren(...home.map((p) => projectBlock(p, 0, HOME_GROUP)));
}

/* Header shared by every section: icon, title, count, optional extra control, chevron. */
function sectionHead(key, title, count, iconName, iconKind, extra) {
  const open = !state.collapsed[key];
  return el(
    "div",
    { class: "sec-head", onclick: () => { state.collapsed[key] = open; save(); render(); } },
    icon(iconName, iconKind),
    el("span", { class: "sec-title" }, title),
    el("span", { class: "count" }, String(count)),
    extra || null,
    chevron(open, null, "grp")
  );
}

/* How recently an agent did anything: the last write of its session file; 0 when unknown. */
const agentActivity = (a) => (a.mtime ? a.mtime * 1000 : 0);

/* The small globe that marks a row of a remote connection; its tooltip names the connection. */
function remoteGlobe(server) {
  const m = icon("globe", "globe");
  m.classList.add("remote-mark");
  m.title = tr("원격 서버 · {0}", server.name);
  return m;
}

/* The rows of one list, grouped by state: a state header only when the list has more than one state.
 * Before: rows kept the order they were found in.
 * Now: inside a state the most recently active come first (agentActivity); ties keep the found order.
 * Why: the owner asked for the agents to be ordered by recent activity.
 * Affects: the Agents section only; subagent rows still follow their parent's row. */
function pushAgentStates(list, rows) {
  const order = [["waiting", tr("입력 대기")], ["working", tr("작업 중")], ["idle", tr("대기")]];
  const groups = order.map(([status, label]) => ({ status, label, list: list.filter((a) => a.status === status).sort((x, y) => agentActivity(y) - agentActivity(x)) })).filter((g) => g.list.length);
  for (const g of groups) {
    if (groups.length > 1) rows.push(agentGroupHead(g));
    if (groups.length < 2 || !state.collapsed["ag:" + g.status]) {
      for (const a of g.list) {
        rows.push(agentRow(a));
        for (const k of data.agents.filter((x) => x.sub && x.parentSess && x.parentSess === a.sess)) {
          if (state.collapsed["sub:" + a.sess]) continue;
          rows.push(agentRow(k));
        }
      }
    }
  }
}

/* "방금 전" / "N분 전" / "N시간 전" for a timestamp. */
function ageLabel(at) {
  const m = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return m < 1 ? tr("방금 전") : m < 60 ? tr("{0}분 전", m) : tr("{0}시간 전", Math.floor(m / 60));
}
/* A remote row whose connection has not been read for two minutes: still shown, a little dimmed. */
const isStaleRemote = (a) => !!a.remote && Date.now() - (((data.remoteCache[a.server.id] || {}).at) || 0) > 120000;
/* The connections whose cached agents are on screen. */
const cachedRemoteServers = () => data.servers.filter((s) => { const c = data.remoteCache[s.id]; return !!c && ((c.xita || []).length > 0 || (c.muxy || []).length > 0); });

/* Menu of the section header's globe button: per connection with cached agents, when it was last read, one forced
 * read, and its connection. */
function remoteAgentsMenu(e) {
  showMenu(e, cachedRemoteServers().flatMap((s) => [
    { header: `${s.name} · ${ageLabel((data.remoteCache[s.id] || {}).at || 0)}` },
    { label: tr("지금 다시 읽기"), run: () => rescanRemoteServer(s).catch(failAlert(tr("읽지 못했어요"))) },
    { label: tr("연결 열기"), run: () => openServerConnection(s).catch(failAlert(tr("연결을 열지 못했어요"))) },
  ]));
}

/* Running / waiting agents; click jumps to the agent's pane. The eye button also lists idle ones.
 * Before: agents of a remote connection were split into groups of their own ("로컬" / "원격 · <connection>") above the
 *         state groups.
 * Now: one set of state groups for every agent, local and remote alike. A remote row is marked instead — a globe
 *      before its name, the name in the remote colour, the connection in its tooltip — and is dimmed when its last
 *      read is old. The globe button in the section header lists the connections with cached agents.
 * Why: the owner found the separate groups did not tell remote from local at a glance and asked for state groups
 *      with a mark on the row.
 * Affects: the Agents section only. Folded state groups are remembered in state.collapsed like folder groups. */
function agentsSection() {
  const all = data.agents.filter((a) => !a.sub); // subagents follow their parent's row, not a group of their own
  if (!data.agents.length) return null;
  const visible = state.showIdle ? all : all.filter((a) => a.status !== "idle");
  const toggle = el("button", {
    class: "sec-btn" + (state.showIdle ? " on" : ""),
    title: state.showIdle ? tr("대기 중인 agent 숨기기") : tr("대기 중인 agent도 보기"),
    onclick: (e) => { e.stopPropagation(); state.showIdle = !state.showIdle; save(); render(); },
  });
  toggle.append(icon(state.showIdle ? "eye" : "eyeoff", "window"));
  const rows = [];
  if (!visible.length) rows.push(el("div", { class: "hint" }, tr("작업 중인 agent가 없어요 · 눈 아이콘으로 대기 중인 agent 보기")));
  pushAgentStates(visible, rows);
  const remote = cachedRemoteServers().length ? el("button", { class: "sec-btn", title: tr("원격 에이전트 · 마지막 확인 시각과 다시 읽기"), onclick: (e) => { e.stopPropagation(); remoteAgentsMenu(anchor(e.currentTarget)); } }) : null;
  if (remote) remote.append(icon("globe", "globe"));
  const board = el("button", { class: "sec-btn", title: tr("관제 대시보드 크게 보기 (새 탭)"), onclick: (e) => { e.stopPropagation(); openBoard().catch(failAlert(tr("대시보드를 열지 못했어요"))); } });
  board.append(icon("expand", "window"));
  return { title: "Agents", count: visible.length, iconName: "bot", iconKind: "sec-agent", rows, extra: el("span", { class: "sec-actions" }, remote, board, toggle) };
}

/* Header of one state group, shaped like the sidebar's folder groups. */
function agentGroupHead(g) {
  const key = "ag:" + g.status;
  const closed = !!state.collapsed[key];
  return el(
    "div",
    { class: "row folder", "data-key": key, title: g.label, onclick: () => { state.collapsed[key] = !closed; save(); render(); } },
    statusDot(g.status, true),
    el("div", { class: "text" }, el("div", { class: "name" }, g.label)),
    el("span", { class: "count" }, String(g.list.length)),
    chevron(!closed)
  );
}

/* Configured remote servers. Click opens the connection (one tab per server, focused again on later clicks);
 * hover ＋ adds another terminal on that server. */
function remoteSection() {
  const reread = el("button", { class: "sec-btn", title: tr("서버 목록 다시 읽기"), onclick: (e) => { e.stopPropagation(); refreshServers(); } });
  reread.append(icon("refresh", "window"));
  // like the built-in sidebar's server button, this opens a popup with the servers and their actions
  const settings = el("button", { class: "sec-btn", title: tr("서버 메뉴"), onclick: (e) => { e.stopPropagation(); remoteMenu(anchor(e.currentTarget)); } });
  settings.append(icon("gear", "window"));
  const rows = data.servers.length ? data.servers.map(serverRow) : [el("div", { class: "hint" }, tr("등록된 리모트 서버가 없어요 · 톱니바퀴로 추가"))];
  return { title: "Remote", count: data.servers.length, iconName: "server", iconKind: "sec-remote", rows, extra: el("span", { class: "sec-actions" }, reread, settings) };
}

const failAlert = (title) => (err) => muxy.dialog.alert({ title, message: String((err && err.message) || err) });

/* Whether this connection's tab is the one Muxy is showing.
 * Before: a Remote row looked the same whether its connection tab was closed, open in the background or active.
 * Now: the row is highlighted while the tab remembered for that connection is the active tab (or holds the focused pane).
 * Why: the owner had a connection's tab in front and the Remote section gave no sign of it.
 * Affects: the highlight of Remote rows only. */
function serverTabActive(srv) {
  const known = state.serverTabs[srv.id];
  if (!known) return false;
  if ((data.panes || []).some((p) => p.isFocused && p.tabID === known)) return true;
  return Object.values(data.projectTabs).some((tabs) => tabs.some((t) => t.id === known && t.isActive));
}

function serverRow(srv) {
  const st = data.serverStatus[srv.id];
  return el(
    "div",
    {
      class: "row server-row" + (serverTabActive(srv) ? " active" : ""),
      title: tr("{0}\n클릭: 연결 열기 (이미 열려 있으면 그 탭으로 이동)", srv.ssh),
      onclick: () => openServerConnection(srv).catch(failAlert(tr("연결을 열지 못했어요"))),
      oncontextmenu: (e) => { e.preventDefault(); showMenu(e, serverMenuItems(srv)); },
    },
    icon("server", "window"),
    el("div", { class: "text" }, el("div", { class: "name" }, srv.name), el("div", { class: "sub" }, st ? `${srv.ssh} · ${SERVER_LABEL[st]}` : srv.ssh)),
    el("span", { class: "srv " + (st || "unknown") }),
    plusButton(() => createServerSession(srv), tr("이 서버에 새 터미널"))
  );
}

/* Fills one bottom section; its height is the user's saved size when they dragged the splitter above it.
 * Before: the body was replaced on every rebuild, and a body that had been scrolled down jumped back to its top as
 *         soon as anything on the sidebar changed (a working agent's session file changes every few seconds).
 * Now: the scroll offset of the previous body is carried over to the new one, like the project list keeps its anchor.
 * Why: the owner was reading the Agents section and it kept jumping back up.
 * Affects: the Agents and Remote sections' scroll position only. */
function fillSection(name, desc) {
  const host = $("#sec-" + name);
  const split = $("#split-" + name);
  const key = "sec:" + name;
  if (!desc) { host.hidden = true; split.hidden = true; host.replaceChildren(); return; }
  const prev = host.querySelector(".sec-body");
  const top = prev ? prev.scrollTop : 0;
  const collapsed = !!state.collapsed[key];
  const body = el("div", { class: "sec-body" }, desc.rows);
  const h = state.sizes[name];
  if (typeof h === "number") { body.style.height = h + "px"; body.style.maxHeight = "none"; }
  host.className = "sec" + (collapsed ? " collapsed" : "");
  host.hidden = false;
  split.hidden = collapsed;
  host.replaceChildren(sectionHead(key, desc.title, desc.count, desc.iconName, desc.iconKind, desc.extra), body);
  body.scrollTop = top;
}

function renderSections() {
  const wsKey = "sec:workspaces";
  $("#sec-workspaces").classList.toggle("collapsed", !!state.collapsed[wsKey]);
  $("#head-workspaces").replaceChildren(sectionHead(wsKey, "Workspaces", data.workspaces.length + remoteGroups().length, "layers", "sec-ws"));
  fillSection("agents", agentsSection());
  fillSection("remote", remoteSection());
}

/* Drag the line above a section to resize it; Workspaces absorbs the difference. Double-click resets. */
function initSplitters() {
  document.querySelectorAll(".splitter").forEach((sp) => {
    const name = sp.dataset.key;
    sp.addEventListener("pointerdown", (e) => {
      const body = document.querySelector("#sec-" + name + " .sec-body");
      if (!body) return;
      e.preventDefault();
      try { sp.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
      sp.classList.add("active");
      const startY = e.clientY;
      const startH = body.getBoundingClientRect().height;
      const roomH = $("#list").getBoundingClientRect().height;
      drag.kind = "resize"; // keeps render() from rebuilding the section under the pointer
      const move = (ev) => {
        const h = Math.round(Math.max(36, Math.min(startH - (ev.clientY - startY), startH + roomH - 80)));
        body.style.height = h + "px";
        body.style.maxHeight = "none";
        state.sizes[name] = h;
      };
      const up = () => {
        sp.removeEventListener("pointermove", move);
        sp.removeEventListener("pointerup", up);
        sp.removeEventListener("pointercancel", up);
        sp.classList.remove("active");
        drag.kind = null;
        save();
        if (drag.pending) { drag.pending = false; render(); }
      };
      sp.addEventListener("pointermove", move);
      sp.addEventListener("pointerup", up);
      sp.addEventListener("pointercancel", up);
    });
    sp.addEventListener("dblclick", () => { delete state.sizes[name]; save(); render(); });
  });
}

/* Popup of the remote-server button: every configured server (click to check its connection), plus
 * add/manage in Settings and a list refresh. */
function remoteMenu(e) {
  const mark = { online: "● ", offline: "○ ", checking: "… " };
  const items = data.servers.map((srv) => ({
    label: `${mark[data.serverStatus[srv.id]] || ""}${srv.name}  ·  ${srv.ssh}`,
    run: () => openServerConnection(srv),
  }));
  if (items.length) items.push("-");
  items.push(
    { label: tr("서버 추가·관리…"), run: () => muxy.ui.openSettings("servers") },
    { label: tr("서버 목록 다시 읽기"), run: refreshServers }
  );
  showMenu(e, items);
}

/* Two-letter badge for a workspace title in the icon rail. */
function initials(name) {
  const t = String(name || "?").trim();
  const words = t.split(/[\s_\-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : t.slice(0, 2)).toUpperCase();
}

/* Menus in the icon rail: the same items as a Muxy picker, with section headers shown as each item's subtitle. */
async function compactMenu(items) {
  let section = null;
  const flat = [];
  for (const it of items) {
    if (it === "-") continue;
    if (it.header) { section = it.header; continue; }
    if (it.disabled) continue;
    flat.push({ it, section });
  }
  const picked = await muxy.modal.open({
    placeholder: tr("작업 선택"),
    items: flat.map((f, i) => ({ id: String(i), title: f.it.label.replace(/^[\s\u2003\u2002]*/, ""), subtitle: f.section || undefined })),
  });
  if (!picked) return;
  try { await flat[Number(picked.id)].it.run(); }
  catch (err) { await muxy.dialog.alert({ title: tr("실패했어요"), message: String((err && err.message) || err) }); }
}

/* Search in the icon rail: a Muxy picker over every project that jumps to the chosen one. */
async function quickSwitch() {
  const items = data.projects.map((p) => ({ id: p.id, title: p.name, subtitle: isHome(p) ? "Home" : (groupOf(p.id) || serverOfProject(p) || {}).name || tr("미분류") }));
  const picked = await pick(tr("프로젝트로 이동"), items);
  if (picked) await muxy.projects.switchTo(picked.id);
}

/* Agent control room: one tab for all agents, always in the Home project's tab strip. It is opened where the user is and
 * moved into Home, and remembered with its project, so a later click jumps back to it instead of opening a second one. */
async function openBoard() {
  const home = data.projects.find(isHome);
  const known = state.managerTabs.board;
  if (known) {
    const tabs = await safe(() => muxy.tabs.list({ project: known.project }), []);
    if (tabs.some((t) => t.id === known.tab)) {
      const owner = data.projects.find((p) => p.id === known.project);
      if (owner && !isCurrent(owner)) await muxy.projects.switchTo(owner.id);
      await muxy.tabs.switchTo(known.tab);
      return;
    }
  }
  const id = await muxy.tabs.open({ kind: "extensionWebView", extension: { id: muxy.extensionID, tabType: "board", data: {} } });
  if (home && !isCurrent(home)) {
    await muxy.tabs.move(id, { project: home.id });
    await muxy.projects.switchTo(home.id);
  }
  await muxy.tabs.switchTo(id);
  state.managerTabs.board = { tab: id, project: home ? home.id : null };
  await save();
}

/* Issue / deploy manager for a project: one tab per project and kind, living in THAT project's tab strip.
 * The tab is opened where the user currently is, then moved into the project, so no project switch happens
 * before it holds a tab (switching to a project without tabs can make Muxy open an empty terminal). */
async function openManager(p, tabType, extra = {}) {
  const key = `${p.id}:${tabType}`;
  const known = state.managerTabs[key];
  const mine = known ? await safe(() => muxy.tabs.list({ project: p.id }), []) : [];
  if (known && mine.some((t) => t.id === known)) {
    if (!isCurrent(p)) await muxy.projects.switchTo(p.id);
    await muxy.tabs.switchTo(known);
    return;
  }
  const id = await muxy.tabs.open({ kind: "extensionWebView", extension: { id: muxy.extensionID, tabType, data: { name: p.name, path: p.path, ...extra } } });
  if (!isCurrent(p)) {
    await muxy.tabs.move(id, { project: p.id });
    await muxy.projects.switchTo(p.id);
  }
  await muxy.tabs.switchTo(id);
  state.managerTabs[key] = id;
  await save();
}

/* Notes for a workspace: it has no project of its own, so the tab opens where the user is and is reused next time.
 * Before: only a scoped (ws/proj) notes tab could be opened from the sidebar.
 * Now: a null scope opens the all-notes tab (key notes:all), reused the same way.
 * Why: the owner asked for a header notes button that opens the all view.
 * Affects: tab opening/reuse only; scoped tabs behave exactly as before. */
async function openNotesFor(scope) {
  const key = scope ? `notes:${scope.kind}:${scope.id}` : "notes:all";
  const known = state.managerTabs[key];
  const here = known ? await safe(() => muxy.tabs.list(), []) : [];
  if (known && here.some((t) => t.id === known)) { await muxy.tabs.switchTo(known); return; }
  const id = await muxy.tabs.open({ kind: "extensionWebView", extension: { id: muxy.extensionID, tabType: "notes", data: scope ? { scope } : {} } });
  await muxy.tabs.switchTo(id);
  state.managerTabs[key] = id;
  await save();
}
