/* Shared state, helpers and data loading for the Workdeck sidebar.
 * Classic scripts share one global scope: core.js, add.js, view.js, main.js (in that order). */
const UNGROUPED = "__ungrouped__";
const PALETTE = [
  [tr("빨강"), "#FF5F57"], [tr("주황"), "#FF9F0A"], [tr("노랑"), "#FEBC2E"], [tr("초록"), "#30D158"],
  [tr("파랑"), "#0A84FF"], [tr("보라"), "#BF5AF2"], [tr("분홍"), "#FF375F"], [tr("회색"), "#808080"],
];

/* Persisted in extension storage: UI-only memory. Groups themselves are Muxy workspaces.
 * kinds: projectID -> { kind: "repo" | "submodule", root } recorded when a folder is added through the scan,
 * where root is the folder that was picked (used to draw a folder row above its repositories). */
let state = { collapsed: {}, kinds: {}, expanded: {}, sizes: {}, showIdle: false, serverTabs: {}, managerTabs: {}, lastWt: {}, wsSort: "recent" };
/* Live data pulled from Muxy. members: workspaceID -> project IDs, read from Muxy's desktop-state.json. */
let data = { projects: [], branches: {}, worktrees: {}, agents: [], muxyAgents: [], xita: null, xitaChildren: [], agentTitles: {}, focus: null, panes: [], issueRuns: new Map(), paneScreen: new Map(), agentAlias: {}, subHidden: {}, projectTabs: {}, workspaces: [], members: {}, membersOK: false, focusHistory: [], projectMeta: {}, remoteAgents: [], remoteCache: {}, home: null, servers: [], serverStatus: {}, sidebars: null, query: "" };

const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);
const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const norm = (p) => p.replace(/\/+$/, "");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

/* ---------- storage ---------- */

async function save() {
  await muxy.storage.set("state", state);
}

async function loadState() {
  const s = await muxy.storage.get("state");
  if (s) state = { collapsed: s.collapsed || {}, kinds: s.kinds || {}, expanded: s.expanded || {}, sizes: s.sizes || {}, showIdle: !!s.showIdle, serverTabs: s.serverTabs || {}, managerTabs: s.managerTabs || {}, lastWt: s.lastWt || {}, wsSort: s.wsSort || "recent" };
  data.agentAlias = (await safe(() => muxy.storage.get("agentAlias"), {})) || {};
  data.subHidden = (await safe(() => muxy.storage.get("subHidden"), {})) || {};
  data.remoteCache = (await safe(() => muxy.storage.get("remoteAgents"), {})) || {}; // last read of each remote connection's agents
}

/* Tidies a finished subagent out of the list. Its log stays on disk; only the row goes.
 * Before: a subagent row stayed until its log was an hour old, finished or not, and clicking it only moved to the parent's
 *         tab — which is where the user already was, so nothing appeared to happen.
 * Now: a finished one drops out five minutes after its last write, and this dismisses it at once.
 * Why: the owner asked for finished subagents to be cleaned up.
 * Affects: subagent rows only. */
async function hideSubagent(a) {
  const saved = { ...((await safe(() => muxy.storage.get("subHidden"), {})) || {}) };
  saved[a.childID] = Date.now();
  await muxy.storage.set("subHidden", saved);
  data.subHidden = saved;
  mergeAgents(); render();
}

/* The owner's own name for an agent row, kept by session (or subagent id) so it survives a pane change.
 * Before: a row could only show what the agent named its tab, or the issue it was given; there was no way to rename it.
 * Now: right-click a row to name it, or to clear the name and go back to the automatic label.
 * Why: the owner asked to name agent sessions himself.
 * Affects: the row label only. The agent's tab title is untouched. */
async function setAgentAlias(a, name) {
  const key = a.sub ? "sub:" + a.childID : a.sess || a.paneID;
  const saved = { ...((await safe(() => muxy.storage.get("agentAlias"), {})) || {}) };
  if (name) saved[key] = name; else delete saved[key];
  await muxy.storage.set("agentAlias", saved);
  data.agentAlias = saved;
  mergeAgents(); render();
}

/* ---------- loading ---------- */

/* Runs fn over items with at most `limit` calls in flight; Muxy's background queue rejects bursts. */
async function pool(items, fn, limit = 4) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const safe = async (fn, fallback, quiet = false) => { try { return await fn(); } catch (e) { if (!quiet) console.warn(String((e && e.message) || e)); return fallback; } };

let projectsBusy = false;
let projectsAgain = false;

async function refreshProjects() {
  if (projectsBusy) { projectsAgain = true; return; }
  projectsBusy = true;
  try {
    await loadProjects();
  } finally {
    projectsBusy = false;
    if (projectsAgain) { projectsAgain = false; refreshProjects(); }
  }
}

async function loadProjects() {
  data.projects = await muxy.projects.list();
  render();
  await Promise.all([refreshWorktrees(), refreshBranches()]);
  render();
  syncRemoteSoon();
}

/* Workspace membership is not exposed by the extension API, so it is read (read-only) from Muxy's own
 * state file. Writes always go through projects.attach/detach and workspaces.*.
 * Before: only workspace membership and $HOME were read; the sidebar always showed Muxy's list order.
 * Now: window.focus_history (pane ids, oldest first) is extracted in the same call into data.focusHistory.
 * Why: the owner asked for workspaces sorted by recent activity, and focus history is Muxy's own activity record.
 * Affects: read-only — one more plutil extraction in the same exec; a missing or unreadable history falls back to []. */
async function refreshMembers() {
  try {
    const r = await muxy.exec({
      shell: 'f="$HOME/Library/Application Support/Muxy 2/desktop-state.json"; [ -f "$f" ] || f="$HOME/Library/Application Support/Muxy/desktop-state.json"; plutil -extract workspaces json -o - "$f"; echo; plutil -extract window.focus_history json -o - "$f" 2>/dev/null || echo "[]"; echo; echo "$HOME"',
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`);
    const lines = r.stdout.trimEnd().split("\n").filter((l) => l.trim() !== "");
    data.home = (lines.pop() || "").trim() || null; // last line is $HOME, used to find the Home project
    try { data.focusHistory = JSON.parse(lines.pop() || "[]"); } catch (e) { data.focusHistory = []; }
    data.members = Object.fromEntries(JSON.parse(lines.join("\n")).map((w) => [w.id, w.projects || []]));
    data.membersOK = true;
  } catch (e) {
    console.warn("workspace members unreadable: " + String((e && e.message) || e));
    data.membersOK = false;
  }
  render();
  await refreshWorktrees();
  render();
  syncRemoteSoon();
}

/* Registered Muxy worktrees, kept only to know which one is active and to offer "Worktree 전환…". */
async function refreshWorktrees() {
  const targets = data.projects.filter((p) => p.worktreesEnabled);
  const entries = await pool(targets, async (p) => [p.id, await safe(() => muxy.worktrees.list(p.id), [])]);
  data.worktrees = Object.fromEntries(entries);
  await pruneMissingWorktrees(targets);
}

/* Drops worktree registrations whose folder no longer exists.
 * Before: a worktree removed outside Muxy (`git worktree remove` + folder delete) stayed in the sidebar forever —
 *         Muxy keeps the record, worktrees.refresh() does not prune it, and no refresh re-checked the path.
 * Now: each worktree refresh probes every secondary worktree with git.currentBranch; when Muxy itself answers
 *      "Project directory is missing", the record goes through projects.delete and the lists are re-read.
 * Why: the owner asked for worktrees with a missing path to drop out automatically on reload (workbit KYL-873 ghost).
 * Affects: secondary worktree rows only — never the project's own folder, never the active worktree, and never on
 *          any other error (offline server, timeout). One delete attempt per worktree per session, so a denied
 *          permission prompt is not asked again every 15 seconds. */
const pruneTried = new Set();
async function pruneMissingWorktrees(targets) {
  const suspects = [];
  for (const p of targets) for (const w of data.worktrees[p.id] || []) {
    if (!w.isActive && norm(w.path) !== norm(p.path) && !pruneTried.has(w.id)) suspects.push(w);
  }
  if (!suspects.length) return;
  let removed = false;
  await pool(suspects, async (w) => {
    try { await muxy.git.currentBranch({ project: w.id }); }
    catch (e) {
      if (!/directory is missing/i.test(String((e && e.message) || e))) return;
      pruneTried.add(w.id);
      if (await safe(async () => { await muxy.projects.delete(w.id); return true; }, false)) removed = true;
    }
  });
  if (!removed) return;
  const entries = await pool(targets, async (p) => [p.id, await safe(() => muxy.worktrees.list(p.id), [])]);
  data.worktrees = Object.fromEntries(entries);
}

/* Worktrees removed outside the sidebar (Muxy's own delete, `git worktree remove`) fire no event of their own, so this
 * re-reads the lists and renders only when one actually changed. */
async function syncWorktrees() {
  const before = JSON.stringify(data.worktrees);
  await refreshWorktrees();
  if (JSON.stringify(data.worktrees) !== before) { await refreshBranches(); render(); }
}

/* Switching project/worktree only changes which entry is active, so refresh just the projects involved
 * (previous and new) instead of every project's worktrees and branches. */
async function refreshActive(extraIDs = []) {
  const ids = new Set(extraIDs);
  for (const p of data.projects) if (p.isActive) ids.add(p.id);
  for (const [pid, list] of Object.entries(data.worktrees)) if (list.some((w) => w.isActive)) ids.add(pid);
  data.projects = await muxy.projects.list();
  for (const p of data.projects) if (p.isActive) ids.add(p.id);
  const targets = data.projects.filter((p) => ids.has(p.id) && p.worktreesEnabled);
  const entries = await pool(targets, async (p) => [p.id, await safe(() => muxy.worktrees.list(p.id), [])]);
  for (const [pid, list] of entries) data.worktrees[pid] = list;
  render();
}

/* Search filter: matches a project's name, folder name, current branch or any worktree branch. */
const normQuery = () => (data.query || "").trim().toLowerCase();
function matchesQuery(p) {
  const q = normQuery();
  if (!q) return true;
  const hay = [p.name, base(p.path), data.branches[p.id], ...(data.worktrees[p.id] || []).map((w) => w.branch || w.name)];
  return hay.some((v) => v && String(v).toLowerCase().includes(q));
}

/* A project is "current" when it, or one of its worktrees, is the one Muxy is showing. */
const isCurrent = (p) => p.isActive || (data.worktrees[p.id] || []).some((w) => w.isActive);

/* Open = its tab list is visible. Clicking a project row only toggles this; the current project starts open. */
const isOpen = (p) => state.expanded[p.id] ?? isCurrent(p);

/* Which server a project belongs to, and whether it is that server's Home. Muxy creates a Home project on every
 * server it connects to, so a remote one can have the very same folder path as this Mac's Home. */
const serverOf = (p) => ((data.projectMeta || {})[p.id] || {}).server;
const serverOfProject = (p) => (data.servers || []).find((s) => s.id === serverOf(p));
const isRemote = (p) => !!serverOfProject(p);
const isHomeProject = (p) => !!((data.projectMeta || {})[p.id] || {}).home;

/* The user's Home project is pinned above every group.
 * Before: any project whose folder is $HOME was taken for Home, so the Home project of a remote server run by an
 *         account with the same user name was pinned up there too and lost its "그룹 이동" menu.
 * Now: only a local project can be Home; a remote server's Home is an ordinary row.
 * Why: the owner's remote server projects (same /Users/<name> path) showed up as a second Home at the top.
 * Affects: the pinned Home slot and the menus of remote Home projects only. */
function isHome(p) {
  if (isRemote(p)) return false;
  if (data.home) return norm(p.path) === norm(data.home);
  const homes = data.projects.filter((x) => x.name === "Home" && !isRemote(x));
  return homes.length > 0 && homes[0].id === p.id;
}

async function refreshBranches() {
  const entries = await pool(data.projects, async (p) => [p.id, await safe(() => muxy.git.currentBranch({ project: p.id }), null, true)]);
  data.branches = Object.fromEntries(entries);
}

/* Each running agent is labelled with the title of the terminal tab it runs in, found via the tab's panes.
 * Before: the tab titles replaced the whole map, so the XITA labels mergeAgents had just written were dropped, and the
 *         pane list was read without waiting, so XITA rows were paired with panes from the previous refresh.
 * Now: the pane list is read first and the XITA merge runs again after the tab titles, keeping both kinds of label.
 * Why: XITA rows showed the raw folder name or nothing, and pane pairing lagged one refresh behind the focus.
 * Affects: the Agents section's row labels and which XITA row is marked as focused. */
async function refreshAgents() {
  data.muxyAgents = await safe(() => muxy.agents.list(), []);
  rememberRemoteMuxy();
  await attachIssueRuns();
  await refreshFocus();
  mergeAgents();
  const projectIDs = [...new Set(data.agents.map((a) => a.projectID))];
  const entries = await pool(projectIDs, async (pid) => safe(() => muxy.tabs.list({ project: pid }), []));
  const titles = {};
  for (const tabs of entries) for (const t of tabs) for (const pane of t.paneIDs || []) titles[pane] = t.customTitle || t.title;
  data.agentTitles = titles;
  mergeAgents(); // XITA has no tab title of its own: put its label back on top
  render();
}

/* Agents the issue manager started run in a worktree folder outside every project, so Muxy files them under Home. The run
 * records (tab id, project, branch) say where they really belong: the agent whose pane sits in the run's tab goes back to
 * the project and shows the branch.
 * Before: only the record's values were read, so the issue number in its key was lost and the row kept the agent's own
 *         tab title, which is the first line of whatever prompt the agent was given.
 * Now: the records are kept as tab id → { num, title, branch } in data.issueRuns, and the agent gets the issue itself.
 * Why: the row should say which issue is being worked on, not the opening words of the prompt.
 * Affects: rows of agents started from the Issues tab; other agents keep their tab title. */
async function attachIssueRuns() {
  const saved = (await safe(() => muxy.storage.get("issueRuns"), null)) || {};
  const runs = new Map();
  const relays = new Map();
  for (const [k, r] of Object.entries(saved)) {
    runs.set(r.tabId, { num: k.slice(k.indexOf("#") + 1), title: r.title, branch: r.branch, projectPath: r.projectPath, dir: r.dir });
    if (r.relay && r.relay.key) relays.set(r.relay.key, r.relay);
  }
  data.issueRuns = runs;
  data.issueRelays = [...relays.values()];
  for (const r of runs.values()) {
    const proj = data.projects.find((x) => r.projectPath && norm(x.path) === norm(r.projectPath)) || (issueWorktreeOwner(r.dir, data.projects) || {}).project;
    if (!proj) continue;
    const tabs = await safe(() => muxy.tabs.list({ project: proj.id }), []);
    const tab = tabs.find((t) => t.id === r.tabId);
    if (!tab) continue;
    for (const a of data.muxyAgents) if ((tab.paneIDs || []).includes(a.paneID)) { a.projectID = proj.id; a.worktreeID = proj.id; a.where = r.branch; a.issueRun = r; }
  }
}

/* Muxy's agents plus XITA processes found by scanXita(); everything else reads data.agents.
 * Before: a row was labelled with the terminal tab's title, which is whatever first line the agent was handed, and XITA
 *         rows always showed "XITA · <folder>".
 * Now: an issue run's own number and title win, then the number and title parsed out of the issue prompt, then the tab
 *      title, and only a XITA row with none of those falls back to its folder.
 * Why: the section should say what is being worked on. The tab title belongs to the agent and it may be the opening words
 *      of a prompt, or a slash command typed last.
 * Affects: row labels in the Agents section. The agent's own title stays in the row's hover tooltip. */
function mergeAgents() {
  // local XITA only: a remote server often has the very same folder paths, and its agents come from its own cache
  const xita = xitaAsAgents(data.xita, data.projects.filter((x) => !isRemote(x)), data.worktrees, data.panes || [], data.paneScreen);
  const muxyLocal = (data.muxyAgents || []).filter((a) => { const p = data.projects.find((x) => x.id === a.projectID); return !(p && serverOfProject(p)); });
  data.remoteAgents = cachedRemoteAgents();
  data.agents = [...muxyLocal, ...(data.remoteAgents || []), ...xita];
  // subagents have no process or pane of their own: hang them under their parent's row
  const kids = data.xitaChildren || [];
  if (kids.length) {
    const withKids = [];
    for (const a of data.agents) {
      withKids.push(a);
      if (!a.sess) continue;
      for (const c of kids.filter((k) => k.parent === a.sess).sort((x, y) => y.mtime - x.mtime)) {
        // a finished subagent is tidied away five minutes after its last write, or right away when dismissed
        if (data.subHidden[c.child]) continue;
        if (c.done && Date.now() - c.mtime * 1000 > 300000) continue;
        withKids.push({ paneID: "sub:" + c.child, sub: true, childID: c.child, parentSess: c.parent, parentPane: a.paneID, providerID: "xita", status: c.state, done: c.done, external: true, cwd: a.cwd, projectID: a.projectID, worktreeID: a.worktreeID, where: a.where, title: c.description, kind: c.kind });
      }
    }
    data.agents = withKids;
  }
  const tabOf = new Map((data.panes || []).map((p) => [p.id, p.tabID]));
  for (const a of data.agents) {
    const alias = data.agentAlias[a.sub ? "sub:" + a.childID : a.sess || a.paneID];
    if (alias) { data.agentTitles[a.paneID] = alias; continue; }
    if (a.remote) { data.agentTitles[a.paneID] = a.title || "agent"; continue; } // a cached remote row carries its own title
    if (a.sub) { data.agentTitles[a.paneID] = a.title || tr("하위 작업"); continue; }
    const run = a.issueRun || (data.issueRuns || new Map()).get(tabOf.get(a.paneID));
    const issue = run ? [run.num, run.title] : [a.issueNum, a.issueTitle];
    const label = issue.filter(Boolean).join(" ");
    if (label) { data.agentTitles[a.paneID] = label; continue; }
    if (a.external && (!a.paneMatched || !data.agentTitles[a.paneID])) data.agentTitles[a.paneID] = a.title || "XITA · " + base(a.cwd);
  }
}

/* Reads the status line of every pane in a folder where a XITA process runs, and keeps the session id it prints.
 * This is what turns a pane into a XITA row (see xitaAsAgents), so it runs before the rows are built.
 * Before: only folders with an unpaired row were read, and the answer was a correction applied after the title match.
 * Now: every such pane is read, at most once every 10 s, and the rows are built from the answer.
 * Why: `/new` gives a process a second session and a tab title can be anything, so only the status line identifies it.
 * Affects: XITA rows. Reading a terminal asks once per extension; until allowed, rows fall back to one per process. */
async function pairXitaByScreen() {
  const procs = (data.xita && data.xita.procs) || [];
  if (!procs.length) return;
  const folders = new Set(procs.map((p) => norm(p.cwd)));
  const cand = (data.panes || []).filter((p) => folders.has(norm(p.workingDirectory || "")));
  const now = Date.now();
  let changed = false;
  for (const p of cand) {
    const seen = data.paneScreen.get(p.id);
    if (seen && now - seen.at < 10000) continue;
    const text = await safe(() => muxy.panes.readScreen(p.id, 12), null, true);
    if (!text) continue;
    const ids = String(text).match(/\b[0-9a-f]{11}-[0-9a-f]{6}\b/g) || [];
    const before = seen ? seen.ids.join(",") : null;
    data.paneScreen.set(p.id, { at: now, ids });
    if (before !== ids.join(",")) changed = true;
  }
  if (changed) { mergeAgents(); render(); }
}

/* Posts what running issue agents have put in their outbox. The agent holds no tracker key; this is the only path from
 * an agent's words to the tracker, and it checks each line against the issues and the review state of that run.
 * Runs on the sidebar's timer so it works with the Issues tab closed. Silent until the shell calls are allowed. */
async function relayIssueOutboxes() {
  const relays = data.issueRelays || [];
  if (!relays.length) return;
  let posted = 0;
  for (const run of relays) {
    const r = await safe(() => relayIssueOutbox(run), null, true);
    if (r && r.posted) posted += r.posted;
  }
  if (posted) { await attachIssueRuns(); render(); }
}

/* One tick of the XITA scan; XITA emits no Muxy events, so it runs on a timer (see main.js). Silent until the scan is allowed.
 * Before: one scan per tick, wherever `muxy.exec` runs — the server of the project Muxy is showing. With a remote
 *         server selected that read the remote server instead of this Mac, so the Agents section flipped between the
 *         local agents and one remote server's agents and never showed both.
 * Now: this Mac is always read (pinned to the local server while a remote one is selected). The remote connection
 *      being viewed is read through a connection that already exists — Muxy's own while one of its projects is
 *      selected (that is where `scanXita()` lands), or one short `muxy --host` run while its terminal tab is the
 *      active tab, at most every 30 seconds; the result is cached (see the remote agents block above).
 * Why: the owner wants local and remote agents in the section together, without background polling.
 * Affects: the Agents section. A failed read keeps the previous data. */
let xitaBusy = false;
async function refreshXita() {
  relayIssueOutboxes();
  if (xitaBusy) return;
  xitaBusy = true;
  try {
    const viewed = viewedServer();
    const native = viewed && viewed.how === "native" ? viewed.server : null;
    const localProject = data.projects.find((p) => !isRemote(p));
    // scanXita() lands on the server Muxy is showing: that is the remote read while a remote server is selected
    const [ctx, local] = await Promise.all([
      safe(() => scanXita(), null, true),
      native ? safe(() => scanXitaOn(null, localProject && localProject.id), null, true) : Promise.resolve(undefined),
    ]);
    if (native && ctx) rememberXita(native, ctx, Date.now());
    else if (viewed && viewed.how === "tui" && Date.now() - cacheOf(viewed.server).at >= 30000) {
      // the terminal connection tab: its own ssh is busy in the terminal, so one short separate run, at most every 30 s
      const scan = await safe(() => scanXitaOn(viewed.server, remoteExecProject(viewed.server)), null, true);
      if (scan) rememberXita(viewed.server, scan, Date.now());
    }
    const found = native ? local : ctx;
    if (!found) return;
    const kids = await safe(() => scanXitaChildren(), [], true);
    const key = JSON.stringify(found) + "|" + JSON.stringify(kids);
    if (key === data.xitaKey) return;
    data.xitaKey = key; data.xita = found; data.xitaChildren = kids;
    mergeAgents(); render();
    pairXitaByScreen();
  } finally {
    xitaBusy = false;
  }
}

/* The terminal pane Muxy has focused right now (id and folder); the agent list marks the agent that lives in it. */
async function refreshFocus() {
  const panes = await safe(() => muxy.panes.list(), null, true);
  if (!panes) return;
  data.panes = panes; // XITA rows are built from these panes' status lines (see pairXitaByScreen)
  const f = panes.find((x) => x.isFocused);
  const focus = f ? { paneID: f.id, cwd: f.workingDirectory || "", title: f.title || "" } : null;
  if (JSON.stringify(focus) !== JSON.stringify(data.focus)) { data.focus = focus; mergeAgents(); render(); pairXitaByScreen(); }
}

async function refreshTabs() {
  refreshFocus();
  // tabs are only needed for projects whose row is open
  const open = data.projects.filter(isOpen);
  const entries = await pool(open, async (p) => [p.id, await safe(() => muxy.tabs.list({ project: p.id }), [])]);
  data.projectTabs = Object.fromEntries(entries);
  render();
}

/* Which sidebars can be active (built-in + extensions providing one) and which is. Cached for the ⋯ menu. */
async function refreshSidebars() {
  try {
    data.sidebars = await listSidebars();
  } catch (e) {
    console.warn("sidebar list unreadable: " + String((e && e.message) || e));
  }
}

/* Remote servers are listed in Muxy's settings; `muxy config get servers --json` reads them. */
/* Configured remote servers, listed in Muxy's settings; `muxy config get servers --json` reads them.
 * Before: read once at start-up and on "서버 목록 다시 읽기". A failed read (Muxy busy just after an extension reload
 *         answered "no response" / "servers: is not a setting") left data.servers empty for the whole session, which
 *         silently removed every remote feature: the connection groups, the cached remote agents, the Remote section.
 * Now: a failed read is retried with backoff (5 s, doubling, at most 60 s apart) until it succeeds.
 * Why: the owner saw the remote agents vanish right after a reload.
 * Affects: data.servers only; nothing else reads the server list. */
let serversFailures = 0;
async function refreshServers() {
  try {
    const r = await muxyCLI(["config", "get", "servers", "--json"], { timeoutMs: 15000 });
    if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`);
    data.servers = JSON.parse(r.stdout || "[]");
    serversFailures = 0;
  } catch (e) {
    console.warn("remote servers unreadable: " + String((e && e.message) || e));
    data.servers = [];
    schedule("servers", refreshServers, Math.min(60000, 5000 * 2 ** serversFailures++));
    return;
  }
  render();
  await syncRemote();
}

/* Agents of the remote connections.
 * Before: a 30-second poll ran `activity list` over SSH on every configured server. It opened a connection to each
 *         machine all the time, and it only ever saw agents Muxy itself knows (Claude, Codex, …) — never XITA.
 * Now: nothing polls. The last read of each connection is cached here (extension storage "remoteAgents", so the
 *      groups survive a reload) and stays on screen with its age. It is refreshed only while that connection is being
 *      viewed (see viewedServer), through a connection that already exists: Muxy's own while one of its projects is
 *      selected, or one short `muxy --host` run while its terminal connection tab is the active tab. The group header's
 *      menu can force one read.
 * Why: the owner wants local and remote agents in one section, and no background connecting to every server.
 * Affects: the Agents section and the blink marks on remote project rows. Rows of a connection that is not being
 *          viewed may be out of date; the header shows when they were read. */
const cacheOf = (s) => (data.remoteCache[s.id] = data.remoteCache[s.id] || { at: 0, xita: [], muxy: [] });
const saveRemoteCache = () => safe(() => muxy.storage.set("remoteAgents", data.remoteCache), undefined, true);
function cachedRemoteAgents() {
  const out = [];
  for (const s of data.servers) {
    const c = data.remoteCache[s.id];
    if (!c) continue;
    for (const kind of ["muxy", "xita"]) for (const r of c[kind] || []) out.push({ ...r, remote: true, server: s });
  }
  return out;
}
/* The connection Muxy is showing right now, and how. "native": the current project is one of its projects, so Muxy
 * holds the connection and `muxy.exec` runs there. "tui": its terminal connection tab is the active tab; that tab has
 * its own ssh, and `muxy.exec` still runs on this Mac. */
function viewedServer() {
  const cur = data.projects.find(isCurrent);
  const native = cur ? serverOfProject(cur) : null;
  if (native) return { server: native, how: "native" };
  for (const s of data.servers) {
    const id = state.serverTabs[s.id];
    if (id && (data.projectTabs[cur && cur.id] || []).some((t) => t.id === id && t.isActive)) return { server: s, how: "tui" };
  }
  return null;
}
const remoteExecProject = (s) => { const p = data.projects.find((x) => serverOfProject(x) === s); return p ? p.id : null; };

/* One read of a connection's XITA agents becomes its cached rows. */
function rememberXita(s, scan, now) {
  const rows = xitaAsAgents(scan, data.projects.filter((x) => serverOfProject(x) === s), {}, [], null)
    .map((r) => ({ ...r, paneID: "srv:" + s.id + ":" + r.paneID, remote: true, serverId: s.id, title: r.title || "XITA · " + base(r.cwd) }));
  const c = cacheOf(s);
  const changed = JSON.stringify(c.xita) !== JSON.stringify(rows);
  const due = now - (c.at || 0) >= 30000; // the age label works in minutes, so the timestamp need not be written every tick
  c.at = now;
  if (!changed && !due) return;
  c.xita = rows;
  saveRemoteCache();
  if (changed) { mergeAgents(); render(); }
}
/* The agents Muxy itself knows on the connection it is showing (from muxy.agents.list), kept with that connection's
 * cache so they stay listed after the selection moves back to this Mac. */
function rememberRemoteMuxy() {
  const viewed = viewedServer();
  if (!viewed || viewed.how !== "native") return;
  const s = viewed.server;
  const rows = data.muxyAgents
    .map((a) => ({ a, p: data.projects.find((x) => x.id === a.projectID) }))
    .filter(({ p }) => p && serverOfProject(p) === s)
    .map(({ a, p }) => ({ paneID: "srv:" + s.id + ":" + a.paneID, providerID: a.providerID, status: a.status, projectID: a.projectID, remote: true, serverId: s.id, title: `${(AGENT_BRAND[a.providerID] || [])[2] || a.providerID || "agent"} · ${p.name}` }));
  const c = cacheOf(s);
  if (JSON.stringify(c.muxy) === JSON.stringify(rows)) return;
  c.muxy = rows;
  saveRemoteCache();
}
/* One forced read of a connection's XITA agents (the group header's menu): the only case that opens an ssh
 * connection without the connection being viewed. */
async function rescanRemoteServer(s) {
  if (!remoteExecProject(s)) throw new Error(tr("이 서버의 프로젝트를 아직 읽지 못했어요 · 잠시 뒤 다시 시도해 주세요"));
  const scan = await scanXitaOn(s, remoteExecProject(s));
  if (!scan) throw new Error(tr("원격 서버의 에이전트를 읽지 못했어요"));
  rememberXita(s, scan, Date.now());
}

/* Which server each project belongs to is not in the extension API (ProjectInfo has no server field), so it is read
 * (read-only) from Muxy's own state file like the workspace membership above: id, server_id and the home flag of every
 * project. The command text never changes, so Muxy asks for approval once. */
const PROJECT_META_SHELL = `f="$HOME/Library/Application Support/Muxy 2/desktop-state.json"; [ -f "$f" ] || f="$HOME/Library/Application Support/Muxy/desktop-state.json"; /usr/bin/python3 -c 'import json, sys
for p in json.load(open(sys.argv[1])).get("projects", []):
    if p.get("parent_id"):
        continue
    print(p.get("id", ""), p.get("server_id") or "-", "1" if p.get("home") else "0", sep=chr(9))' "$f"`;
let remoteBusy = false;
let remoteMetaKey = null;
let remoteMetaFailAt = 0;

/* Reads the project → server map when the project list changed.
 * Before: every project was treated as local. The projects of a remote server were drawn in 미분류 next to the local
 *         ones, and a remote Home whose folder path equals this Mac's was pinned on top as a second Home.
 * Now: each project knows its server, so the sidebar draws them under their connection (remoteGroups in view.js) and
 *      only a local project can be Home. Nothing is changed in Muxy: it refuses to attach an SSH project to a
 *      workspace ("home and SSH workspace projects cannot be attached to a workspace"), so the group is visual only.
 * Why: the owner asked for remote projects to be grouped under their connection name automatically.
 * Affects: how and where remote projects are drawn; local projects and Muxy workspaces are untouched.
 *          A refused or failed read is not retried for five minutes, so nobody is asked on every focus change. */
async function syncRemote() {
  if (remoteBusy) return;
  remoteBusy = true;
  let redraw = false;
  try {
    const key = data.projects.map((p) => p.id).join(",");
    if (key !== remoteMetaKey && Date.now() - remoteMetaFailAt >= 300000) {
      const r = await safe(() => muxy.exec({ shell: PROJECT_META_SHELL, timeoutMs: 15000 }), null, true);
      if (!r || r.exitCode !== 0) { remoteMetaFailAt = Date.now(); return; }
      const meta = {};
      for (const line of String(r.stdout || "").split("\n")) {
        const cols = line.trim().split("\t");
        if (cols.length >= 3 && cols[0]) meta[cols[0]] = { server: cols[1] !== "-" ? cols[1] : null, home: cols[2] === "1" };
      }
      remoteMetaKey = key;
      if (JSON.stringify(meta) !== JSON.stringify(data.projectMeta)) { data.projectMeta = meta; redraw = true; }
    }
  } finally {
    remoteBusy = false;
  }
  if (redraw) render();
}

/* The same read started in the background, where a pending approval must not hold up the list: nothing is awaited. */
const syncRemoteSoon = () => syncRemote().catch((e) => console.warn("remote projects not synced: " + String((e && e.message) || e)));

/* Remote connections. Everything here opens an SSH connection, so it only runs on a user action. */
async function remoteCLI(s, args, timeoutMs = 25000) {
  const r = await muxyCLI(["--host", s.ssh, ...args], { timeoutMs });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.exitCode}`).trim());
  return r.stdout;
}

async function checkServer(s) {
  data.serverStatus[s.id] = "checking";
  render();
  try { await remoteCLI(s, ["server", "status"], 20000); data.serverStatus[s.id] = "online"; }
  catch { data.serverStatus[s.id] = "offline"; }
  render();
}

/* The CLI has no "attach", and `session show` cannot take --host, so a remote terminal is opened the way a user
 * would: a local terminal tab running the muxy terminal UI against that server. Without a folder that is the
 * server's UI itself; with a folder it also starts a NEW terminal there (so only an explicit ＋ passes one). */
const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
/* Before: the connection tab was titled after the program that runs in it ("muxy").
 * Now: the connection tab carries the connection's name (TabRequest has no title field, so it is renamed right after
 *      it opens; the rename is cosmetic, so a failure leaves the tab as it is).
 * Why: the owner could not tell connections apart by their tab titles.
 * Affects: the tab opened for a connection without a project folder; terminals opened in a server project keep theirs. */
async function openServerTerminal(s, folder) {
  const cmd = [MUXY_BINS[0], "--host", s.ssh, ...(folder ? [folder] : [])].map(shellQuote).join(" ");
  const id = await muxy.tabs.open({ kind: "terminal", command: cmd });
  if (!folder) await safe(() => muxy.tabs.rename(id, s.name), undefined, true);
  return id;
}

/* A tab by id, searched in the current project first (where it was opened), then in the others. */
async function findTab(id) {
  const here = await safe(() => muxy.tabs.list(), []);
  if (here.some((t) => t.id === id)) return data.projects.find((p) => isCurrent(p)) || {};
  const found = await pool(data.projects, async (p) => ((await safe(() => muxy.tabs.list({ project: p.id }), [])).some((t) => t.id === id) ? p : null));
  return found.find(Boolean) || null;
}

/* Clicking a connection opens it once: one tab per server. If that tab is still there, it is focused instead of
 * opening another; the remembered tab id lives in extension storage so it survives a reload. */
async function openServerConnection(s) {
  const known = state.serverTabs[s.id];
  if (known) {
    const owner = await findTab(known);
    if (owner) {
      if (owner.id && !isCurrent(owner)) await muxy.projects.switchTo(owner.id);
      await muxy.tabs.switchTo(known);
      return;
    }
  }
  state.serverTabs[s.id] = await openServerTerminal(s);
  await save();
}

/* ＋ on a connection: an additional NEW terminal in that server's project folder. */
async function createServerSession(s) {
  const projects = JSON.parse((await remoteCLI(s, ["project", "list", "--json"])) || "[]");
  const list = Array.isArray(projects) ? projects : projects.projects || [];
  if (!list.length) throw new Error(tr("이 서버에는 프로젝트가 없어요"));
  let target = list[0];
  if (list.length > 1) {
    const picked = await muxy.modal.open({ placeholder: tr("{0}에 새 터미널을 만들 프로젝트", s.name), items: list.map((p) => ({ id: p.id, title: p.name, subtitle: p.directory })) });
    if (!picked) return;
    target = list.find((p) => p.id === picked.id);
  }
  await openServerTerminal(s, target.directory);
}

async function refreshUI() {
  data.workspaces = await safe(() => muxy.workspaces.list(), []);
  render();
}

const timers = {};
function schedule(name, fn, wait = 120) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(fn, wait);
}

/* ---------- derived ---------- */

/* The workspace (group) a project belongs to, or undefined. */
function groupOf(id) {
  return data.workspaces.find((w) => (data.members[w.id] || []).includes(id));
}

const kindMeta = (id) => {
  const k = state.kinds[id];
  return k && typeof k === "object" ? k : k ? { kind: k } : null;
};

function agentStatus(match) {
  let s = null;
  for (const a of data.agents) {
    if (!match(a)) continue;
    if (a.status === "waiting") return "waiting";
    if (a.status === "working") s = "working";
    else if (!s) s = "idle";
  }
  return s;
}

/* Turns a group's projects into display rows.
 *  - a scanned project under another project of the group is indented beneath it (repo > submodule);
 *  - scanned projects whose picked folder is not itself a project sit under a folder row.
 * Projects added any other way stay flat, so a project like ~/ never swallows the rest. */
function layoutRows(members) {
  const parentOf = new Map();
  const folderOf = new Map();
  for (const p of members) {
    const m = kindMeta(p.id);
    if (!m) continue;
    let best = null;
    for (const q of members) {
      if (q.id === p.id) continue;
      if (norm(p.path).startsWith(norm(q.path) + "/") && (!best || q.path.length > best.path.length)) best = q;
    }
    if (best) parentOf.set(p.id, best.id);
    else if (m.root && norm(m.root) !== norm(p.path)) folderOf.set(p.id, norm(m.root));
  }
  const out = [];
  const walk = (p, depth) => {
    out.push({ type: "project", project: p, depth });
    members.filter((m) => parentOf.get(m.id) === p.id).forEach((c) => walk(c, depth + 1));
  };
  const seen = new Set();
  for (const p of members) {
    if (parentOf.has(p.id)) continue;
    const f = folderOf.get(p.id);
    if (!f) { walk(p, 0); continue; }
    if (seen.has(f)) continue;
    seen.add(f);
    const kids = members.filter((m) => !parentOf.has(m.id) && folderOf.get(m.id) === f);
    out.push({ type: "folder", root: f, name: base(f), count: kids.length, depth: 0 });
    if (normQuery() || !state.collapsed["f:" + f]) kids.forEach((k) => walk(k, 1)); // results are never hidden inside a folded folder
  }
  return out;
}

/* ---------- group (workspace) mutations ---------- */

/* Projects of a workspace, in Muxy's own project order. */
function projectsIn(wsID) {
  const ids = new Set(data.members[wsID] || []);
  return data.projects.filter((p) => ids.has(p.id) && !isHome(p));
}

/* Recent-activity score of a group (a workspace or a remote connection's projects): the newest position in Muxy's
 * focus history (oldest first) among the panes of its member projects; -1 when none of them appears in the history. */
function groupActivity(members) {
  const ids = new Set(members.map((p) => p.id));
  let best = -1;
  (data.focusHistory || []).forEach((paneID, i) => {
    const pane = data.panes.find((x) => x.id === paneID);
    if (pane && ids.has(pane.projectID)) best = i;
  });
  return best;
}

/* Moves a project into a workspace (UNGROUPED = none). With refID it is also placed before/after that
 * project in Muxy's manual project order, which is what every list in this sidebar follows. */
async function moveProject(id, toGroup, refID = null, after = false) {
  const cur = groupOf(id);
  const curID = cur ? cur.id : UNGROUPED;
  if (curID !== toGroup) {
    if (curID !== UNGROUPED) await muxy.projects.detach(id);
    if (toGroup !== UNGROUPED) await muxy.projects.attach(id, toGroup);
    // optimistic update; the state file is re-read right after
    for (const k of Object.keys(data.members)) data.members[k] = data.members[k].filter((x) => x !== id);
    if (toGroup !== UNGROUPED) (data.members[toGroup] = data.members[toGroup] || []).push(id);
    const m = kindMeta(id);
    if (m && m.root) { state.kinds[id] = { kind: m.kind }; save(); } // left its folder, so it no longer hangs under that folder row
  }
  // Muxy can refuse a reorder (e.g. "the home project cannot be modified"). The group move above has
  // already succeeded, so a refused reorder must not stop the refresh below.
  if (refID && refID !== id) await reorderProject(id, refID, after).catch((e) => console.warn("reorder refused: " + String((e && e.message) || e)));
  render();
  schedule("members", refreshMembers, 800);
}

/* Reorders Muxy's manual project order. */
async function reorderProject(id, refID, after) {
  if (isHome(data.projects.find((p) => p.id === id) || {})) return;
  // Muxy refuses any reorder that includes the Home project, which always stays first
  const ids = data.projects.filter((p) => !isHome(p)).map((p) => p.id).filter((x) => x !== id);
  const at = ids.indexOf(refID);
  ids.splice(at < 0 ? ids.length : at + (after ? 1 : 0), 0, id);
  await muxy.projects.reorder(ids);
  await muxy.projects.sort("manual");
  data.projects = await muxy.projects.list();
}

async function createGroup(presetName) {
  const name = presetName ?? (await muxy.dialog.prompt({ title: tr("새 그룹(워크스페이스) 이름"), placeholder: tr("예: Acme") }));
  if (!name || !name.trim()) return null;
  const id = await muxy.workspaces.create(name.trim());
  data.members[id] = [];
  await refreshUI();
  return { id, name: name.trim() };
}

async function renameGroup(id) {
  const g = data.workspaces.find((x) => x.id === id);
  const name = await muxy.dialog.prompt({ title: tr("그룹 이름 변경"), placeholder: g.name });
  if (!name || !name.trim()) return;
  await muxy.workspaces.rename(id, name.trim());
  await refreshUI();
}

/* Projects are detached first so deleting the workspace can never take a project with it. */
async function deleteGroup(id) {
  const g = data.workspaces.find((x) => x.id === id);
  const count = (data.members[id] || []).length;
  const choice = await muxy.dialog.confirm({
    title: tr("\"{0}\" 그룹을 삭제할까요?", g.name),
    message: tr("Muxy 워크스페이스가 삭제돼요.{0} 프로젝트와 폴더는 지워지지 않아요.", count ? tr(" 안의 프로젝트 {0}개는 미분류로 빠지고,", count) : ""),
    buttons: [tr("삭제"), tr("취소")], default: tr("취소"), cancel: tr("취소"),
  });
  if (choice !== tr("삭제")) return;
  for (const pid of data.members[id] || []) await muxy.projects.detach(pid);
  await muxy.workspaces.delete(id);
  delete state.collapsed[id];
  await save();
  data.members[id] = [];
  await refreshUI();
  await refreshMembers();
}
