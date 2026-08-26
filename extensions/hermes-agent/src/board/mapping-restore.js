export async function restoreProjectBoardMapping({ sessionBroker, projectID, baseUrl, boards }) {
  const mapping = await sessionBroker.readBoardMapping({ projectID, baseUrl });
  if (!mapping) return Object.freeze({ board: null, stale: false });
  if (boards.some((candidate) => candidate.slug === mapping.board)) {
    return Object.freeze({ board: mapping.board, stale: false });
  }
  await sessionBroker.clearBoardMapping({ projectID });
  return Object.freeze({ board: null, stale: true });
}
