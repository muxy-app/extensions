import { cls, h, setText, fill } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenuBelow } from "@/shared/menu";
import { openUrl, alertError } from "@/shared/actions";
import { webUrl } from "@/core/remote";
import * as git from "@/core/git";
import * as sync from "@/panel/ops/sync";
import * as branch from "@/panel/ops/branch";
import { cleanupCurrent } from "@/panel/ops/pr";
import { prefetchBranches } from "@/panel/branches";

export async function openRepository() {
  const url = webUrl(await git.remoteUrl());
  if (url) openUrl(url);
  else await alertError("No remote", "This repository has no web remote named origin.");
}

function syncLabel(state) {
  const { upstream, status } = state;
  if (!status?.branch) return { icon: "sync", text: "", title: "Not on a branch" };
  if (!upstream.hasUpstream) return { icon: "cloudUp", text: "Publish", title: `Publish ${status.branch} to the remote` };
  const parts = [];
  if (upstream.behind) parts.push(`${upstream.behind}↓`);
  if (upstream.ahead) parts.push(`${upstream.ahead}↑`);
  const title = parts.length ? `Sync: pull ${upstream.behind} and push ${upstream.ahead} commit${upstream.ahead === 1 ? "" : "s"}` : "Up to date. Click to fetch and sync";
  return { icon: "sync", text: parts.join(" "), title };
}

export class Header {
  constructor(ctl) {
    this.ctl = ctl;
    this.branchName = h("span", { class: "branch-name" }, "…");
    this.branchButton = h(
      "button",
      { type: "button", class: "branch-button", title: "Switch Branch", onclick: () => branch.pickBranch(ctl, this.el) },
      icon("branch", 13),
      this.branchName,
      icon("chevronDown", 12, "branch-chevron"),
    );
    this.syncIcon = h("span", { class: "sync-icon" });
    this.syncText = h("span", { class: "sync-text" });
    this.syncButton = h("button", { type: "button", class: "sync-button", onclick: () => void sync.sync(ctl) }, this.syncIcon, this.syncText);
    this.moreButton = h("button", { type: "button", class: "icon-btn", title: "More Actions", "aria-label": "More Actions", onclick: () => this.openMenu() }, icon("more", 14));
    this.el = h("header", { class: "header" }, this.branchButton, this.syncButton, this.moreButton);
    this.iconName = "";
  }

  update(state) {
    const root = state.repo?.root ?? null;
    if (root && (root !== this.root || state.headVersion !== this.headVersion)) {
      this.root = root;
      this.headVersion = state.headVersion;
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = setTimeout(() => prefetchBranches(root), 300);
    }
    const name = state.status ? state.status.branch ?? "Detached HEAD" : "…";
    setText(this.branchName, name);
    this.branchButton.title = state.status?.branch ? `${state.status.branch} — Switch Branch` : "Switch Branch";
    const label = syncLabel(state);
    if (label.icon !== this.iconName) {
      this.iconName = label.icon;
      fill(this.syncIcon, icon(label.icon, 13));
    }
    setText(this.syncText, label.text);
    this.syncButton.title = label.title;
    this.syncButton.className = cls("sync-button", state.busy > 0 && "sync-busy", label.text && "sync-has-text");
    this.syncButton.disabled = state.busy > 0 || !state.status?.branch;
  }

  openMenu() {
    const ctl = this.ctl;
    const { status, upstream, repo } = ctl.state;
    const onBranch = !!status?.branch;
    const isDefault = onBranch && status.branch === status.defaultBranch;
    openMenuBelow(
      this.moreButton,
      [
        { label: "Pull", disabled: !onBranch || !upstream.hasUpstream, run: () => void sync.pull(ctl) },
        { label: upstream.hasUpstream ? "Push" : "Publish Branch", disabled: !onBranch, run: () => void sync.push(ctl) },
        { label: "Fetch", run: () => void sync.fetch(ctl) },
        { label: "Force Push…", disabled: !onBranch || !upstream.hasUpstream, run: () => void sync.forcePush(ctl) },
        "-",
        { label: "Switch Branch…", run: () => branch.pickBranch(ctl, this.el) },
        { label: "Create Branch…", run: () => branch.createBranch(ctl, this.el) },
        { label: repo?.isWorktree ? "Clean Up Worktree…" : "Clean Up Branch…", disabled: !onBranch || isDefault, run: () => void cleanupCurrent(ctl) },
        "-",
        { label: "Stash Changes…", run: () => branch.stash(ctl, this.el) },
        { label: "Stashes…", run: () => branch.pickStash(ctl, this.el) },
        "-",
        { label: "Open Repository in Browser", run: () => void openRepository() },
        { label: "Refresh", run: () => void ctl.load() },
      ],
      "end",
    );
  }
}
