import * as git from "@/core/git";
import { alertError, confirmAction } from "@/shared/actions";
import { push } from "@/panel/ops/sync";

function pushed(state) {
  return state.upstream.hasUpstream && state.upstream.ahead === 0;
}

export function commitPlan(status) {
  if (!status) return { kind: "none", count: 0 };
  if (status.staged.length) return { kind: "staged", count: status.staged.length };
  if (status.unstaged.length) return { kind: "all", count: status.unstaged.length };
  return { kind: "none", count: 0 };
}

export async function commit(ctl, composer, { all = false, andPush = false, amend = false } = {}) {
  const state = ctl.state;
  const message = composer.message();
  const plan = commitPlan(state.status);
  const stageAll = all || plan.kind === "all";
  if (state.status?.conflicts.length) {
    await alertError("Resolve conflicts first", "Stage each conflicted file once it is resolved, then commit.");
    return;
  }
  if (amend) {
    if (pushed(state)) {
      const ok = await confirmAction({
        title: "Amend a pushed commit?",
        message: "The last commit is already on the remote. Amending rewrites it, and you'll need to force push.",
        confirmLabel: "Amend",
        critical: true,
      });
      if (!ok) return;
    }
  } else {
    if (plan.kind === "none" && state.op !== "merge") return;
    if (!message) {
      composer.focus();
      return;
    }
  }
  const result = await ctl.run(amend ? "Could not amend the commit" : "Commit failed", () =>
    amend ? git.amend(message, stageAll) : git.commit(message, stageAll),
  );
  if (!result.ok) return;
  composer.clear();
  if (andPush) await push(ctl);
}

export async function undoLastCommit(ctl, composer) {
  if (pushed(ctl.state)) {
    const ok = await confirmAction({
      title: "Undo a pushed commit?",
      message: "The last commit is already on the remote. Undoing it rewrites history, and you'll need to force push.",
      confirmLabel: "Undo Commit",
      critical: true,
    });
    if (!ok) return;
  }
  const result = await ctl.run("Could not undo the commit", () => git.undoLastCommit());
  if (result.ok && result.value && !composer.message()) composer.setMessage(result.value);
}

export async function continueOperation(ctl, composer) {
  const op = ctl.state.op;
  if (!op) return;
  if (op === "merge") {
    const message = composer.message();
    const result = await ctl.run("Could not finish the merge", () =>
      message ? git.commit(message, false) : git.run(["git", "commit", "--no-edit"]),
    );
    if (result.ok) composer.clear();
    return;
  }
  const result = await ctl.run(`Could not continue the ${op}`, () => git.continueOperation(op));
  if (result.ok) composer.clear();
}

export async function abortOperation(ctl, composer) {
  const op = ctl.state.op;
  if (!op) return;
  const ok = await confirmAction({
    title: `Abort the ${op}?`,
    message: `Your branch returns to where it was before the ${op} started.`,
    confirmLabel: `Abort ${op[0].toUpperCase()}${op.slice(1)}`,
    critical: true,
  });
  if (!ok) return;
  const result = await ctl.run(`Could not abort the ${op}`, () => git.abortOperation(op));
  if (result.ok) composer.clear();
}

export async function operationMessage() {
  const out = await git.tryRun(["sh", "-c", 'f="$(git rev-parse --git-path MERGE_MSG)" && [ -f "$f" ] && grep -v "^#" "$f"']);
  return out.trim();
}
