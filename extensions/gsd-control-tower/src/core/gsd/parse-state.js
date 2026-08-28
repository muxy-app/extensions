/**
 * Parser for `.planning/STATE.md` — the primary workflow-state artifact.
 * Tolerant of unknown headings/fields (FR-013); every claim records its
 * source path (FR-012); problems become warnings, never thrown (FR-014).
 *
 * The GSD heading is "Blockers/Concerns", but its bullets are untyped prose.
 * They are surfaced as notes and never used to derive criticality.
 */
import { splitFrontmatter } from "../frontmatter.js";
import { BOUNDS } from "../types.js";

/**
 * @typedef {Object} StateMdResult
 * @property {Record<string, any>} frontmatter
 * @property {string} [phaseLabel]
 * @property {string} [phaseNumber]
 * @property {string} [phaseName]
 * @property {string} [planLabel]
 * @property {string} [statusLine]
 * @property {string} [lastActivity]       Freshest date across body/frontmatter
 * @property {string} [lastActivityDesc]   Free-text tail after the em dash
 * @property {number} [percent]
 * @property {string[]} concerns           Every bullet under Blockers/Concerns
 * @property {Record<string, any>} progress
 * @property {string[]} warnings
 */

/**
 * @param {string} text
 * @param {string} sourcePath Absolute-or-relative path used for evidence.
 * @returns {StateMdResult}
 */
export function parseStateMd(text, sourcePath = ".planning/STATE.md") {
  /** @type {string[]} */ const warnings = [];
  const input = String(text ?? "");
  if (input.length > BOUNDS.maxArtifactChars) {
    warnings.push(`${sourcePath}: artifact exceeded ${BOUNDS.maxArtifactChars} characters and was truncated`);
  }
  const { data: fm, body, hasFrontmatter } = splitFrontmatter(input.slice(0, BOUNDS.maxArtifactChars));
  if (!hasFrontmatter) warnings.push(`${sourcePath}: no YAML frontmatter — relying on body headings`);
  if (!body.includes("## Current Position"))
    warnings.push(`${sourcePath}: missing "## Current Position" section`);

  const position = extractSection(body, "## Current Position");
  const blockersSection = extractSection(body, "### Blockers/Concerns");

  const phaseLine = matchLabeledLine(position, /^Phase:\s*(.+)$/im);
  const planLine = matchLabeledLine(position, /^Plan:\s*(.+)$/im);
  const statusLine = matchLabeledLine(position, /^Status:\s*(.+)$/im);

  const lastActivityLine = matchLabeledLine(position, /^Last activity:\s*(.+)$/im);
  let lastActivityDesc;
  if (lastActivityLine) {
    const sep = lastActivityLine.indexOf("—");
    if (sep > 0) lastActivityDesc = lastActivityLine.slice(sep + 1).trim() || undefined;
  }

  // Progress bar fallback: `Progress: [██████----] 60%`
  let percent;
  const bar = /Progress:\s*\[[^\]]*\]\s*(\d+)%/.exec(position);
  if (bar) percent = Number(bar[1]);

  const phaseNumber = phaseLine
    ? (/^(\d+(?:\.\d+)?)/.exec(phaseLine.trim())?.[1])
    : (fm.current_phase != null ? String(fm.current_phase) : undefined);
  let phaseName;
  if (phaseLine) {
    const paren = /\(([^)]+)\)\s*$/.exec(phaseLine.trim());
    if (paren) phaseName = paren[1].trim();
  }
  phaseName =
    phaseName
    ?? (typeof fm.current_phase_name === "string" && fm.current_phase_name.trim()
      ? fm.current_phase_name.trim()
      : undefined);

  // "Blockers/Concerns" is a prose section, so preserve it for display only.
  const bullets = parseConcernNotes(blockersSection);

  return {
    frontmatter: fm,
    phaseLabel: phaseLine?.trim(),
    phaseNumber,
    phaseName,
    planLabel: planLine?.trim(),
    statusLine: statusLine?.trim(),
    lastActivity: freshest([
      normalizeDateish(lastActivityLine),
      normalizeDateish(fm.last_activity),
      normalizeDateish(fm.last_updated),
    ]),
    lastActivityDesc,
    percent: typeof fm.progress?.percent === "number" ? fm.progress.percent : percent,
    concerns: bullets,
    progress: isPlainObject(fm.progress) ? fm.progress : {},
    warnings: warnings.slice(0, BOUNDS.maxWarnings),
  };
}

/** Newest valid ISO string among candidates, or undefined. */
function freshest(candidates) {
  const times = candidates
    .filter((iso) => typeof iso === "string")
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

/** Extract a `## Heading` section body up to the next heading of same-or-higher level. */
export function extractSection(markdown, heading) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const want = heading.trim().toLowerCase();
  const wantLevel = (heading.match(/^#+/) ?? [""])[0].length;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === want) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return "";
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i].trimStart());
    if (m && m[1].length <= wantLevel) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** @param {string} section @param {RegExp} re */
function matchLabeledLine(section, re) {
  const m = re.exec(section ?? "");
  return m ? m[1].trim() : undefined;
}

/** Bullets under a section; "None." ⇒ []. Callers classify blocker vs concern. */
export function parseConcernNotes(section) {
  if (!section) return [];
  const out = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(line) ?? /^\d+\.\s+(.+)$/.exec(line);
    if (!bullet) continue;
    let text = bullet[1].trim();
    if (/^none\b/i.test(text)) continue;
    text = text.replace(/\s+/g, " ");
    out.push(text);
  }
  return out.slice(0, BOUNDS.maxNotes);
}

/** Normalize date-ish strings: ISO timestamps pass through; `YYYY-MM-DD` → midnight UTC ISO. */
export function normalizeDateish(s) {
  const v = String(s ?? "").trim();
  if (!v) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/.exec(v);
  if (!iso) return undefined;
  const candidate = iso[0].replace(" ", "T");
  const t = Date.parse(candidate.endsWith("Z") || candidate.length === 10 ? candidate + (candidate.length === 10 ? "T00:00:00Z" : "") : candidate);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
