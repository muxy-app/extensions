/**
 * Parsers for supporting GSD artifacts:
 *   - `.planning/PROJECT.md`        (project name / core value)
 *   - `.planning/config.json`       (workflow toggles)
 *   - `.planning/HANDOFF.json`      (paused handoff)
 *   - `.continue-here.md`           (paused mid-phase continuation, root or phase dir)
 *   - `NN-VERIFICATION.md`          (phase verification result frontmatter)
 */
import { splitFrontmatter } from "../frontmatter.js";
import { BOUNDS } from "../types.js";

/** @returns {{name?: string, coreValue?: string, warnings: string[]}} */
export function parseProjectMd(text, sourcePath = ".planning/PROJECT.md") {
  /** @type {string[]} */ const warnings = [];
  const body = String(text ?? "").replace(/\r\n/g, "\n");
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  if (!title) warnings.push(`${sourcePath}: no "# Title" heading found`);
  const coreValue = extractParagraphAfter(body, "## Core Value");
  return { name: title, coreValue: coreValue || undefined, warnings };
}

function extractParagraphAfter(markdown, heading) {
  const idx = markdown.toLowerCase().indexOf(heading.toLowerCase());
  if (idx === -1) return "";
  const rest = markdown.slice(idx + heading.length).replace(/^\s*\n/, "");
  return (rest.split(/\n\s*\n/)[0] ?? "").trim();
}

/** @returns {{config: Record<string, any>, warnings: string[]}} */
export function parseConfigJson(text, sourcePath = ".planning/config.json") {
  try {
    const parsed = JSON.parse(String(text ?? "{}"));
    return { config: parsed && typeof parsed === "object" ? parsed : {}, warnings: [] };
  } catch (e) {
    return { config: {}, warnings: [`${sourcePath}: invalid JSON (${e.message})`] };
  }
}

/** @returns {{paused: boolean, phaseName?: string, task?: number, totalTasks?: number, timestamp?: string, warnings: string[]}} */
export function parseHandoffJson(text, sourcePath = ".planning/HANDOFF.json") {
  /** @type {string[]} */ const warnings = [];
  let data;
  try {
    data = JSON.parse(String(text ?? "null"));
  } catch (e) {
    return { paused: false, warnings: [`${sourcePath}: invalid JSON (${e.message})`] };
  }
  if (!data || typeof data !== "object") return { paused: false, warnings: [`${sourcePath}: not an object`] };
  const status = String(data.status ?? "").toLowerCase();
  return {
    paused: status === "paused",
    phaseName: typeof data.phase_name === "string" ? data.phase_name : undefined,
    task: typeof data.task === "number" ? data.task : undefined,
    totalTasks: typeof data.total_tasks === "number" ? data.total_tasks : undefined,
    timestamp: typeof data.timestamp === "string" ? data.timestamp : undefined,
    warnings: warnings.slice(0, BOUNDS.maxWarnings),
  };
}

/** @returns {{paused: boolean, context?: string, phase?: string, task?: number, totalTasks?: number, lastUpdated?: string, warnings: string[]}} */
export function parseContinueHere(text, sourcePath = ".planning/.continue-here.md") {
  const { data: fm } = splitFrontmatter(text ?? "");
  const hasFm = Object.keys(fm).length > 0;
  /** @type {string[]} */ const warnings = [];
  if (!hasFm) warnings.push(`${sourcePath}: no frontmatter — treating as unparseable`);
  const status = String(fm.status ?? "").toLowerCase();
  return {
    paused: hasFm && status === "paused",
    context: typeof fm.context === "string" ? fm.context : undefined,
    phase: typeof fm.phase === "string" ? fm.phase : undefined,
    task: typeof fm.task === "number" ? fm.task : undefined,
    totalTasks: typeof fm.total_tasks === "number" ? fm.total_tasks : undefined,
    lastUpdated: typeof fm.last_updated === "string" ? fm.last_updated : undefined,
    warnings: warnings.slice(0, BOUNDS.maxWarnings),
  };
}

/** @returns {{status:"passed"|"failed"|"pending"|"unknown", verifiedAt?: string, score?: string, warnings: string[]}} */
export function parseVerificationMd(text, sourcePath) {
  const { data: fm, body } = splitFrontmatter(text ?? "");
  /** @type {string[]} */ const warnings = [];
  let status = String(fm.status ?? "").toLowerCase();
  if (!status) {
    // Fall back to a bold **Status:** line in the body.
    const m = /\*\*Status:\*\*\s*(\w+)/i.exec(body);
    if (m) status = m[1].toLowerCase();
    else warnings.push(`${sourcePath}: no verification status found`);
  }
  const normalized =
    status === "passed" || status === "pass" ? "passed" :
    status === "failed" || status === "fail" ? "failed" :
    status === "pending" ? "pending" : "unknown";
  return {
    status: normalized,
    verifiedAt: typeof fm.verified === "string" ? fm.verified : undefined,
    score: typeof fm.score === "string" ? fm.score : undefined,
    warnings: warnings.slice(0, BOUNDS.maxWarnings),
  };
}
