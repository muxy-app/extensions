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
let state = { collapsed: {}, kinds: {}, expanded: {}, sizes: {}, showIdle: false, serverTabs: {}, managerTabs: {}, lastWt: {} };
/* Live data pulled from Muxy. members: workspaceID -> project IDs, read from Muxy's desktop-state.json. */
let data = { projects: [], branches: {}, worktrees: {}, agents: [], muxyAgents: [], xita: null, xitaChildren: [], agentTitles: {}, focus: null, panes: [], issueRuns: new Map(), paneScreen: new Map(), agentAlias: {}, subHidden: {}, projectTabs: {}, workspaces: [], members: {}, membersOK: false, home: null, servers: [], serverStatus: {}, sidebars: null, query: "" };

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
  if (s) state = { collapsed: s.collapsed || {}, kinds: s.kinds || {}, expanded: s.expanded || {}, sizes: s.sizes || {}, showIdle: !!s.showIdle, serverTabs: s.serverTabs || {}, managerTabs: s.managerTabs || {}, lastWt: s.lastWt || {} };
  data.agentAlias = (await safe(() => muxy.storage.get("agentAlias"), {})) || {};
  data.subHidden = (await safe(() => muxy.storage.get("subHidden"), {})) || {};
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
}

/* Workspace membership is not exposed by the extension API, so it is read (read-only) from Muxy's own
 * state file. Writes always go through projects.attach/detach and workspaces.*. */
async function refreshMembers() {
  try {
    const r = await muxy.exec({
      shell: 'f="$HOME/Library/Application Support/Muxy 2/desktop-state.json"; [ -f "$f" ] || f="$HOME/Library/Application Support/Muxy/desktop-state.json"; plutil -extract workspaces json -o - "$f"; echo; echo "$HOME"',
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`);
    const out = r.stdout.trimEnd();
    const cut = out.lastIndexOf("\n");
    data.home = out.slice(cut + 1).trim() || null; // last line is $HOME, used to find the Home project
    data.members = Object.fromEntries(JSON.parse(out.slice(0, cut)).map((w) => [w.id, w.projects || []]));
    data.membersOK = true;
  } catch (e) {
    console.warn("workspace members unreadable: " + String((e && e.message) || e));
    data.membersOK = false;
  }
  render();
  await refreshWorktrees();
  render();
}

/* Registered Muxy worktrees, kept only to know which one is active and to offer "Worktree 전환…". */
async function refreshWorktrees() {
  const targets = data.projects.filter((p) => p.worktreesEnabled);
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

/* The user's Home project is pinned above every group. */
function isHome(p) {
  if (data.home) return norm(p.path) === norm(data.home);
  const homes = data.projects.filter((x) => x.name === "Home");
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
  for (const [k, r] of Object.entries(saved)) {
    runs.set(r.tabId, { num: k.slice(k.indexOf("#") + 1), title: r.title, branch: r.branch, projectPath: r.projectPath, dir: r.dir });
  }
  data.issueRuns = runs;
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
  const xita = xitaAsAgents(data.xita, data.projects, data.worktrees, data.panes || [], data.paneScreen);
  data.agents = [...(data.muxyAgents || []), ...xita];
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

/* XITA does not emit Muxy events, so this runs on a timer (see main.js). Silent when the scan is not allowed yet. */
async function refreshXita() {
  const found = await safe(() => scanXita(), null, true);
  if (found === null) return;
  const kids = await safe(() => scanXitaChildren(), [], true);
  const key = JSON.stringify(found) + "|" + JSON.stringify(kids);
  if (key === data.xitaKey) return;
  data.xitaKey = key; data.xita = found; data.xitaChildren = kids;
  mergeAgents(); render();
  pairXitaByScreen();
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
async function refreshServers() {
  try {
    const r = await muxyCLI(["config", "get", "servers", "--json"], { timeoutMs: 15000 });
    if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`);
    data.servers = JSON.parse(r.stdout || "[]");
  } catch (e) {
    console.warn("remote servers unreadable: " + String((e && e.message) || e));
    data.servers = [];
  }
  render();
}

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
async function openServerTerminal(s, folder) {
  const cmd = [MUXY_BINS[0], "--host", s.ssh, ...(folder ? [folder] : [])].map(shellQuote).join(" ");
  return muxy.tabs.open({ kind: "terminal", command: cmd });
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
