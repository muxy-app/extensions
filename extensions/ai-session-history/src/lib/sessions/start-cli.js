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
 * @param {string | null | undefined} preferredCli - stored preference (may be uninstalled)
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
 * @param {string | null | undefined} preferredCli
 * @param {{ id: string, displayName?: string }[]} installed
 * @returns {{
 *   startCli: string | null,
 *   label: string,
 *   showMenu: boolean,
 *   items: { id: string, displayName: string, selected: boolean }[]
 * }}
 */
export function buildStartActionModel(preferredCli, installed) {
  const list = asInstalledList(installed);
  const startCli = pickStartCli(preferredCli, list);
  return {
    startCli,
    label: startButtonLabel(startCli, list),
    showMenu: showStartCliMenu(list),
    items: startMenuItems(preferredCli, list),
  };
}
