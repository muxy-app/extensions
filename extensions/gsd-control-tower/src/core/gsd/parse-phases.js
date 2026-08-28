/**
 * Phase pipeline collector: enumerates `.planning/phases/*` directories and
 * derives per-phase stage completion from the artifacts GSD writes
 * (discuss/research/ui-spec/patterns → plan → execute → verify/review/
 * security/validation). Read-only; tolerant; never throws.
 */
import { parseVerificationMd } from "./parse-support.js";
import { BOUNDS } from "../types.js";

const PLAN_RE = /^(\d{2,})-(\d{2,})-PLAN\.md$/i;
const DIR_NUM_RE = /^(\d+(?:\.\d+)?)(?:[-_]|$)/;

/**
 * @typedef {Object} PhasePipelineEntry
 * @property {string} number                    Unpadded phase number, e.g. "2" or "2.1"
 * @property {string} dir                       Directory name, e.g. "02-opening-convoy-protection"
 * @property {boolean} isCurrent                Matches STATE.md current phase
 * @property {boolean} pausedMarker             .continue-here.md / HANDOFF.json present in dir
 * @property {{discuss?: boolean, research?: boolean, ui?: boolean, spec?: boolean,
 *             patterns?: boolean, review?: boolean, security?: boolean, validation?: boolean}} stages
 * @property {number} plansTotal
 * @property {number} plansDone                 Plans with a SUMMARY.md
 * @property {"passed"|"failed"|"pending"|"unknown"} verification
 * @property {string} [verificationDetail]
 */

/**
 * @param {import("./parse-planning.js").FileSource} source
 * @param {{errors?: string[], warnings?: string[], currentPhaseNumber?: string}} [opts]
 * @returns {Promise<PhasePipelineEntry[]>}
 */
export async function collectPhases(source, opts = {}) {
  const errors = opts.errors ?? [];
  const warnings = opts.warnings ?? [];
  const entries = await safeList(source, ".planning/phases", errors);
  if (!entries) return [];
  const candidates = entries.filter((e) => e.isDirectory && DIR_NUM_RE.test(e.name));
  if (candidates.length > BOUNDS.maxPhases) {
    warnings.push(`.planning/phases: limited ${candidates.length} phase directories to ${BOUNDS.maxPhases}`);
  }
  const dirs = candidates.slice(0, BOUNDS.maxPhases);
  /** @type {PhasePipelineEntry[]} */
  const phases = [];
  for (const dir of dirs) {
    const numberRaw = DIR_NUM_RE.exec(dir.name)?.[1];
    if (!numberRaw) continue;
    const files = await safeList(source, `.planning/phases/${dir.name}`, errors) ?? [];
    const names = files.filter((f) => !f.isDirectory).map((f) => f.name);
    const has = (re) => names.some((n) => re.test(n));

    const plans = names.filter((n) => PLAN_RE.test(n));
    const plansDone = plans.filter((p) =>
      names.includes(`${p.replace(/-PLAN\.md$/i, "")}-SUMMARY.md`)).length;

    let verification = /** @type {PhasePipelineEntry["verification"]} */ ("unknown");
    let verificationDetail;
    const verifyName = names.find((n) => /^\d{2,}-VERIFICATION\.md$/i.test(n))
      ?? (names.includes("VERIFICATION.md") ? "VERIFICATION.md" : undefined);
    if (verifyName) {
      const text = await safeRead(source, `.planning/phases/${dir.name}/${verifyName}`, errors, warnings);
      if (text != null) {
        const parsed = parseVerificationMd(text, `.planning/phases/${dir.name}/${verifyName}`);
        verification = parsed.status;
        verificationDetail = [parsed.score, parsed.verifiedAt].filter(Boolean).join(" · ") || undefined;
      }
    }

    phases.push({
      number: normalizeNumber(numberRaw),
      dir: dir.name,
      isCurrent:
        opts.currentPhaseNumber != null &&
        normalizeNumber(opts.currentPhaseNumber) === normalizeNumber(numberRaw),
      pausedMarker: names.some((n) => n === ".continue-here.md" || n === "HANDOFF.json"),
      stages: {
        discuss: has(/^(\d+-)?(DISCUSSION-LOG|CONTEXT)\.md$/i),
        research: has(/^(\d+-)?RESEARCH\.md$/i),
        ui: has(/^(\d+-)?UI-SPEC\.md$/i),
        spec: has(/^(\d+-)?SPEC\.md$/i),
        patterns: has(/^(\d+-)?PATTERNS\.md$/i),
        review: has(/^(\d+-)?REVIEW(-FIX)?\.md$/i),
        security: has(/^(\d+-)?SECURITY\.md$/i),
        validation: has(/^(\d+-)?VALIDATION\.md$/i),
      },
      plansTotal: plans.length,
      plansDone,
      verification,
      verificationDetail,
    });
  }
  return phases;
}

/** "02" → "2", "02.10" → "2.10"; non-numeric input passes through untouched. */
export function normalizeNumber(value) {
  const v = String(value ?? "").trim();
  if (!/^\d+(\.\d+)*$/.test(v)) return v;
  return v.split(".").map((part) => String(Number(part))).join(".");
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

async function safeRead(source, path, errors, warnings) {
  try {
    const value = await source.read(path);
    if (typeof value !== "string") return value;
    if (value.length > BOUNDS.maxArtifactChars) {
      warnings.push(`${path}: artifact exceeded ${BOUNDS.maxArtifactChars} characters and was truncated`);
    }
    return value.slice(0, BOUNDS.maxArtifactChars);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/permission denied/i.test(msg)) throw e;
    errors.push(`${path}: ${msg}`);
    return null;
  }
}
