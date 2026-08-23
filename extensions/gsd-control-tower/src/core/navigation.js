/**
 * Navigation planner (FR-050..FR-053): pure decision logic for "Open context".
 * Never starts commands or writes anything — only Muxy context switches.
 */

/**
 * @param {import("./types.js").WorkstreamSnapshot} row
 * @param {{id:string, isActive:boolean}|undefined} project
 * @returns {{steps: Array<{kind:"switchProject"|"switchWorktree", projectId:string, targetId?:string}>, note?: string}}
 */
export function planNavigation(row, project) {
  /** @type {Array<{kind:"switchProject"|"switchWorktree", projectId:string, targetId?:string}>} */
  const steps = [];
  if (!project || !project.isActive) {
    steps.push({ kind: "switchProject", projectId: row.projectId });
  }
  if (row.worktreeId && !row.isActiveWorktree) {
    steps.push({
      kind: "switchWorktree",
      projectId: row.projectId,
      targetId: row.worktreeId,
    });
  }
  let note;
  if (!steps.length) {
    note = "Already the active context.";
  } else if (steps.length === 1 && steps[0].kind === "switchProject") {
    // Project-level navigation lands on that project's active worktree.
    if (row.worktreeId == null && row.isActiveWorktree !== true) {
      note = "Opening the project — Muxy will land on its active worktree.";
    }
  }
  return { steps, note };
}
