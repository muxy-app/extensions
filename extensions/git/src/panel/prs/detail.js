import { fill, h } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenuBelow } from "@/shared/menu";
import { errorMessage, openUrl } from "@/shared/actions";
import { renderPrDetail } from "@/shared/pr-detail";
import { forgeFor } from "@/core/forge";
import { mergeMethod, methodLabel, setMergeMethod } from "@/core/pr-flow";
import * as ops from "@/panel/ops/pr";
import { CommentBox } from "@/panel/prs/comment-box";

const detailCache = new Map();

export class PrDetail {
  constructor(ctl, { onChanged = () => {}, onLeave = () => {}, hideChanges = false } = {}) {
    this.onLeave = onLeave;
    this.ctl = ctl;
    this.onChanged = onChanged;
    this.hideChanges = hideChanges;
    this.pr = null;
    this.detail = null;
    this.error = "";
    this.busy = false;
    this.checks = { open: false, loading: false, items: [] };
    this.loadId = 0;
    this.comments = new CommentBox(ctl, { onPosted: (number, body) => this.posted(number, body) });
    this.el = h("div", { class: "prd-host" });
  }

  async open(pr, { fresh = false, preloaded = false } = {}) {
    const id = ++this.loadId;
    const key = `${this.ctl.root}#${pr.number}`;
    if (preloaded) detailCache.set(key, pr);
    this.pr = pr;
    this.error = "";
    this.detail = detailCache.get(key) ?? null;
    if (this.checks.number !== pr.number) this.checks = { open: false, loading: false, items: [], number: pr.number };
    this.render();
    if (this.detail && !fresh) return;
    try {
      const forge = await forgeFor(this.ctl.root);
      const detail = await forge.api.details(pr.number);
      if (id !== this.loadId) return;
      detail.checks = detail.checks?.status !== "none" ? detail.checks : pr.checks;
      this.detail = detail;
      detailCache.set(key, detail);
      if (detailCache.size > 30) detailCache.delete(detailCache.keys().next().value);
    } catch (err) {
      if (id !== this.loadId) return;
      this.error = errorMessage(err);
    }
    this.render();
    if (this.checks.open) void this.loadChecks();
  }

  posted(number, body) {
    if (this.pr?.number !== number) return;
    const entry = { id: `local-${Date.now()}`, kind: "comment", author: "You", body, createdAt: new Date().toISOString(), state: "" };
    if (this.detail) {
      this.detail = { ...this.detail, timeline: [...(this.detail.timeline ?? []), entry] };
      detailCache.set(`${this.ctl.root}#${number}`, this.detail);
    }
    this.render();
    this.refresh();
  }

  refresh() {
    if (this.pr) void this.open(this.pr, { fresh: true });
  }

  async loadChecks() {
    const number = this.pr?.number;
    if (!number) return;
    this.checks = { ...this.checks, loading: !this.checks.items.length };
    this.render();
    const forge = await forgeFor(this.ctl.root);
    const items = await forge.api.checks(number).catch(() => []);
    if (this.pr?.number !== number) return;
    this.checks = { ...this.checks, loading: false, items };
    this.render();
  }

  async act(fn) {
    this.busy = true;
    this.render();
    const ok = await fn();
    this.busy = false;
    if (ok !== false) {
      this.refresh();
      this.onChanged();
    } else this.render();
  }

  onAction(action, anchor) {
    const pr = this.detail ?? this.pr;
    const ctl = this.ctl;
    if (action === "toggle-checks") {
      this.checks.open = !this.checks.open;
      if (this.checks.open) void this.loadChecks();
      return this.render();
    }
    if (action === "merge") return void this.act(() => ops.mergePr(ctl, pr, mergeMethod()));
    if (action === "ready") return void this.act(() => ops.readyPr(ctl, pr));
    if (action === "checkout") return void ops.checkoutPr(ctl, pr).then((ok) => ok && this.onLeave());
    if (action === "worktree") return void ops.worktreePr(ctl, pr, anchor, () => this.onLeave());
    if (action === "changes") {
      ops.viewPr(ctl, pr);
      return this.onLeave();
    }
    if (action === "method") return openMenuBelow(anchor, this.methodItems(), "end");
    if (action === "more") openMenuBelow(anchor, ops.prMoreMenu(ctl, pr, { onRefresh: () => this.refresh(), onChanged: () => this.changed() }), "end");
  }

  changed() {
    this.refresh();
    this.onChanged();
  }

  methodItems() {
    return ["merge", "squash", "rebase"].map((value) => ({
      label: methodLabel(value),
      checked: value === mergeMethod(),
      run: () => {
        setMergeMethod(value);
        this.render();
      },
    }));
  }

  render() {
    if (!this.pr) return fill(this.el);
    if (this.error && !this.detail)
      return fill(
        this.el,
        h("div", { class: "placeholder" }, h("div", { class: "placeholder-title" }, "Couldn't load the pull request"), h("div", { class: "placeholder-detail" }, this.error), h("button", { type: "button", class: "btn", onclick: () => this.refresh() }, "Try Again")),
      );
    const detail = this.detail ?? { ...this.pr, body: "", timeline: [], changedFiles: null };
    this.comments.setPr(this.pr.number);
    fill(
      this.el,
      renderPrDetail(detail, {
        method: mergeMethod(),
        busy: this.busy,
        hideChanges: this.hideChanges,
        checks: this.checks,
        onOpenUrl: openUrl,
        onAction: (action, anchor) => this.onAction(action, anchor),
      }),
      this.detail ? null : h("div", { class: "prd-loading" }, icon("loader", 14, "spin"), "Loading details…"),
      this.comments.el,
    );
  }
}
