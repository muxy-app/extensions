/**
 * Stable key for a session row in the panel.
 * @param {string} cli
 * @param {string} id
 */
export function sessionRowKey(cli, id) {
  return `${cli}:${id}`;
}

/**
 * Decide whether a rename draft should commit, no-op, or stay empty.
 * @param {string | null | undefined} currentTitle
 * @param {string | null | undefined} draft
 * @returns {{ action: "empty" | "unchanged" | "commit", title?: string }}
 */
export function evaluateRenameDraft(currentTitle, draft) {
  const title = String(draft ?? "").trim();
  if (!title) return { action: "empty" };
  if (title === String(currentTitle ?? "").trim()) return { action: "unchanged" };
  return { action: "commit", title };
}

/**
 * True if the editing key still exists in the current groups list.
 * @param {string | null | undefined} editingKey
 * @param {Array<{ sessions?: Array<{ cli: string, id: string }> }>} groups
 */
export function editTargetStillPresent(editingKey, groups) {
  if (!editingKey) return false;
  const list = Array.isArray(groups) ? groups : [];
  return list.some((g) =>
    (g.sessions ?? []).some((s) => sessionRowKey(s.cli, s.id) === editingKey),
  );
}

/**
 * Find a session by panel row key.
 * @param {string | null | undefined} editingKey
 * @param {Array<{ sessions?: Array<Record<string, unknown>> }>} groups
 */
export function findSessionByKey(editingKey, groups) {
  if (!editingKey) return null;
  const list = Array.isArray(groups) ? groups : [];
  for (const g of list) {
    for (const s of g.sessions ?? []) {
      if (sessionRowKey(s.cli, s.id) === editingKey) return s;
    }
  }
  return null;
}
