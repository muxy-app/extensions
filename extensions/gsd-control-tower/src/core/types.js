/**
 * Normalized data model for GSD Control Tower (PRD §3.8).
 * Pure JSDoc typedefs + constants; no runtime dependencies.
 */

/** @typedef {"working"|"waiting"|"idle"|"unavailable"} RuntimeState */
/** @typedef {"waiting"|"blocked"|"working"|"ready"|"stale"|"idle"|"unknown"} ControlState */
/** @typedef {"live"|"refreshed"|"stale"} Freshness */

/** Priority order for ranking (PRD §3.4). Lower rank = higher attention. */
export const CONTROL_PRIORITY = {
  waiting: 0,
  blocked: 1,
  unknown: 2,
  stale: 3,
  ready: 4,
  working: 5,
  idle: 6,
};

/** Human labels for control states. */
export const CONTROL_LABELS = {
  waiting: "Waiting",
  blocked: "Blocked",
  unknown: "Unknown",
  stale: "Stale",
  ready: "Ready",
  working: "Working",
  idle: "Idle",
};

/** States that count toward the status-bar attention figure. */
export const ATTENTION_STATES = new Set(["waiting", "blocked", "unknown", "stale"]);

/** Provider capability matrix (Muxy docs, Events → agent.status). */
export const PROVIDER_WAITING_SUPPORT = {
  antigravity: false,
  claude: true,
  droid: true,
  grok: true,
  opencode: true,
  pi: false,
  cursor: false,
  kiro: false,
  codex: true,
  xal: false,
};

export const PARSER_VERSION = "gsd-parser/1.0";
/**
 * Extension version — injected from package.json at build time (see
 * vite.config.js `define`). The literal fallback keeps plain-node tests working.
 */
export const EXTENSION_VERSION =
  typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "0.0.0-dev";

/** Hard bounds (NFR-004): keep stored/derived data bounded. */
export const BOUNDS = {
  maxWarnings: 8,
  maxErrors: 8,
  maxBlockers: 12,
  maxEvidence: 12,
  maxDiagnostics: 50,
  maxPhases: 200,
  maxArtifactChars: 512 * 1024,
  maxOrphanAgents: 200,
  orphanAgentTtlMs: 15 * 60_000,
};

/**
 * @typedef {Object} GsdProgress
 * @property {number} [totalPhases]
 * @property {number} [completedPhases]
 * @property {number} [totalPlans]
 * @property {number} [completedPlans]
 * @property {number} [percent]
 */

/**
 * @typedef {Object} GsdSnapshot
 * @property {boolean} recognized            True when a `.planning/` dir with a parseable STATE.md exists.
 * @property {string} [projectName]
 * @property {string} [coreValue]
 * @property {string} [milestone]
 * @property {string} [milestoneName]
 * @property {string} [phaseLabel]           Raw "Phase:" line, e.g. "3 of 3 complete (Name)"
 * @property {string} [phaseNumber]          e.g. "3" or "2.1"
 * @property {string} [phaseName]
 * @property {string} [phaseDir]             e.g. "03-owner-review"
 * @property {string} [planLabel]            Raw "Plan:" line
 * @property {string} [statusLine]           Raw "Status:" line from Current Position
 * @property {string} [frontmatterStatus]    `status:` from STATE.md frontmatter
 * @property {GsdProgress} [progress]
 * @property {string} [lastActivity]         Freshest ISO date across artifact timestamps
 * @property {string} [lastActivityDesc]     Free-text tail of "Last activity:" (e.g. what started)
 * @property {string[]} blockers             ONLY when artifacts explicitly say blocked
 * @property {string[]} concerns             Notes under "Blockers/Concerns" — never blocking alone
 * @property {"passed"|"failed"|"pending"|"unknown"} verification
 * @property {string} [verificationDetail]
 * @property {string} [nextAction]           Explicit next action derived from artifacts only
 * @property {boolean} paused                Paused handoff (.continue-here.md / HANDOFF.json) present
 * @property {{plansTotal:number, plansSummarized:number}} [phaseQueue]
 * @property {import("./gsd/parse-phases.js").PhasePipelineEntry & {name?:string, goal?:string, done?:boolean}[]} [phases]
 *                                           Per-phase pipeline: stage completion, plan counts, verification
 * @property {{number:string,name:string,done:boolean}[]} [roadmapPhases]
 * @property {{path:string, observedAt:string}[]} evidence
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/**
 * @typedef {Object} AgentState
 * @property {string} [providerId]
 * @property {RuntimeState} runtimeState
 * @property {string} [paneId]
 * @property {string} [observedAt] ISO timestamp of last observation
 */

/**
 * @typedef {Object} GitContext
 * @property {string} [branch]
 * @property {string} [lastCommitAt]  ISO date of newest commit
 * @property {string} [lastCommitSubject]
 * @property {number} [dirtyCount]
 * @property {string} [error]
 */

/**
 * @typedef {Object} WorkstreamSnapshot
 * @property {string} key                    Stable identity `${projectId}::${worktreeId}`
 * @property {string} projectId
 * @property {string} projectName
 * @property {string} projectPath
 * @property {string} [worktreeId]
 * @property {string} [worktreeName]
 * @property {string} worktreePath
 * @property {boolean} isActiveWorktree      True when this is the project's active worktree
 * @property {boolean} isGsd                 `.planning/` detected
 * @property {GsdSnapshot} [gsd]             Present when isActiveWorktree && isGsd
 * @property {string} [gsdUnavailableReason] Why planning state is missing (non-active worktree, read error)
 * @property {string} [inventoryWarning]      Worktree inventory could not be queried; row is project-scoped
 * @property {AgentState} agent
 * @property {GitContext} [git]
 * @property {ControlState} controlState
 * @property {string} [attentionReason]
 * @property {string} refreshedAt            ISO timestamp of last full refresh
 * @property {Freshness} freshness
 */

/**
 * @typedef {Object} AttentionItem
 * @property {WorkstreamSnapshot} workstream
 * @property {number} priority
 * @property {string} reason
 */

/** Clamp helper used across bounded stores. */
export function clampList(list, max) {
  if (!Array.isArray(list)) return [];
  return list.length <= max ? list : list.slice(0, max);
}

/**
 * Root store shape (see reducer.js).
 * @typedef {Object} TowerState
 * @property {Array<{id:string,name:string,path:string,isActive:boolean,worktreesEnabled:boolean}>} projects
 * @property {Map<string, Array<{id:string,name?:string,path:string,isPrimary?:boolean,isActive?:boolean,branch?:string}>>} worktreesByProject
 * @property {Map<string, WorkstreamSnapshot & {lastEventAt?: string}>} workstreams
 * @property {Map<string, AgentState>} orphanAgents
 * @property {{
 *   errors: Array<{at:string, message:string, context?:string}>,
 *   subscriptions: string[],
 *   lastFullRefresh: string|null,
 *   parserVersion: string|null,
 *   permissionProbes: Record<string, boolean>,
 * }} diagnostics
 */

/** Coerce arbitrary event payloads into a RuntimeState (NFR-031: tolerate extra/missing fields). */
export function normalizeRuntimeState(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "working" || v === "waiting" || v === "idle") return v;
  return "unavailable";
}
