/**
 * Normalized store: full refreshes and targeted events reduce into one state
 * object without mixing source responsibilities (PRD §3.9 #5).
 * Pure reducers — trivially testable; the UI re-renders on replacement.
 */
import { normalizeRuntimeState, BOUNDS } from "./types.js";

/** @returns {import("./types.js").TowerState} */
export function initialState() {
  return {
    projects: [],
    worktreesByProject: new Map(),
    workstreams: new Map(),
    orphanAgents: new Map(), // worktreeID -> agent event seen before inventory knew the worktree
    diagnostics: {
      errors: [],
      subscriptions: [],
      lastFullRefresh: null,
      parserVersion: null,
      permissionProbes: {},
    },
  };
}

/** Stable workstream identity. */
export function wsKey(projectId, worktreeId) {
  return `${projectId}::${worktreeId ?? "root"}`;
}

/**
 * Replace inventory (projects + their worktrees), creating placeholder
 * workstreams. Existing snapshots are preserved keyed by identity.
 */
export function applyInventory(state, projects, worktreesByProject, at = new Date().toISOString()) {
  const next = shallow(state);
  next.projects = [...projects];
  next.worktreesByProject = new Map(worktreesByProject);
  next.workstreams = new Map();
  for (const project of projects) {
    const trees = worktreesByProject.get(project.id) ?? [];
    if (!trees.length) {
      preserveCurrentWorkstream(next, state, project.id, null);
      ensureWorkstream(next, project, null, true);
      continue;
    }
    for (const wt of trees) {
      preserveCurrentWorkstream(next, state, project.id, wt?.id ?? null);
      ensureWorkstream(next, project, wt, !!wt.isActive);
    }
  }
  next.orphanAgents = pruneOrphanAgents(next.orphanAgents, at);
  // Re-attach orphaned agent events now that inventory may know the worktrees.
  for (const [wtId, agent] of [...next.orphanAgents]) {
    const key = findKeyByWorktreeId(next, wtId);
    if (key) {
      patchWorkstreamInPlace(next, key, { agent });
      next.orphanAgents.delete(wtId);
    }
  }
  return next;
}

function ensureWorkstream(state, project, worktree, isActive) {
  const key = wsKey(project.id, worktree?.id ?? null);
  const existing = state.workstreams.get(key);
  if (existing) {
    patchWorkstreamInPlace(state, key, {
      projectName: project.name,
      projectPath: project.path,
      worktreeName: worktree?.name,
      worktreePath: worktree?.path ?? project.path,
      isActiveWorktree: isActive,
      inventoryWarning: worktree?.inventoryWarning,
    });
    return;
  }
  /** @type {import("./types.js").WorkstreamSnapshot} */
  const ws = {
    key,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    worktreeId: worktree?.id,
    worktreeName: worktree?.name,
    worktreePath: worktree?.path ?? project.path,
    isActiveWorktree: isActive,
    inventoryWarning: worktree?.inventoryWarning,
    isGsd: false,
    gsdUnavailableReason: undefined,
    gsd: undefined,
    git: undefined,
    agent: { runtimeState: "unavailable" },
    controlState: "idle",
    refreshedAt: new Date(0).toISOString(),
    freshness: "stale",
  };
  state.workstreams.set(key, ws);
}

/**
 * Merge a fully parsed snapshot for one workstream.
 * @param {string} key
 * @param {{isGsd?:boolean, gsd?:import("./types.js").GsdSnapshot, gsdUnavailableReason?:string,
 *          git?:import("./types.js").GitContext, at?:string, isActiveWorktree?:boolean}} data
 */
export function applyWorkstreamData(state, key, data) {
  const existing = state.workstreams.get(key);
  if (!existing) return state;
  const next = shallow(state);
  const ws = { ...existing };
  if (data.isGsd !== undefined) ws.isGsd = data.isGsd;
  if (data.gsd !== undefined) ws.gsd = data.gsd;
  if (data.gsdUnavailableReason !== undefined) ws.gsdUnavailableReason = data.gsdUnavailableReason;
  if (data.git !== undefined) ws.git = data.git;
  if (data.isActiveWorktree !== undefined) ws.isActiveWorktree = data.isActiveWorktree;
  ws.refreshedAt = data.at ?? new Date().toISOString();
  ws.freshness = "refreshed";
  next.workstreams = new Map(next.workstreams);
  next.workstreams.set(key, ws);
  return next;
}

/**
 * `agent.status` event → update the owning workstream only (FR-021).
 * Unknown worktrees park in `orphanAgents` until inventory catches up.
 */
export function applyAgentEvent(state, evt, at = new Date().toISOString()) {
  const agent = {
    runtimeState: normalizeRuntimeState(evt.status),
    providerId: typeof evt.providerID === "string" ? evt.providerID : undefined,
    paneId: typeof evt.paneID === "string" ? evt.paneID : undefined,
    observedAt: at,
  };
  let key = null;
  if (evt.worktreeID && evt.projectID) key = wsKey(evt.projectID, evt.worktreeID);
  else if (evt.worktreeID) key = findKeyByWorktreeId(state, evt.worktreeID);
  else if (evt.projectID) {
    // Undocumented payload shape: fall back when the project has one obvious workstream.
    const candidates = [...state.workstreams.values()].filter((ws) => ws.projectId === evt.projectID);
    if (candidates.length === 1) key = candidates[0].key;
  }

  const next = shallow(state);
  if (!key || !next.workstreams.has(key)) {
    if (evt.worktreeID) {
      const orphans = pruneOrphanAgents(next.orphanAgents, at);
      orphans.delete(evt.worktreeID);
      orphans.set(evt.worktreeID, agent);
      next.orphanAgents = pruneOrphanAgents(orphans, at);
    }
    return next;
  }
  return patchWorkstream(next, key, { agent });
}

/**
 * Hydrated `agents.list()` result → bulk-normalized overlay (FR-020).
 * Tolerates `{agents:[…]}` wrappers and unknown item shapes (NFR-031/032).
 */
export function applyAgentHydration(state, listResponse, at = new Date().toISOString()) {
  const items = Array.isArray(listResponse)
    ? listResponse
    : Array.isArray(listResponse?.agents)
      ? listResponse.agents
      : [];
  let next = state;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    next = applyAgentEvent(
      next,
      {
        worktreeID: raw.worktreeID ?? raw.worktreeId,
        projectID: raw.projectID ?? raw.projectId,
        paneID: raw.paneID ?? raw.paneId,
        providerID: raw.providerID ?? raw.providerId,
        status: raw.status,
      },
      at,
    );
  }
  return next;
}

/** `file.changed` → mark affected workstream live + record event time (FR-030/031). */
export function applyFileChanged(state, evt, at = new Date().toISOString()) {
  const path = String(evt.path ?? "");
  const projectPath = evt.projectPath ? String(evt.projectPath) : undefined;
  let touched = false;
  /** @type {ReturnType<typeof shallow>} */ let next = state;

  for (const [key, ws] of state.workstreams) {
    const matchesProject = projectPath ? samePath(ws.projectPath, projectPath) : true;
    const relevant = matchesProject && isPlanningPath(path);
    if (!relevant) continue;
    next = next === state ? shallow(state) : next;
    const updated = {
      ...ws,
      lastEventAt: at,
      freshness: ws.isActiveWorktree ? "live" : ws.freshness,
    };
    next.workstreams = new Map(next.workstreams);
    next.workstreams.set(key, updated);
    touched = true;
  }
  return touched ? next : state;
}

/** True when a changed path should trigger a targeted GSD reparse. */
export function isPlanningPath(path) {
  const p = String(path ?? "");
  return p === ".planning" || p.startsWith(".planning/") || p.split("/").includes(".planning");
}

/** `worktree.headChanged` → branch context refresh (FR-033). */
export function applyHeadChanged(state, evt) {
  const key = evt.projectID && evt.worktreeID ? wsKey(evt.projectID, evt.worktreeID) : null;
  if (!key || !state.workstreams.has(key)) return state;
  const ws = state.workstreams.get(key);
  return patchWorkstream(shallow(state), key, {
    git: { ...(ws.git ?? {}), branch: typeof evt.branch === "string" ? evt.branch : ws.git?.branch },
    lastEventAt: new Date().toISOString(),
  });
}

/** Record a bounded diagnostic entry (FR-062/NFR-004). */
export function pushDiagnostic(state, entry) {
  const list = [...state.diagnostics.errors, entry];
  const bounded = list.slice(Math.max(0, list.length - BOUNDS.maxDiagnostics));
  return {
    ...shallow(state),
    diagnostics: { ...state.diagnostics, errors: bounded },
  };
}

export function setDiagnostics(state, patch) {
  return { ...shallow(state), diagnostics: { ...state.diagnostics, ...patch } };
}

// --- helpers ---------------------------------------------------------------

function shallow(state) {
  return {
    ...state,
    workstreams: state.workstreams,
    diagnostics: state.diagnostics,
    orphanAgents: state.orphanAgents,
  };
}

function preserveCurrentWorkstream(next, previous, projectId, worktreeId) {
  const key = wsKey(projectId, worktreeId);
  const existing = previous.workstreams.get(key);
  if (existing) next.workstreams.set(key, existing);
}

function pruneOrphanAgents(orphanAgents, at) {
  const now = Date.parse(at);
  const cutoff = Number.isFinite(now) ? now - BOUNDS.orphanAgentTtlMs : Date.now() - BOUNDS.orphanAgentTtlMs;
  const entries = [...orphanAgents].filter(([, agent]) => {
    const observed = Date.parse(agent?.observedAt ?? "");
    return Number.isFinite(observed) && observed >= cutoff;
  });
  return new Map(entries.slice(Math.max(0, entries.length - BOUNDS.maxOrphanAgents)));
}

function patchWorkstream(state, key, patch) {
  const existing = state.workstreams.get(key);
  if (!existing) return state;
  const next = shallow(state);
  next.workstreams = new Map(state.workstreams);
  next.workstreams.set(key, { ...existing, ...patch });
  return next;
}

/** Mutating variant for maps already cloned by the caller. */
function patchWorkstreamInPlace(state, key, patch) {
  const existing = state.workstreams.get(key);
  if (!existing) return state;
  state.workstreams.set(key, { ...existing, ...patch });
  return state;
}

function findKeyByWorktreeId(state, worktreeId) {
  for (const [key, ws] of state.workstreams) if (ws.worktreeId === worktreeId) return key;
  return null;
}

function samePath(a, b) {
  return String(a ?? "").replace(/\/+$/, "") === String(b ?? "").replace(/\/+$/, "");
}
