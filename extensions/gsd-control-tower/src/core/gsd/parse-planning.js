/**
 * Orchestrator: builds one normalized {@link GsdSnapshot} from a project's
 * `.planning/` tree using an injected FileSource (muxy.files in the panel,
 * in-memory fixtures in tests). Read-only; never throws; problems become
 * warnings/errors recorded on the snapshot (FR-010..FR-015).
 */
import { PARSER_VERSION, BOUNDS } from "../types.js";
import { parseStateMd, normalizeDateish } from "./parse-state.js";
import { parseProjectMd, parseConfigJson, parseHandoffJson, parseContinueHere, parseVerificationMd } from "./parse-support.js";
import { parseRoadmap, nextOpenPhase } from "./parse-roadmap.js";
import { collectPhases, normalizeNumber } from "./parse-phases.js";

/**
 * @typedef {Object} FileSource
 * @property {(path: string) => Promise<string|null>} read Null when missing/unreadable.
 * @property {(path: string) => Promise<Array<{name:string,path:string,isDirectory:boolean}>|null>} list
 */

/**
 * @param {FileSource} source
 * @param {{now?: Date}} [opts]
 * @returns {Promise<{recognized: boolean, gsd: import("../types.js").GsdSnapshot}>}
 */
export async function buildGsdSnapshot(source, opts = {}) {
  const now = (opts.now ?? new Date()).toISOString();
  /** @type {string[]} */ const warnings = [];
  /** @type {string[]} */ const errors = [];
  /** @type {{path:string, observedAt:string, dated?:boolean}[]} */ const evidence = [];

  const rootEntries = await safeList(source, ".planning", errors);
  if (!rootEntries) {
    return {
      recognized: false,
      gsd: emptySnapshot({ warnings, errors, evidence }, now),
    };
  }

  const names = new Set(rootEntries.filter((e) => !e.isDirectory).map((e) => e.name));
  const dirs = new Set(rootEntries.filter((e) => e.isDirectory).map((e) => e.name));
  // `dated` marks timestamps read from artifact content; entries without one
  // record when WE read the file ("now") and must never feed staleness math.
  const addEvidence = (path, observedAt) => {
    const iso = normalizeDateish(observedAt);
    evidence.push({ path, observedAt: iso ?? now, dated: !!iso });
  };

  // --- STATE.md ------------------------------------------------------------
  let state = null;
  if (names.has("STATE.md")) {
    const text = await safeRead(source, ".planning/STATE.md", errors, false, warnings);
    if (text != null) {
      state = parseStateMd(text, ".planning/STATE.md");
      warnings.push(...state.warnings);
      addEvidence(".planning/STATE.md",
        state.lastActivity ?? state.frontmatter?.last_updated ?? state.frontmatter?.last_activity);
    } else {
      errors.push(".planning/STATE.md could not be read");
    }
  } else {
    errors.push(".planning/STATE.md is missing — workflow position unknown");
  }

  // --- ROADMAP.md ----------------------------------------------------------
  /** @type {ReturnType<typeof parseRoadmap>} */
  let roadmap = { phases: [], warnings: [] };
  if (dirs.has("phases") || names.has("ROADMAP.md")) {
    const text = await safeRead(source, ".planning/ROADMAP.md", errors, false, warnings);
    if (text != null) {
      roadmap = parseRoadmap(text, ".planning/ROADMAP.md");
      warnings.push(...roadmap.warnings);
      if (roadmap.phases.length) addEvidence(".planning/ROADMAP.md");
    }
  }

  // --- PROJECT.md ----------------------------------------------------------
  let projectName;
  let coreValue;
  const projText = await safeRead(source, ".planning/PROJECT.md", errors, /*optional*/ true, warnings);
  if (projText != null) {
    const parsed = parseProjectMd(projText);
    projectName = parsed.name;
    coreValue = parsed.coreValue;
    warnings.push(...parsed.warnings);
    if (projectName) addEvidence(".planning/PROJECT.md");
  }

  // --- config.json (parsed to surface malformed-JSON warnings) --------------
  if (names.has("config.json")) {
    const text = await safeRead(source, ".planning/config.json", errors, true, warnings);
    if (text != null) {
      const parsed = parseConfigJson(text);
      warnings.push(...parsed.warnings);
    }
  }

  // --- paused-handoff signals ----------------------------------------------
  let paused = false;
  let nextAction;
  /** @type {string|undefined} */ let pauseDetail;

  if (names.has(".continue-here.md")) {
    const parsed = parseContinueHere(await safeRead(source, ".planning/.continue-here.md", errors, true, warnings) ?? "");
    warnings.push(...parsed.warnings);
    if (parsed.paused) {
      paused = true;
      pauseDetail = `task ${parsed.task ?? "?"} of ${parsed.totalTasks ?? "?"}`;
      addEvidence(".planning/.continue-here.md", parsed.lastUpdated);
    }
  }

  if (names.has("HANDOFF.json")) {
    const parsed = parseHandoffJson(await safeRead(source, ".planning/HANDOFF.json", errors, true, warnings) ?? "");
    warnings.push(...parsed.warnings);
    if (parsed.paused) {
      paused = true;
      pauseDetail = parsed.phaseName ? `"${parsed.phaseName}" task ${parsed.task ?? "?"}/${parsed.totalTasks ?? "?"}` : pauseDetail;
      addEvidence(".planning/HANDOFF.json", parsed.timestamp);
    }
  }

  // --- phase pipeline (every phase directory) -------------------------------
  /** @type {Awaited<ReturnType<typeof collectPhases>>} */
  let collected = [];
  if (dirs.has("phases")) {
    collected = await collectPhases(source, { errors, warnings, currentPhaseNumber: state?.phaseNumber });
  }
  const current =
    collected.find((p) => p.isCurrent)
    ?? (state?.phaseNumber
      ? collected.find((p) => normalizeNumber(p.number) === normalizeNumber(state.phaseNumber))
      : undefined);

  if (current) {
    // Paused continuation may live inside the phase dir too.
    if (!paused && current.pausedMarker) {
      const contPath = `.planning/phases/${current.dir}/.continue-here.md`;
      const parsedContinue = parseContinueHere(
        await safeRead(source, contPath, errors, true, warnings) ?? "", contPath);
      warnings.push(...parsedContinue.warnings);
      if (parsedContinue.paused) {
        paused = true;
        pauseDetail = `task ${parsedContinue.task ?? "?"} of ${parsedContinue.totalTasks ?? "?"}`;
        addEvidence(contPath, parsedContinue.lastUpdated);
      } else if (namesHasPhaseHandoff(source, current)) {
        const handoffText = await safeRead(
          source, `.planning/phases/${current.dir}/HANDOFF.json`, errors, true, warnings) ?? "";
        const parsedHandoff = parseHandoffJson(handoffText, `.planning/phases/${current.dir}/HANDOFF.json`);
        warnings.push(...parsedHandoff.warnings);
        if (parsedHandoff.paused) {
          paused = true;
          pauseDetail = parsedHandoff.phaseName
            ? `"${parsedHandoff.phaseName}" task ${parsedHandoff.task ?? "?"}/${parsedHandoff.totalTasks ?? "?"}`
            : pauseDetail;
        }
      }
    }
  } else if (state?.phaseNumber && Number(String(state.phaseNumber).split(".")[0]) > 0 && dirs.has("phases")) {
    warnings.push(`no phase directory matching "Phase ${state.phaseNumber}" under .planning/phases/`);
  }

  let verification = current?.verification ?? /** @type {"passed"|"failed"|"pending"|"unknown"} */ ("unknown");
  const verificationDetail = current?.verificationDetail;
  const phaseQueue = current
    ? { plansTotal: current.plansTotal, plansSummarized: current.plansDone }
    : undefined;

  // --- milestone (milestone-era layout fallback) ---------------------------
  let milestone = typeof state?.frontmatter?.milestone === "string" ? state.frontmatter.milestone : undefined;
  let milestoneName = typeof state?.frontmatter?.milestone_name === "string" ? state.frontmatter.milestone_name : undefined;
  if (!milestone && names.has("MILESTONES.md")) {
    const text = await safeRead(source, ".planning/MILESTONES.md", errors, true, warnings);
    const heading = text && /^##\s+(v[\w.-]+[^\n]*)$/m.exec(text)?.[1]?.trim();
    if (heading) {
      milestone = /^v[\w.-]+/.exec(heading)?.[0];
      milestoneName =
        milestoneName
        ?? (heading.replace(/^v[\w.-]+\s*/, "").replace(/\s*\(.*\)\s*$/, "").trim() || undefined);
      addEvidence(".planning/MILESTONES.md");
    }
  }

  // --- explicit next action (artifact-derived only, FR-015) -----------------
  nextAction = deriveNextAction({ state, paused, pauseDetail, phaseQueue, roadmap, verification });

  const progressIn = state?.progress ?? {};
  const gsd = {
    recognized: true,
    projectName,
    coreValue,
    milestone,
    milestoneName,
    phaseLabel: state?.phaseLabel,
    phaseNumber: state?.phaseNumber,
    phaseName: state?.phaseName ?? undefined,
    phaseDir: current?.dir,
    planLabel: state?.planLabel,
    statusLine: state?.statusLine,
    frontmatterStatus: typeof state?.frontmatter?.status === "string" ? state.frontmatter.status : undefined,
    progress: {
      totalPhases: asNumber(progressIn.total_phases),
      completedPhases: asNumber(progressIn.completed_phases),
      totalPlans: asNumber(progressIn.total_plans),
      completedPlans: asNumber(progressIn.completed_plans),
      percent: displayPercent(state),
    },
    lastActivity: state?.lastActivity,
    lastActivityDesc: state?.lastActivityDesc,
    blockers: state?.blockers ?? [],
    concerns: state?.concerns ?? [],
    verification,
    verificationDetail,
    nextAction,
    paused,
    phaseQueue,
    phases: mergePipelineWithRoadmap(collected, roadmap.phases, state?.phaseNumber),
    roadmapPhases: roadmap.phases.length ? roadmap.phases.map((p) => ({ number: p.number, name: p.name, done: p.done })) : undefined,
    evidence: evidence.slice(0, BOUNDS.maxEvidence),
    warnings: dedupe(warnings).slice(0, BOUNDS.maxWarnings),
    errors: dedupe(errors).slice(0, BOUNDS.maxErrors),
    parserVersion: PARSER_VERSION,
  };
  return { recognized: true, gsd };
}

/** Best-effort existence probe for a phase-dir HANDOFF.json without throwing. */
async function namesHasPhaseHandoff(source, phase) {
  try {
    const files = await source.list(`.planning/phases/${phase.dir}`);
    return !!files?.some((f) => f.name === "HANDOFF.json" && !f.isDirectory);
  } catch {
    return false;
  }
}

/** Merge collected phase dirs with roadmap metadata; include planned-but-absent phases. */
function mergePipelineWithRoadmap(collected, roadmapPhases, currentPhaseNumber) {
  const byNum = new Map((roadmapPhases ?? []).map((p) => [normalizeNumber(p.number), p]));
  const merged = collected.map((c) => {
    const rm = byNum.get(normalizeNumber(c.number));
    return {
      ...c,
      name: rm?.name,
      goal: rm?.goal,
      done: rm ? rm.done : false,
    };
  });
  const seen = new Set(merged.map((p) => normalizeNumber(p.number)));
  for (const rm of roadmapPhases ?? []) {
    if (seen.has(normalizeNumber(rm.number))) continue;
    merged.push({
      number: rm.number,
      dir: "",
      isCurrent: currentPhaseNumber != null && normalizeNumber(currentPhaseNumber) === normalizeNumber(rm.number),
      pausedMarker: false,
      stages: {},
      plansTotal: 0,
      plansDone: 0,
      verification: "unknown",
      name: rm.name,
      goal: rm.goal,
      done: rm.done,
    });
  }
  merged.sort((a, b) => compareNumbers(a.number, b.number));
  return merged.length ? merged.slice(0, BOUNDS.maxPhases) : undefined;
}

function compareNumbers(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function deriveNextAction(ctx) {
  const { state, paused, pauseDetail, phaseQueue, roadmap, verification } = ctx;
  if (paused) return pauseDetail ? `Resume paused work (${pauseDetail})` : "Resume paused work (.continue-here)";
  if (state?.frontmatterStatus === "complete" || /^(complete|done)\b/i.test(state?.statusLine ?? ""))
    return "Milestone complete — plan the next milestone";
  if (verification === "failed")
    return "Address the failed verification before proceeding";
  if (phaseQueue && phaseQueue.plansTotal > phaseQueue.plansSummarized) {
    return `Execute remaining plan${phaseQueue.plansTotal - phaseQueue.plansSummarized > 1 ? "s" : ""} in ${state?.phaseLabel ?? "current phase"}`;
  }
  const open = nextOpenPhase(roadmap.phases);
  if (open) return `Start Phase ${open.number}: ${open.name}`;
  if (state?.planLabel && /^not started/i.test(state.planLabel)) return "Start the queued plan";
  return undefined;
}

/** @returns {import("../types.js").GsdSnapshot} */
function emptySnapshot(extra, now) {
  return {
    recognized: false,
    blockers: [],
    concerns: [],
    verification: "unknown",
    paused: false,
    evidence: [],
    warnings: [],
    errors: [],
    parserVersion: PARSER_VERSION,
  };
}

async function safeRead(source, path, errors, optional = false, warnings = []) {
  try {
    const value = await source.read(path);
    if (typeof value !== "string") return value;
    if (value.length > BOUNDS.maxArtifactChars) {
      warnings.push(`${path}: artifact exceeded ${BOUNDS.maxArtifactChars} characters and was truncated`);
    }
    return value.slice(0, BOUNDS.maxArtifactChars);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/permission denied/i.test(msg)) throw e; // surfaced globally, not per-file
    if (!optional) errors.push(`${path}: ${msg}`);
    return null;
  }
}

async function safeList(source, path, errors) {
  try {
    return await source.list(path);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/permission denied/i.test(msg)) throw e;
    errors.push(`${path}: ${msg}`);
    return null;
  }
}

function asNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Display percent for the progress bar. Trust order: explicit frontmatter
 * percent → plan counts → phase counts → a sub-100 body bar. A full bar on an
 * unfinished project is decoration in some GSD variants, never evidence.
 */
function displayPercent(state) {
  const fmPct = state?.frontmatter?.progress?.percent;
  if (typeof fmPct === "number") return fmPct;
  const p = state?.progress ?? {};
  if (typeof p.total_plans === "number" && p.total_plans > 0 && typeof p.completed_plans === "number") {
    return Math.round((100 * p.completed_plans) / p.total_plans);
  }
  if (typeof p.total_phases === "number" && p.total_phases > 0 && typeof p.completed_phases === "number") {
    return Math.round((100 * p.completed_phases) / p.total_phases);
  }
  if (typeof state?.percent === "number" && state.percent < 100) return state.percent;
  return undefined;
}

function dedupe(arr) {
  return [...new Set(arr)];
}
