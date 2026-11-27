/* Wiring and boot. */
$("#add-folder").addEventListener("click", () => addFolder());
$("#add-group").addEventListener("click", () => createGroup());
$("#more").addEventListener("click", (e) => { e.stopPropagation(); moreMenu(anchor(e.currentTarget)); });
$("#notes").addEventListener("click", () => openNotesFor(null));
$("#ext").addEventListener("click", (e) => { e.stopPropagation(); extensionsMenu(anchor(e.currentTarget, true)); });
$("#settings").addEventListener("click", () => muxy.ui.openSettings("general"));
document.querySelectorAll(".slot[data-icon]").forEach((n) => n.replaceWith(icon(n.dataset.icon, "window")));

const qInput = $("#q");
const qClear = $("#q-clear");
function setQuery(v) {
  data.query = v;
  qInput.value = v;
  qClear.hidden = !v;
  render();
}
qInput.addEventListener("input", () => setQuery(qInput.value));
qInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { setQuery(""); e.stopPropagation(); } });
qClear.addEventListener("click", () => { setQuery(""); qInput.focus(); });

$("#q-open").addEventListener("click", () => quickSwitch());

/* Icon-rail mode when the page is narrow (the built-in sidebar's collapsed style is "icons"). */
const COMPACT_MAX_WIDTH = 120;
let wasCompact = false;
new ResizeObserver(() => {
  const compact = document.body.getBoundingClientRect().width <= COMPACT_MAX_WIDTH;
  document.body.classList.toggle("compact", compact);
  if (compact !== wasCompact) { wasCompact = compact; hideMenu(); render(); }
}).observe(document.body);

initSplitters();
document.addEventListener("click", hideMenu);
window.addEventListener("blur", hideMenu);

// Auto-scroll while dragging near the top or bottom edge. Capture phase: row handlers stop propagation.
$("#list").addEventListener("dragover", (e) => {
  if (!drag.kind) return;
  const list = $("#list");
  const r = list.getBoundingClientRect();
  if (e.clientY < r.top + 56) list.scrollTop -= 18;
  else if (e.clientY > r.bottom - 56) list.scrollTop += 18;
}, true);

muxy.events.subscribe("projects.changed", () => { schedule("projects", refreshProjects); schedule("members", refreshMembers, 600); });
/* When the active project / worktree / tab changes, scroll the list so the active row is not hidden off-screen. */
function revealActive() {
  // wait for the coalesced render that follows the data refresh
  setTimeout(() => {
    const list = $("#list");
    if (!list || isCompact()) return;
    const target = list.querySelector(".tab.active") || list.querySelector(".tab.wt.active") || list.querySelector(".row.active");
    if (!target) return;
    const t = target.getBoundingClientRect(), l = list.getBoundingClientRect();
    if (t.top < l.top || t.bottom > l.bottom) target.scrollIntoView({ block: "nearest" });
  }, 60);
}

const onSwitch = (e) => schedule("active", async () => { await refreshActive([e && e.projectID].filter(Boolean)); await refreshTabs(); revealActive(); schedule("xita", refreshXita, 0); }, 100);
muxy.events.subscribe("project.switched", onSwitch);
muxy.events.subscribe("worktree.switched", onSwitch);
muxy.events.subscribe("worktree.headChanged", () => schedule("branches", async () => { await refreshBranches(); render(); }));
// no worktree-removed event exists: a removed worktree closes its tabs, and the focus / interval checks catch the rest
muxy.events.subscribe("tab.closed", () => schedule("worktrees", syncWorktrees, 1200));
window.addEventListener("focus", () => schedule("worktrees", syncWorktrees, 300));
setInterval(() => { if (document.visibilityState === "visible") schedule("worktrees", syncWorktrees); }, 15000);
muxy.events.subscribe("agent.status", () => schedule("agents", refreshAgents, 150));
for (const ev of ["tab.created", "tab.closed", "tab.updated"]) muxy.events.subscribe(ev, () => schedule("tabs", refreshTabs, 300));
muxy.events.subscribe("tab.focused", () => schedule("tabs", async () => { await refreshTabs(); revealActive(); }, 300));
// pane focus is what Muxy records in focus_history — re-read it so the recent-activity workspace order follows
muxy.events.subscribe("pane.focused", () => { schedule("members", refreshMembers, 600); schedule("tabs", refreshTabs, 300); });
muxy.events.subscribe("tab.updated", () => schedule("agents", refreshAgents, 800));
muxy.events.subscribe("ui.changed", () => schedule("ui", async () => { await refreshUI(); refreshTabs(); }));

(async () => {
  try { await loadState(); } catch (err) { console.error("load state", err); }
  // One step that fails must not keep the later ones from running: right after an extension reload Muxy is busy and
  // a single call can come back with "no response", which used to leave the sidebar without projects or timers.
  // step answers whether the call succeeded; the steps themselves return nothing.
  const step = async (fn) => { try { await fn(); return true; } catch (e) { console.warn(String((e && e.message) || e)); return false; } };
  await step(refreshUI);
  if (!(await step(refreshProjects))) schedule("projects", refreshProjects, 5000);
  await step(refreshMembers);
  refreshServers();
  refreshSidebars();
  refreshAgents();
  refreshTabs().then(revealActive);
  refreshXita();
  setInterval(() => { if (document.visibilityState === "visible") refreshXita(); }, 6000);
})();

/* Text the list cuts off with "…" shows in full after the pointer rests on it for a moment. When the row carries its own
 * title (name + path, ...) that fuller text is shown instead, and the native tooltip is held back while ours is up. */
(function fullTextTip() {
  const tip = el("div", { id: "fulltip", hidden: true });
  document.body.append(tip);
  let timer = null, held = null;
  const clipped = (n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).textOverflow === "ellipsis";
  const hide = () => {
    clearTimeout(timer); timer = null; tip.hidden = true;
    if (held) { held.node.setAttribute("title", held.title); held = null; }
  };
  document.addEventListener("mouseover", (e) => {
    hide();
    let n = e.target;
    for (let i = 0; n && n !== document.body && i < 5; i++, n = n.parentElement) if (n instanceof Element && clipped(n)) break;
    if (!n || n === document.body || !(n instanceof Element) || !clipped(n)) return;
    const node = n, x = e.clientX, y = e.clientY;
    timer = setTimeout(() => {
      const titled = node.closest("[title]");
      const text = titled ? titled.getAttribute("title") : node.textContent.trim();
      if (!text) return;
      if (titled) { held = { node: titled, title: text }; titled.removeAttribute("title"); }
      tip.textContent = text;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.max(4, Math.min(x + 8, window.innerWidth - r.width - 4)) + "px";
      tip.style.top = Math.max(4, Math.min(y + 18, window.innerHeight - r.height - 4)) + "px";
    }, 900);
  });
  document.addEventListener("mouseleave", hide);
  document.addEventListener("mousedown", hide, true);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget) hide(); });
})();
