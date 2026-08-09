import { START_PREFERENCE, providerById } from "./providers.js";

/**
 * @param {unknown} installed
 * @returns {{ id: string, displayName?: string }[]}
 */
function asInstalledList(installed) {
  return Array.isArray(installed) ? installed : [];
}

/**
 * Resolve which CLI to start: preferred if installed, else first in START_PREFERENCE, else first installed.
 * @param {string | null | undefined} preferredCli
 * @param {{ id: string }[]} installed
 * @returns {string | null}
 */
export function pickStartCli(preferredCli, installed) {
  const list = asInstalledList(installed);
  const ids = new Set(list.map((p) => p.id));
  if (preferredCli && ids.has(preferredCli)) return preferredCli;
  for (const id of START_PREFERENCE) {
    if (ids.has(id)) return id;
  }
  return list[0]?.id ?? null;
}

/**
 * True when Start should follow the filter chip (installed provider filter ≠ all).
 * Used to gate preferredCli heal writes so filter-driven Start never persists.
 * @param {string | null | undefined} listFilter
 * @param {{ id: string }[]} installed
 * @returns {boolean}
 */
export function isFilterStartOverride(listFilter, installed) {
  if (!listFilter || listFilter === "all") return false;
  return asInstalledList(installed).some((p) => p.id === listFilter);
}

/**
 * Temporary Start preference from an active provider filter chip.
 * When the filter is a specific installed agent, Start targets that agent
 * without treating it as stored preferredCli.
 * @param {string | null | undefined} preferredCli
 * @param {string | null | undefined} listFilter
 * @param {{ id: string }[]} installed
 * @returns {string | null | undefined}
 */
export function resolveStartPreference(preferredCli, listFilter, installed) {
  return isFilterStartOverride(listFilter, installed) ? listFilter : preferredCli;
}

/**
 * Whether startNew should heal stored preferredCli after a successful start.
 * Callers must pass the filter/preferred snapshot from before openStartTerminal.
 * @param {string | null} cli - CLI that was actually started
 * @param {string | null | undefined} preferredCli - preferred at start time
 * @param {string | null | undefined} listFilter - filter at start time
 * @param {{ id: string }[]} installed
 * @returns {boolean}
 */
export function shouldHealPreferredAfterStart(
  cli,
  preferredCli,
  listFilter,
  installed,
) {
  if (cli == null || cli === preferredCli) return false;
  return !isFilterStartOverride(listFilter, installed);
}

/**
 * Whether the footer should show a chevron menu (need ≥2 installed CLIs).
 * @param {{ id: string }[]} installed
 * @returns {boolean}
 */
export function showStartCliMenu(installed) {
  return asInstalledList(installed).length > 1;
}

/**
 * Label for the primary Start button.
 * @param {string | null} startCli - resolved CLI id from pickStartCli
 * @param {{ id: string, displayName?: string }[]} installed
 * @returns {string}
 */
export function startButtonLabel(startCli, installed) {
  if (!startCli) return "Start new session";
  const list = asInstalledList(installed);
  const name =
    list.find((p) => p.id === startCli)?.displayName ??
    providerById(startCli)?.displayName ??
    startCli;
  return `Start new ${name}`;
}

/**
 * Menu rows for installed CLIs, ordered by START_PREFERENCE ∩ installed.
 * `selected` marks the CLI that would actually start (after ghost preferred fallback), not the raw stored id.
 * @param {string | null | undefined} preferredCli - effective preference (may already include filter override)
 * @param {{ id: string, displayName?: string }[]} installed
 * @returns {{ id: string, displayName: string, selected: boolean }[]}
 */
export function startMenuItems(preferredCli, installed) {
  const list = asInstalledList(installed);
  const byId = new Map(list.map((p) => [p.id, p]));
  const ordered = [];
  const orderedIds = new Set();
  for (const id of START_PREFERENCE) {
    const p = byId.get(id);
    if (p) {
      ordered.push(p);
      orderedIds.add(id);
    }
  }
  for (const p of list) {
    if (!orderedIds.has(p.id)) {
      ordered.push(p);
      orderedIds.add(p.id);
    }
  }

  const effective = pickStartCli(preferredCli, list);
  return ordered.map((p) => ({
    id: p.id,
    displayName: p.displayName ?? providerById(p.id)?.displayName ?? p.id,
    selected: p.id === effective,
  }));
}

/**
 * Full model for the Start footer control.
 * When listFilter is a specific installed agent, Start labels/actions target that agent
 * without changing stored preferredCli.
 * @param {string | null | undefined} preferredCli
 * @param {{ id: string, displayName?: string }[]} installed
 * @param {string | null | undefined} [listFilter="all"]
 * @returns {{
 *   startCli: string | null,
 *   label: string,
 *   showMenu: boolean,
 *   items: { id: string, displayName: string, selected: boolean }[]
 * }}
 */
export function buildStartActionModel(preferredCli, installed, listFilter = "all") {
  const list = asInstalledList(installed);
  const resolved = resolveStartPreference(preferredCli, listFilter, list);
  const startCli = pickStartCli(resolved, list);
  return {
    startCli,
    label: startButtonLabel(startCli, list),
    showMenu: showStartCliMenu(list),
    items: startMenuItems(resolved, list),
  };
}
