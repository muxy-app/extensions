import * as git from "@/core/git";
import { commitWebUrl, webUrl } from "@/core/remote";
import { alertError, confirmAction, copyText, openUrl } from "@/shared/actions";
import { openInput } from "@/shared/popover";
import { openDiffTab } from "@/shared/diff-tabs";

export function openCommit(ctl, commit) {
  void openDiffTab(ctl.root, { source: "commit", hash: commit.hash });
}

export function openRange(ctl, range, title) {
  void openDiffTab(ctl.root, { source: "range", range, title });
}

async function openOnRemote(commit) {
  const url = commitWebUrl(webUrl(await git.remoteUrl()), commit.hash);
  if (url) openUrl(url);
  else await alertError("No remote", "This repository has no web remote named origin.");
}

async function checkout(ctl, commit) {
  const ok = await confirmAction({
    title: `Check out ${commit.shortHash}?`,
    message: "You'll be in detached HEAD state. Create a branch to keep any commits you make.",
    confirmLabel: "Check Out",
  });
  if (ok) await ctl.run("Could not check out the commit", () => git.checkoutCommit(commit.hash));
}

function branchHere(ctl, commit, anchor) {
  openInput({
    anchor,
    title: "Create Branch Here",
    detail: `Starts at ${commit.shortHash} and switches to it.`,
    placeholder: "feature/name",
    confirm: "Create",
    onSubmit: (name) => void ctl.run("Could not create the branch", () => git.createBranchAt(name, commit.hash)),
  });
}

function tagHere(ctl, commit, anchor) {
  openInput({
    anchor,
    title: "Create Tag",
    detail: `Points at ${commit.shortHash}.`,
    placeholder: "v1.0.0",
    confirm: "Create",
    onSubmit: (name) => void ctl.run("Could not create the tag", () => git.createTag(name, commit.hash)),
  });
}

async function cherryPick(ctl, commit) {
  const ok = await confirmAction({ title: `Cherry-pick ${commit.shortHash}?`, message: `“${commit.subject}” is applied on top of the current branch.`, confirmLabel: "Cherry-pick" });
  if (ok) await ctl.run("Cherry-pick failed", () => git.cherryPick(commit.hash));
}

async function revert(ctl, commit) {
  const ok = await confirmAction({ title: `Revert ${commit.shortHash}?`, message: `A new commit undoes “${commit.subject}”.`, confirmLabel: "Revert" });
  if (ok) await ctl.run("Revert failed", () => git.revert(commit.hash));
}

export function commitMenu(ctl, commit, anchor) {
  return [
    { label: "Open Changes", run: () => openCommit(ctl, commit) },
    { label: "Open on Remote", run: () => void openOnRemote(commit) },
    "-",
    { label: "Copy Hash", run: () => void copyText(commit.hash, `Copied ${commit.shortHash}`) },
    { label: "Copy Message", run: () => void copyText(commit.subject, "Copied message") },
    "-",
    { label: "Check Out…", run: () => void checkout(ctl, commit) },
    { label: "Create Branch Here…", run: () => branchHere(ctl, commit, anchor) },
    { label: "Create Tag Here…", run: () => tagHere(ctl, commit, anchor) },
    "-",
    { label: "Cherry-pick…", run: () => void cherryPick(ctl, commit) },
    { label: "Revert…", run: () => void revert(ctl, commit) },
  ];
}
