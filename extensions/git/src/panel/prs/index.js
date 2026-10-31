import { fill, h, setText, toggle } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenu } from "@/shared/menu";
import { errorMessage } from "@/shared/actions";
import { boundedMap } from "@/shared/prefs";
import { relativeTime } from "@/shared/time";
import { forgeFor } from "@/core/forge";
import { prState } from "@/core/forge/normalize";
import { CreatePrForm } from "@/create-pr/form";
import { chips, iconButton, placeholder, spinner } from "@/panel/ui";
import { checksBadge, stateIcon } from "@/panel/prs/parts";
import { renderCard, renderNoPr } from "@/panel/prs/card";
import { PrDetail } from "@/panel/prs/detail";
import * as ops from "@/panel/ops/pr";

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];
const STALE_MS = 60 * 1000;
const POLL_MS = 30 * 1000;
const listCache = boundedMap("muxy.git.prs", 12);

function matches(pr, query) {
  if (!query) return true;
  return `#${pr.number} ${pr.title} ${pr.author} ${pr.headBranch}`.toLowerCase().includes(query);
}

export class PrsView {
  constructor(ctl) {
    this.ctl = ctl;
    this.visible = false;
    this.current = { phase: "idle", pr: null, branch: null, at: 0, error: "" };
    this.filter = "open";
    this.query = "";
    this.list = { phase: "idle", prs: [], key: "", at: 0, error: "" };
    this.loadIds = { current: 0, list: 0 };
    this.creating = false;
    this.createHost = h("div", { class: "pr-card pr-create" });
    this.detail = new PrDetail(ctl, { onChanged: () => this.refreshAll() });
    this.cardHost = h("div", { class: "pr-current" });
    this.search = h("input", {
      class: "field",
      placeholder: "Search pull requests",
      spellcheck: "false",
      oninput: () => {
        this.query = this.search.value.trim().toLowerCase();
        this.renderList();
      },
    });
    this.chipsHost = h("div", { class: "pr-filters" });
    this.refreshButton = iconButton("refresh", "Refresh", { small: true, onClick: () => this.refreshAll() });
    this.listHost = h("div", { class: "pr-list" });
    this.home = h(
      "div",
      { class: "pr-home" },
      this.cardHost,
      h("div", { class: "pr-list-head" }, h("span", { class: "section-label" }, "Pull Requests"), this.refreshButton),
      h("div", { class: "filter-row" }, this.search),
      this.chipsHost,
      this.listHost,
    );
    this.detailTitle = h("span", { class: "detail-bar-title" });
    this.detailBody = h("div", { class: "pr-detail-body" }, this.detail.el);
    this.detailPane = h(
      "div",
      { class: "pr-detail", hidden: true },
      h(
        "div",
        { class: "detail-bar" },
        h("button", { type: "button", class: "detail-back", onclick: () => this.closeDetail() }, icon("chevronLeft", 13), "Pull Requests"),
        this.detailTitle,
        iconButton("refresh", "Refresh", { small: true, onClick: () => this.detail.refresh() }),
      ),
      this.detailBody,
    );
    this.el = h("section", { class: "view prs" }, this.home, this.detailPane);
    this.listHost.addEventListener("click", (event) => this.onListClick(event));
    this.listHost.addEventListener("contextmenu", (event) => this.onListMenu(event));
    this.el.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.detailPane.hidden && !event.target.closest?.("input,textarea")) this.closeDetail();
    });
  }

  get root() {
    return this.ctl.root;
  }

  openDetail(pr, { checks = false } = {}) {
    setText(this.detailTitle, `#${pr.number}`);
    toggle(this.home, true);
    toggle(this.detailPane, false);
    this.detailBody.scrollTop = 0;
    if (checks) this.detail.checks = { open: true, loading: true, items: [], number: pr.number };
    void this.detail.open(pr).then(() => checks && this.detail.loadChecks());
  }

  closeDetail() {
    toggle(this.detailPane, true);
    toggle(this.home, false);
  }

  startCreate() {
    this.creating = true;
    const form = new CreatePrForm(fill(this.createHost), {
      inline: true,
      onCancel: () => this.stopCreate(),
      onDone: (result) => {
        this.stopCreate();
        if (result?.created) {
          this.refreshAll();
          void this.ctl.refreshHead();
        }
      },
    });
    this.render();
    void form.start();
  }

  stopCreate() {
    this.creating = false;
    this.render();
  }

  async act(fn) {
    const ok = await fn();
    if (ok !== false) this.refreshAll();
  }

  refreshAll() {
    void this.refreshCurrent(true);
    void this.loadList(true);
  }

  async refreshCurrent(force = false) {
    const { status, phase } = this.ctl.state;
    if (phase !== "ready" || !status) return;
    const branch = status.branch;
    const fresh = Date.now() - this.current.at < STALE_MS && this.current.branch === branch;
    if (!force && fresh && this.current.phase === "ready") return;
    if (!branch) {
      this.current = { phase: "ready", pr: null, branch, at: Date.now(), error: "" };
      return this.render();
    }
    const id = ++this.loadIds.current;
    if (this.current.branch !== branch) this.current = { phase: "loading", pr: null, branch, at: 0, error: "" };
    this.render();
    try {
      const forge = await forgeFor(this.root);
      const pr = await forge.api.current({ fresh: force });
      if (id !== this.loadIds.current) return;
      this.current = { phase: "ready", pr, branch, at: Date.now(), error: "" };
    } catch (err) {
      if (id !== this.loadIds.current) return;
      this.current = { phase: "error", pr: null, branch, at: Date.now(), error: errorMessage(err) };
    }
    this.render();
    this.schedulePoll();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.visible || this.current.pr?.checks.status !== "pending") return;
    this.pollTimer = setTimeout(() => this.refreshCurrent(true), POLL_MS);
  }

  async loadList(force = false) {
    const key = `${this.root}\n${this.filter}`;
    if (this.list.key !== key) {
      const cached = listCache.get(key);
      this.list = cached ? { phase: "ready", prs: cached.prs, key, at: cached.at, error: "" } : { phase: "loading", prs: [], key, at: 0, error: "" };
    }
    if (!force && this.list.phase === "ready" && Date.now() - this.list.at < STALE_MS) return this.renderList();
    const id = ++this.loadIds.list;
    this.list = { ...this.list, refreshing: true };
    this.renderList();
    try {
      const forge = await forgeFor(this.root);
      const prs = await forge.api.list(this.filter, 100);
      if (id !== this.loadIds.list) return;
      this.list = { phase: "ready", prs, key, at: Date.now(), error: "" };
      listCache.set(key, { prs, at: this.list.at });
    } catch (err) {
      if (id !== this.loadIds.list) return;
      this.list = { ...this.list, phase: this.list.prs.length ? "ready" : "error", error: errorMessage(err), refreshing: false };
    }
    this.renderList();
  }

  setFilter(value) {
    this.filter = value;
    void this.loadList();
  }

  render() {
    const { phase, pr, error } = this.current;
    if (phase === "loading" && !pr) fill(this.cardHost, h("div", { class: "pr-card pr-card-loading" }, spinner(14)));
    else if (phase === "error") fill(this.cardHost, placeholder("Pull requests unavailable", error));
    else if (!pr) fill(this.cardHost, renderNoPr(this, this.ctl.state));
    else fill(this.cardHost, renderCard(this, pr));
  }

  renderList() {
    fill(this.chipsHost, chips(FILTERS, this.filter, (value) => this.setFilter(value)));
    fill(this.refreshButton, this.list.refreshing ? icon("loader", 13, "spin") : icon("refresh", 13));
    const { phase, prs, error } = this.list;
    if (phase === "loading" || phase === "idle") return fill(this.listHost, h("div", { class: "placeholder" }, spinner(16)));
    if (phase === "error") return fill(this.listHost, placeholder("Couldn't load pull requests", error, h("button", { type: "button", class: "btn", onclick: () => void this.loadList(true) }, "Try Again")));
    const visible = prs.filter((pr) => matches(pr, this.query));
    if (!visible.length) return fill(this.listHost, placeholder(this.query ? "No matching pull requests" : `No ${this.filter === "all" ? "" : `${this.filter} `}pull requests`));
    fill(this.listHost, visible.map((pr) => this.row(pr)));
  }

  row(pr) {
    const open = prState(pr) === "open";
    const mine = !!pr.headBranch && pr.headBranch === this.ctl.state.status?.branch;
    const el = h(
      "div",
      { class: "pr-row", title: `#${pr.number} ${pr.title}\n${pr.headBranch} → ${pr.baseBranch}` },
      stateIcon(pr),
      h(
        "span",
        { class: "pr-row-text" },
        h("span", { class: "pr-row-title" }, pr.title),
        h("span", { class: "pr-row-meta" }, [`#${pr.number}`, pr.author, relativeTime(pr.updatedAt), mine ? "this branch" : null].filter(Boolean).join(" · ")),
      ),
      h("span", { class: "pr-row-end" }, checksBadge(pr.checks, { compact: true })),
      h(
        "span",
        { class: "row-actions" },
        open && !mine ? iconButton("branch", "Check Out", { action: "checkout", small: true }) : null,
        open && !mine ? iconButton("worktree", "Check Out in New Worktree", { action: "worktree", small: true }) : null,
        iconButton("file", "View Changes", { action: "changes", small: true }),
      ),
    );
    el._pr = pr;
    return el;
  }

  onListClick(event) {
    const row = event.target.closest?.(".pr-row");
    if (!row?._pr) return;
    const pr = row._pr;
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (action === "checkout") return void ops.checkoutPr(this.ctl, pr);
    if (action === "worktree") return void ops.worktreePr(this.ctl, pr, row);
    if (action === "changes") return ops.viewPr(this.ctl, pr);
    this.openDetail(pr);
  }

  onListMenu(event) {
    const row = event.target.closest?.(".pr-row");
    if (!row?._pr) return;
    event.preventDefault();
    const pr = row._pr;
    const open = prState(pr) === "open";
    openMenu(
      [
        { label: "Show Details", run: () => this.openDetail(pr) },
        { label: "View Changes", run: () => ops.viewPr(this.ctl, pr) },
        "-",
        { label: "Check Out…", disabled: !open, run: () => void ops.checkoutPr(this.ctl, pr) },
        { label: "Check Out in New Worktree…", disabled: !open, run: () => void ops.worktreePr(this.ctl, pr, row) },
        "-",
        ...ops.prMoreMenu(this.ctl, pr, { onChanged: () => this.refreshAll() }),
      ],
      event.clientX,
      event.clientY,
    );
  }

  update(state, prev) {
    if (state.repo?.root !== prev.repo?.root) {
      this.current = { phase: "idle", pr: null, branch: null, at: 0, error: "" };
      this.list = { phase: "idle", prs: [], key: "", at: 0, error: "" };
      this.creating = false;
      this.closeDetail();
    }
    if (!this.visible || state.phase !== "ready") return;
    const branchChanged = prev.status && state.status?.branch !== prev.status?.branch;
    if (branchChanged) this.creating = false;
    if (branchChanged || state.headVersion !== prev.headVersion || this.current.phase === "idle") void this.refreshCurrent(branchChanged);
    if (state.forge !== prev.forge && this.list.phase !== "ready") void this.loadList();
  }

  show() {
    this.visible = true;
    void this.refreshCurrent();
    void this.loadList();
  }

  hide() {
    this.visible = false;
    clearTimeout(this.pollTimer);
  }
}
