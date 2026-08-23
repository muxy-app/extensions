/**
 * Control-state derivation (PRD §3.4). Pure functions.
 *
 * Derivation follows the documented meaning of each state; ranking uses
 * CONTROL_PRIORITY. Derived states always carry an explicit, evidence-citing
 * reason; runtime states come only from Muxy agent data (never inferred).
 */
import { CONTROL_PRIORITY } from "./types.js";

/**
 * @typedef {Object} StatusInput
 * @property {boolean} isGsd
 * @property {import("./types.js").GsdSnapshot} [gsd]
 * @property {import("./types.js").AgentState} agent
 * @property {import("./types.js").GitContext} [git]
 * @property {string} refreshedAt
 * @property {string} [lastEventAt]     ISO time of last relevant workspace event
 */

/**
 * @param {StatusInput} ws
 * @param {{now?: number, staleThresholdMs?: number}} [opts]
 * @returns {{controlState: import("./types.js").ControlState, attentionReason?: string}}
 */
export function deriveStatus(ws, opts = {}) {
  const now = opts.now ?? Date.now();
  const thresholdMs = opts.staleThresholdMs ?? 45 * 60_000;
  const gsd = ws.gsd;
  const runtime = ws.agent?.runtimeState ?? "unavailable";
  const provider = ws.agent?.providerId;

  // 1. Waiting — only from explicit runtime report (FR-024: never inferred).
  if (runtime === "waiting") {
    return {
      controlState: "waiting",
      attentionReason: `${provider ? label(provider) : "Agent"} reports it needs your attention`,
    };
  }

  // 2. Blocked — explicit GSD evidence only. `gsd.blockers` is populated by the
  // parser solely when STATE.md's own status text says blocked; notes in the
  // "Blockers/Concerns" section surface as concerns and never block (verified
  // on real projects where that section holds deferred, future-tense notes).
  if (gsd?.recognized) {
    const blockerBits = [];
    if (gsd.blockers.length) blockerBits.push(`STATE.md records a blocker: “${gsd.blockers[0]}”`);
    if (gsd.verification === "failed")
      blockerBits.push(`phase verification failed${gsd.phaseLabel ? ` (${gsd.phaseLabel})` : ""}`);
    if (blockerBits.length) {
      return { controlState: "blocked", attentionReason: capitalize(blockerBits.join("; ")) };
    }
  }

  // 3. Unknown — recognized GSD project whose required artifacts are absent/inconsistent.
  if (gsd?.recognized && gsd.errors.length) {
    return { controlState: "unknown", attentionReason: `Planning state unreadable — ${gsd.errors[0]}` };
  }

  const incomplete = isIncomplete(gsd);

  // 4. Stale — incomplete work, no active agent, no recent observable change.
  if (incomplete && runtime !== "working") {
    const lastChangeMs = latestChangeMs(gsd, ws.git);
    if (lastChangeMs != null && now - lastChangeMs > thresholdMs) {
      const age = formatAge(now - lastChangeMs);
      return {
        controlState: "stale",
        attentionReason: `No observed change for ${age}; work is still open`,
      };
    }
  }

  // 5. Ready — clear, explicitly recorded next action and nobody driving.
  // A project whose artifacts say executing/planning/discussing is mid-flight,
  // not waiting on the user — "ready" would be noise there.
  if (gsd?.recognized && gsd.nextAction && runtime !== "working" && !isComplete(gsd) && !workflowActive(gsd)) {
    return {
      controlState: "ready",
      attentionReason: `Next action: ${gsd.nextAction}`,
    };
  }

  // 6. Working — active agent effort.
  if (runtime === "working") {
    return {
      controlState: "working",
      attentionReason: provider ? `${label(provider)} is actively working` : undefined,
    };
  }

  // 7. Idle — recognized, nothing demanding attention.
  if (gsd?.recognized) return { controlState: "idle", attentionReason: undefined };

  // Not a GSD project (or planning unreadable without recognition) — neutral row.
  return { controlState: "idle", attentionReason: undefined };
}

/** Ranking comparator per PRD §3.4, ties broken by most recent activity then name. */
export function compareAttention(a, b) {
  const pa = CONTROL_PRIORITY[a.controlState];
  const pb = CONTROL_PRIORITY[b.controlState];
  if (pa !== pb) return pa - pb;
  const ta = Date.parse(a.gsd?.lastActivity ?? a.refreshedAt ?? 0) || 0;
  const tb = Date.parse(b.gsd?.lastActivity ?? b.refreshedAt ?? 0) || 0;
  if (ta !== tb) return tb - ta;
  return String(a.projectName).localeCompare(String(b.projectName));
}

/**
 * True when artifacts explicitly claim completion.
 * Deliberately NOT driven by progress percent or counts: some GSD variants
 * render a decorative 100% bar regardless of position (verified on real
 * projects), so completion requires an explicit status claim.
 */
export function isComplete(gsd) {
  if (!gsd?.recognized) return false;
  if (/^(complete|done)$/i.test(String(gsd.frontmatterStatus ?? "").trim())) return true;
  if (/^complete\b/i.test(String(gsd.statusLine ?? "").trim())) return true;
  return false;
}

function isIncomplete(gsd) {
  return !!gsd?.recognized && !isComplete(gsd);
}

/**
 * True when the artifacts themselves describe work in flight (executing,
 * planning, discussing, …). Distinct from agent runtime state: this is the
 * workflow's own claim about its position.
 */
export function workflowActive(gsd) {
  const s = `${gsd?.frontmatterStatus ?? ""} ${gsd?.statusLine ?? ""}`;
  if (!s.trim()) return false;
  return /\b(executing|implementing|discussing|planning|researching|specing|reviewing|verifying)\b/i.test(s);
}

/** Newest trustworthy change timestamp across artifact + git evidence. */
export function latestChangeMs(gsd, git) {
  const candidates = [];
  if (gsd?.lastActivity) candidates.push(Date.parse(gsd.lastActivity));
  for (const ev of gsd?.evidence ?? []) {
    if (ev.dated === false) continue; // "when we read it", not "when it changed"
    const t = Date.parse(ev.observedAt);
    if (Number.isFinite(t)) candidates.push(t);
  }
  if (git?.lastCommitAt) candidates.push(Date.parse(git.lastCommitAt));
  const valid = candidates.filter((t) => Number.isFinite(t));
  return valid.length ? Math.max(...valid) : null;
}

export function formatAge(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 36) return `${hours} h ${min % 60 ? `${min % 60} m ` : ""}`.trim();
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function label(providerId) {
  if (!providerId) return "Agent";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
