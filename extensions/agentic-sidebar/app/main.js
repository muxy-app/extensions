import "./styles.css";

const muxy = window.muxy;

const state = {
  projects: [],
  git: new Map(),
  worktrees: new Map(),
  expanded: new Set(),
  agents: new Map(),
  filter: "",
  loadingWorktrees: new Set(),
};

const els = {
  root: document.getElementById("root"),
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  emptyText: document.getElementById("empty-text"),
  footer: document.getElementById("footer"),
  agentDot: document.getElementById("agent-dot"),
  agentSummary: document.getElementById("agent-summary"),
  search: document.getElementById("search"),
  searchClear: document.getElementById("search-clear"),
  refresh: document.getElementById("refresh"),
};

const STATUS_RANK = { working: 3, waiting: 2, idle: 1 };

async function safely(call, fallback) {
  try {
    return (await call()) ?? fallback;
  } catch {
    return fallback;
  }
}

/** An SVG icon from path strings and `{ circle: [cx, cy, r] }` shapes. */
function icon(shapes, options = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", options.viewBox || "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  for (const shape of [].concat(shapes)) {
    const node = document.createElementNS(ns, shape.circle ? "circle" : "path");
    if (shape.circle) {
      node.setAttribute("cx", shape.circle[0]);
      node.setAttribute("cy", shape.circle[1]);
      node.setAttribute("r", shape.circle[2]);
    } else {
      node.setAttribute("d", shape);
    }
    svg.appendChild(node);
  }
  return svg;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The ways an agent status can name a worktree. */
function worktreeKeys(worktree) {
  if (!worktree) return [];
  return ["id", "worktreeID", "path", "branch"]
    .filter((key) => worktree[key])
    .map((key) => String(worktree[key]));
}

function agentFor(keys) {
  for (const key of keys) {
    const agent = state.agents.get(key);
    if (agent) return agent;
  }
  return null;
}

function statusClass(status) {
  if (status === "working") return "is-working";
  if (status === "waiting") return "is-waiting";
  return "is-idle";
}

async function loadProjects() {
  const projects = await safely(() => muxy.projects.list(), []);
  state.projects = projects.map((project) => ({
    id: project.id ?? project.identifier ?? project.path ?? project.name,
    name: project.name ?? project.title ?? project.id ?? "Project",
    path: project.path ?? project.directory ?? null,
    isActive: Boolean(project.isActive ?? project.active),
  }));
}

function projectKey(projectId) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  return project?.path || project?.id || projectId;
}

async function loadGit(projectId) {
  const status = await safely(
    () => muxy.git.status({ project: projectKey(projectId), local: true }),
    null,
  );
  if (!status) {
    state.git.set(projectId, null);
    return;
  }
  const dirty = (status.stagedFiles?.length ?? 0) + (status.unstagedFiles?.length ?? 0) > 0;
  state.git.set(projectId, {
    branch: status.branch ?? status.currentBranch ?? null,
    dirty,
    ahead: status.aheadBehind?.ahead ?? 0,
    behind: status.aheadBehind?.behind ?? 0,
  });
}

async function loadWorktrees(projectId) {
  if (state.loadingWorktrees.has(projectId)) return;
  state.loadingWorktrees.add(projectId);
  const worktrees = await safely(() => muxy.git.worktrees({ project: projectKey(projectId) }), []);
  state.worktrees.set(
    projectId,
    worktrees.map((worktree) => ({
      id: worktree.id ?? worktree.path,
      path: worktree.path,
      branch: worktree.branch ?? (worktree.isDetached ? "detached" : worktree.head?.slice(0, 7)) ?? "—",
      isActive: Boolean(worktree.isActive),
    })),
  );
  state.loadingWorktrees.delete(projectId);
}

function recordAgent(agent) {
  const status = agent.status ?? "idle";
  const providerID = agent.providerID ?? agent.provider ?? null;
  for (const key of [agent.worktreeID, agent.worktreePath, agent.path, agent.projectID]) {
    if (key) state.agents.set(String(key), { status, providerID });
  }
}

async function loadAgents() {
  const agents = await safely(() => muxy.agents.list(), []);
  state.agents.clear();
  for (const agent of agents) recordAgent(agent);
}

function gitMeta(git) {
  const meta = el("div", "row-meta");
  if (!git || !git.branch) return meta;
  meta.appendChild(el("span", "branch", git.branch));
  if (git.dirty) meta.append(el("span", "dot-sep", "·"), el("span", "git-dirty", "●"));
  if (git.ahead) meta.appendChild(el("span", "git-stat", `⇡${git.ahead}`));
  if (git.behind) meta.appendChild(el("span", "git-stat", `⇣${git.behind}`));
  return meta;
}

function statusDot(agent) {
  const dot = el("span", "dot");
  dot.classList.add(statusClass(agent?.status));
  if (agent?.status) dot.title = agent.providerID ? `${agent.providerID}: ${agent.status}` : agent.status;
  return dot;
}

function openButton({ current, onClick, title }) {
  const button = el("button", "open-btn");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  if (current) button.classList.add("is-current");
  button.appendChild(icon(current ? [{ circle: [8, 8, 3] }] : ["M6 3 L11 8 L6 13"]));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** A project's most active agent, across the project and its worktrees. */
function projectAgent(projectId) {
  let best = state.agents.get(String(projectId)) || null;
  for (const worktree of state.worktrees.get(projectId) || []) {
    const agent = agentFor(worktreeKeys(worktree));
    if (agent && (!best || (STATUS_RANK[agent.status] || 0) > (STATUS_RANK[best.status] || 0))) {
      best = agent;
    }
  }
  return best;
}

function projectRow(project) {
  const container = el("div", "project");
  if (state.expanded.has(project.id)) container.classList.add("is-open");

  const row = el("div", "row");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  if (project.isActive) row.classList.add("is-active");

  const chevron = el("span", "chevron");
  chevron.appendChild(icon(["M5 3 L10 8 L5 13"]));
  row.appendChild(chevron);
  row.appendChild(statusDot(projectAgent(project.id)));

  const main = el("div", "row-main");
  main.appendChild(el("div", "row-title", project.name));
  main.appendChild(gitMeta(state.git.get(project.id)));
  row.appendChild(main);

  const trail = el("div", "row-trail");
  trail.appendChild(
    openButton({
      current: project.isActive,
      title: project.isActive ? "Active project" : "Switch to project",
      onClick: () => switchProject(project),
    }),
  );
  row.appendChild(trail);

  const toggle = () => toggleProject(project.id);
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    } else if (
      (event.key === "ArrowRight" && !state.expanded.has(project.id)) ||
      (event.key === "ArrowLeft" && state.expanded.has(project.id))
    ) {
      toggleProject(project.id);
    }
  });
  container.appendChild(row);

  const worktrees = el("div", "worktrees");
  if (state.expanded.has(project.id)) renderWorktrees(worktrees, project);
  container.appendChild(worktrees);
  return container;
}

function renderWorktrees(container, project) {
  const worktrees = state.worktrees.get(project.id);
  if (worktrees === undefined) {
    container.appendChild(el("div", "wt-empty", "Loading…"));
    return;
  }
  if (worktrees.length === 0) {
    container.appendChild(el("div", "wt-empty", "No worktrees"));
    return;
  }
  if (worktrees.length === 1) {
    container.appendChild(el("div", "wt-empty", "No additional worktrees"));
    return;
  }
  for (const worktree of worktrees) {
    const item = el("div", "worktree");
    const row = el("div", "row");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    if (worktree.isActive) row.classList.add("is-active");

    const rail = el("span", "worktree-rail");
    rail.appendChild(icon(["M5 0 V9 a3 3 0 0 0 3 3 H11"], { viewBox: "0 0 16 16" }));
    row.appendChild(rail);
    const agent = agentFor(worktreeKeys(worktree));
    row.appendChild(statusDot(agent));

    const main = el("div", "row-main");
    main.appendChild(el("div", "row-title", worktree.branch || "—"));
    row.appendChild(main);

    const trail = el("div", "row-trail");
    if (agent?.providerID) trail.appendChild(el("span", "provider", agent.providerID));
    trail.appendChild(
      openButton({
        current: worktree.isActive,
        title: worktree.isActive ? "Active worktree" : "Switch to worktree",
        onClick: () => switchWorktree(project, worktree),
      }),
    );
    row.appendChild(trail);

    const open = () => switchWorktree(project, worktree);
    row.addEventListener("dblclick", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        open();
      }
    });
    item.appendChild(row);
    container.appendChild(item);
  }
}

function render() {
  const filter = state.filter.trim().toLowerCase();
  const shown = filter
    ? state.projects.filter((project) => project.name.toLowerCase().includes(filter))
    : state.projects;
  els.list.replaceChildren(...shown.map(projectRow));

  const none = state.projects.length === 0;
  const unmatched = !none && shown.length === 0;
  els.empty.hidden = !(none || unmatched);
  els.list.hidden = none || unmatched;
  if (unmatched) els.emptyText.textContent = "No matching projects";
  else if (none) els.emptyText.textContent = "No projects";
  renderSummary();
}

function renderSummary() {
  let working = 0;
  let waiting = 0;
  for (const agent of state.agents.values()) {
    if (agent.status === "working") working += 1;
    else if (agent.status === "waiting") waiting += 1;
  }
  const active = working + waiting;
  els.agentDot.classList.toggle("is-idle", active === 0);
  if (active === 0) {
    els.agentSummary.textContent = "No active agents";
    return;
  }
  const parts = [];
  if (working) parts.push(`${working} working`);
  if (waiting) parts.push(`${waiting} waiting`);
  els.agentSummary.textContent = parts.join(" · ");
}

async function toggleProject(projectId) {
  if (state.expanded.has(projectId)) {
    state.expanded.delete(projectId);
    render();
    return;
  }
  state.expanded.add(projectId);
  if (!state.worktrees.has(projectId)) {
    render();
    await loadWorktrees(projectId);
  }
  render();
}

async function switchProject(project) {
  if (project.isActive) return;
  await safely(() => muxy.projects.switchTo(project.id), null);
  for (const candidate of state.projects) candidate.isActive = candidate.id === project.id;
  render();
}

async function switchWorktree(project, worktree) {
  if (worktree.isActive) return;
  const identifier = worktree.path || worktree.id || worktree.branch;
  await safely(() => muxy.worktrees.switchTo(identifier, project.id), null);
}

function activeProjectId() {
  return state.projects.find((project) => project.isActive)?.id ?? null;
}

function subscribeEvents() {
  if (!muxy.events?.subscribe) return;
  muxy.events.subscribe("agent.status", (payload) => {
    if (payload) recordAgent(payload);
    render();
  });
  muxy.events.subscribe("project.switched", async (payload) => {
    const projectId = payload?.projectID;
    for (const project of state.projects) {
      project.isActive = project.id === projectId || project.path === projectId;
    }
    if (projectId && state.expanded.has(activeProjectId())) await loadWorktrees(activeProjectId());
    render();
  });
  muxy.events.subscribe("worktree.switched", async (payload) => {
    const projectId = payload?.projectID;
    const project = state.projects.find((candidate) => candidate.id === projectId || candidate.path === projectId);
    if (project) {
      state.worktrees.delete(project.id);
      if (state.expanded.has(project.id)) await loadWorktrees(project.id);
    }
    render();
  });
  let refresh;
  muxy.events.subscribe("file.changed", () => {
    clearTimeout(refresh);
    refresh = setTimeout(async () => {
      const projectId = activeProjectId();
      if (projectId) {
        await loadGit(projectId);
        render();
      }
    }, 400);
  });
}

function detectSurface() {
  const surface = muxy.surface || muxy.surfaceKind || muxy.data?.surface || "panel";
  const sidebar = surface === "sidebar";
  els.root.dataset.surface = sidebar ? "sidebar" : "panel";
  els.footer.hidden = !sidebar;
}

function clearFilter() {
  state.filter = "";
  els.search.value = "";
  els.searchClear.hidden = true;
  render();
  els.search.focus();
}

async function refreshAll() {
  await Promise.all([loadProjects(), loadAgents()]);
  await Promise.all(state.projects.map((project) => loadGit(project.id)));
  await Promise.all(
    [...state.expanded].map((projectId) => {
      state.worktrees.delete(projectId);
      return loadWorktrees(projectId);
    }),
  );
  render();
}

function bindControls() {
  els.search.addEventListener("input", () => {
    state.filter = els.search.value;
    els.searchClear.hidden = state.filter.length === 0;
    render();
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.filter) {
      event.stopPropagation();
      clearFilter();
    }
  });
  els.searchClear.addEventListener("click", clearFilter);
  els.refresh.addEventListener("click", async () => {
    els.refresh.classList.add("is-spinning");
    await refreshAll();
    els.refresh.classList.remove("is-spinning");
  });
  muxy.onFocus?.((focused) => {
    if (focused) els.search.focus();
  });
}

async function start() {
  detectSurface();
  bindControls();
  els.list.replaceChildren(...Array.from({ length: 4 }, () => el("div", "skeleton")));
  await Promise.all([loadProjects(), loadAgents()]);
  render();
  await Promise.all(state.projects.map((project) => loadGit(project.id)));
  render();
  subscribeEvents();
}

start();
