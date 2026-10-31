import * as git from "@/core/git";
import { ask, confirmAction, errorMessage } from "@/shared/actions";
import { openInput, openPicker } from "@/shared/popover";
import { cachedBranches, forgetBranch, loadBranches } from "@/panel/branches";

const DIRTY_SWITCH = /overwritten by checkout|commit your changes or stash them|would be overwritten/i;

async function branchProblem(name) {
  const res = await muxy.exec(["git", "check-ref-format", "--branch", name]).catch(() => null);
  return res?.exitCode === 0 ? "" : "Not a valid branch name";
}

async function attempt(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

export function createBranch(ctl, anchor, initial = "") {
  if (initial) return void ctl.run("Could not create the branch", () => git.createBranch(initial));
  openInput({
    anchor,
    title: "Create Branch",
    detail: "Starts from the current commit and switches to it.",
    placeholder: "feature/name",
    confirm: "Create",
    validate: branchProblem,
    onSubmit: (name) => void ctl.run("Could not create the branch", () => git.createBranch(name)),
  });
}

export async function switchTo(ctl, target) {
  const doSwitch = () => (target.remote ? git.trackRemote(target.remote) : git.switchBranch(target.name));
  return ctl.run("Could not switch branches", async () => {
    const error = await attempt(doSwitch);
    if (!error) return;
    if (!DIRTY_SWITCH.test(errorMessage(error))) throw error;
    const choice = await ask({
      title: "Uncommitted changes",
      message: `Your changes conflict with “${target.name}”. Stash them, switch, and bring them back?`,
      buttons: ["Stash & Switch"],
    });
    if (!choice) return;
    await git.stashPush(`Switching to ${target.name}`);
    await doSwitch();
    await git.stashApply("stash@{0}", true);
  });
}

export async function deleteBranchNamed(ctl, name) {
  const ok = await confirmAction({ title: `Delete “${name}”?`, message: "The local branch is deleted. Its remote branch is kept.", confirmLabel: "Delete", critical: true });
  if (!ok) return;
  const result = await ctl.run("Could not delete the branch", async () => {
    const error = await attempt(() => git.deleteBranch(name, false));
    if (!error) return true;
    if (!/not fully merged/i.test(errorMessage(error))) throw error;
    const force = await confirmAction({
      title: `“${name}” isn't merged`,
      message: "It has commits that aren't in any other branch. Deleting it may lose them.",
      confirmLabel: "Delete Anyway",
      critical: true,
    });
    if (!force) return false;
    await git.deleteBranch(name, true);
    return true;
  });
  if (result.value) forgetBranch(ctl.root, name);
}

function branchRows(data, query, current) {
  const q = query.toLowerCase();
  const hit = (name) => !q || name.toLowerCase().includes(q);
  const local = new Set(data.local);
  const rows = [];
  if (query && !local.has(query)) rows.push({ kind: "create", name: query, icon: "plus", label: `Create branch “${query}”`, detail: "From the current commit" });
  const locals = data.local.filter(hit).sort((a, b) => (a === current ? -1 : b === current ? 1 : 0));
  if (locals.length) rows.push({ header: "Branches" });
  for (const name of locals) rows.push({ kind: "local", name, icon: name === current ? "check" : "branch", label: name, trailing: name === current ? "current" : null });
  const remotes = data.remote.filter((ref) => !local.has(ref.replace(/^[^/]+\//, "")) && hit(ref));
  if (remotes.length) rows.push({ header: "Remote branches" });
  for (const ref of remotes) rows.push({ kind: "remote", name: ref.replace(/^[^/]+\//, ""), ref, icon: "cloudUp", label: ref });
  return rows;
}

export function pickBranch(ctl, anchor) {
  const root = ctl.root;
  const current = ctl.state.status?.branch ?? null;
  openPicker({
    anchor,
    placeholder: "Switch to a branch, or type a new name",
    cached: cachedBranches(root),
    load: () => loadBranches(root),
    filter: (data, query) => (Array.isArray(data) ? [] : branchRows(data, query, current)),
    emptyLabel: "No branches",
    rowActions: (row) => (row.kind === "local" && row.name !== current ? [{ id: "delete", icon: "trash", title: `Delete ${row.name}`, run: () => void deleteBranchNamed(ctl, row.name) }] : []),
    onPick: (row) => {
      if (row.kind === "create") return createBranch(ctl, anchor, row.name);
      if (row.kind === "remote") return void switchTo(ctl, { name: row.name, remote: row.ref });
      if (row.name !== current) void switchTo(ctl, { name: row.name });
    },
  });
}

export function stash(ctl, anchor) {
  openInput({
    anchor,
    title: "Stash Changes",
    detail: "Saves all changes, including untracked files, and cleans the working tree.",
    placeholder: "Message (optional)",
    confirm: "Stash",
    allowEmpty: true,
    onSubmit: (message) => void ctl.run("Could not stash changes", () => git.stashPush(message)),
  });
}

async function dropStash(ctl, entry) {
  const ok = await confirmAction({ title: "Drop this stash?", message: `“${entry.subject}” will be deleted.`, confirmLabel: "Drop", critical: true });
  if (ok) await ctl.run("Could not drop the stash", () => git.stashDrop(entry.ref));
}

export function pickStash(ctl, anchor) {
  openPicker({
    anchor,
    placeholder: "Filter stashes",
    load: () => git.stashList(),
    filter: (items, query) => items.filter((entry) => !query || entry.subject.toLowerCase().includes(query.toLowerCase())).map((entry) => ({ ...entry, icon: "stash", label: entry.subject || entry.ref, detail: `${entry.ref} · ${entry.when}` })),
    emptyLabel: "No stashes",
    rowActions: () => [
      { id: "apply", icon: "copy", title: "Apply and keep", run: (row) => void ctl.run("Could not apply the stash", () => git.stashApply(row.ref, false)) },
      { id: "drop", icon: "trash", title: "Drop", run: (row) => void dropStash(ctl, row) },
    ],
    onPick: (row) => void ctl.run("Could not apply the stash", () => git.stashApply(row.ref, true)),
  });
}

