import * as git from "@/core/git";
import { alertError, ask, confirmAction } from "@/shared/actions";

async function integrate(label) {
  const upstream = await git.upstream();
  if (upstream.behind === 0) return true;
  if (upstream.ahead === 0) {
    await git.integrate("ff");
    return true;
  }
  const mode = await ask({
    title: "Your branch has diverged",
    message: `You have ${upstream.ahead} local commit${upstream.ahead === 1 ? "" : "s"} and the remote has ${upstream.behind} new commit${upstream.behind === 1 ? "" : "s"}. How do you want to ${label}?`,
    buttons: ["Merge", "Rebase"],
  });
  if (!mode) return false;
  await git.integrate(mode.toLowerCase());
  return true;
}

function needsBranch(ctl) {
  if (ctl.state.status?.branch) return false;
  void alertError("No branch", "You're not on a branch (detached HEAD). Switch to or create a branch first.");
  return true;
}

export async function sync(ctl) {
  if (needsBranch(ctl)) return;
  if (!ctl.state.upstream.hasUpstream) return publish(ctl);
  await ctl.run("Sync failed", async () => {
    await git.fetch();
    ctl.markFetched();
    if (!(await integrate("sync"))) return;
    if ((await git.upstream()).ahead > 0) await git.push();
  });
}

export async function pull(ctl) {
  if (needsBranch(ctl)) return;
  if (!ctl.state.upstream.hasUpstream) {
    await alertError("Nothing to pull", "This branch isn't tracking a remote branch yet. Publish it first.");
    return;
  }
  await ctl.run("Pull failed", async () => {
    await git.fetch();
    ctl.markFetched();
    await integrate("pull");
  });
}

export async function push(ctl) {
  if (needsBranch(ctl)) return;
  if (!ctl.state.upstream.hasUpstream) return publish(ctl);
  await ctl.run("Push failed", () => git.push());
}

export function publish(ctl) {
  if (needsBranch(ctl)) return;
  return ctl.run("Could not publish the branch", () => git.push({ setUpstream: true }));
}

export async function forcePush(ctl) {
  if (needsBranch(ctl)) return;
  const ok = await confirmAction({
    title: "Force push?",
    message: `This overwrites ${ctl.state.status.branch} on the remote with your local branch. It refuses if someone else pushed in the meantime.`,
    confirmLabel: "Force Push",
    critical: true,
  });
  if (ok) await ctl.run("Force push failed", () => git.push({ force: true }));
}

export async function fetch(ctl) {
  await ctl.run("Fetch failed", async () => {
    await git.fetch();
    ctl.markFetched();
  });
}
