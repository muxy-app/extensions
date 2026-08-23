/**
 * Parser for `.planning/ROADMAP.md` — the phase checklist + phase details.
 * Handles `- [x] **Phase N: Name** - goal` checklist entries (integer and
 * decimal phase numbers) and `### Phase N: Name` + `**Goal**:` details.
 */
import { BOUNDS } from "../types.js";

/**
 * @typedef {Object} RoadmapPhase
 * @property {string} number
 * @property {string} name
 * @property {boolean} done
 * @property {string} [goal]
 */

/**
 * @param {string} text
 * @param {string} sourcePath
 * @returns {{phases: RoadmapPhase[], warnings: string[]}}
 */
export function parseRoadmap(text, sourcePath = ".planning/ROADMAP.md") {
  /** @type {string[]} */ const warnings = [];
  const input = String(text ?? "");
  if (input.length > BOUNDS.maxArtifactChars) {
    warnings.push(`${sourcePath}: artifact exceeded ${BOUNDS.maxArtifactChars} characters and was truncated`);
  }
  const body = input.slice(0, BOUNDS.maxArtifactChars).replace(/\r\n/g, "\n");
  if (!/^\s*#\s+Roadmap/im.test(body))
    warnings.push(`${sourcePath}: missing "# Roadmap" heading`);

  /** @type {RoadmapPhase[]} */ const phases = [];
  const checklist = /^\s*-\s+\[([ xX])\]\s+\*\*Phase\s+(\d+(?:\.\d+)?)\s*:\s*(.+?)\*\*\s*[-–—:]\s*(.*)$/gm;
  let m;
  while ((m = checklist.exec(body)) && phases.length < BOUNDS.maxPhases) {
    phases.push({
      number: m[2],
      name: m[3].trim(),
      done: m[1].toLowerCase() === "x",
      goal: m[4]?.trim() || undefined,
    });
  }

  // Enrich with details from "## Phase Details" (goal lines), keyed by number.
  const detail = /^#{3,4}\s+Phase\s+(\d+(?:\.\d+)?)\s*:\s*(.+?)\s*$[\s\S]*?\*\*Goal\*\*\s*:\s*(.+)$/gm;
  while ((m = detail.exec(body))) {
    const found = phases.find((p) => p.number === m[1]);
    if (found) {
      found.goal = m[3].trim();
    } else if (phases.length < BOUNDS.maxPhases) {
      // Detail without checklist entry — still a known phase.
      phases.push({ number: m[1], name: m[2].trim(), done: false, goal: m[3].trim() });
    }
  }

  phases.sort((a, b) => Number(a.number) - Number(b.number));
  if (!phases.length) warnings.push(`${sourcePath}: no Phase checklist entries recognized`);
  return { phases: phases.slice(0, BOUNDS.maxPhases), warnings: warnings.slice(0, BOUNDS.maxWarnings) };
}

/** First not-done phase in roadmap order. @returns {RoadmapPhase|undefined} */
export function nextOpenPhase(phases) {
  return [...(phases ?? [])].sort((a, b) => Number(a.number) - Number(b.number)).find((p) => !p.done);
}
