import { cls, fill, h, setText } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { alertError, errorMessage, setDialogAnchor, toast } from "@/shared/actions";
import { boundedMap } from "@/shared/prefs";
import { relativeTime } from "@/shared/time";
import * as git from "@/core/git";
import { forgeFor } from "@/core/forge";
import { checksLabel, prTone } from "@/core/forge/normalize";
import { PrDetail } from "@/panel/prs/detail";
import * as ops from "@/panel/ops/pr";

const listCache = boundedMap("muxy.git.prs", 12);
const STATE_ICON = { open: "pr", draft: "prDraft", merged: "merge", closed: "prClosed" };

function close() {
  Promise.resolve(muxy.modal.closeWebview?.()).catch(() => muxy.lifecycle?.close?.());
}

function matches(pr, query) {
  if (!query) return true;
  return query.split(/\s+/).every((term) => `#${pr.number} ${pr.title} ${pr.author} ${pr.headBranch} ${pr.baseBranch}`.toLowerCase().includes(term));
}

export class PrBrowser {
  constructor(root) {
    this.root = root;
    this.prs = [];
    this.visible = [];
    this.selected = 0;
    this.query = "";
    this.ctl = {
      root: null,
      state: { status: null, forge: null, repo: null },
      run: async (label, fn) => {
        try {
          return { ok: true, value: await fn() };
        } catch (error) {
          await alertError(label, error);
          return { ok: false, error };
        }
      },
    };
    this.detail = new PrDetail(this.ctl, { onChanged: () => void this.load(true), onLeave: () => close() });
    this.search = h("input", { class: "browser-search-input", placeholder: "Search open pull requests", spellcheck: "false", autocomplete: "off", oninput: () => this.filter() });
    this.count = h("span", { class: "browser-count" });
    this.list = h("div", { class: "browser-list", role: "listbox" });
    this.status = h("span", { class: "browser-status" });
    this.root.appendChild(
      h(
        "div",
        { class: "browser" },
        h(
          "aside",
          { class: "browser-side" },
          h("div", { class: "browser-search" }, icon("search", 13), this.search, this.count),
          this.list,
          h("footer", { class: "browser-footer" }, this.status, h("span", { class: "browser-keys" }, [["↵", "Check out"], ["⇧↵", "Worktree"], ["⌘R", "Reload"], ["esc", "Close"]].map(([key, label]) => h("span", {}, h("kbd", {}, key), label)))),
        ),
        h("section", { class: "browser-detail" }, this.detail.el),
      ),
    );
  }

  async start() {
    setDialogAnchor(this.search.parentElement);
    window.addEventListener("keydown", (event) => this.onKey(event));
    this.list.addEventListener("click", (event) => {
      const index = Number(event.target.closest?.(".browser-row")?.dataset.index);
      if (Number.isFinite(index)) this.select(index);
    });
    this.search.focus();
    const repo = await muxy.git.repoInfo().catch(() => null);
    this.ctl.root = repo?.root ?? "";
    this.ctl.state.repo = repo;
    const cached = listCache.get(`${this.ctl.root}\nopen`);
    if (cached) this.setPrs(cached.prs);
    else setText(this.status, "Loading pull requests…");
    void git.readStatus().then((status) => (this.ctl.state.status = status)).catch(() => undefined);
    void forgeFor(this.ctl.root).then((forge) => (this.ctl.state.forge = forge.kind));
    await this.load(!!cached);
  }

  async load(quiet = false) {
    if (!quiet) setText(this.status, "Loading pull requests…");
    try {
      const forge = await forgeFor(this.ctl.root);
      const prs = await forge.api.list("open", 100);
      listCache.set(`${this.ctl.root}\nopen`, { prs, at: Date.now() });
      this.setPrs(prs);
    } catch (err) {
      setText(this.status, errorMessage(err));
      if (!this.prs.length) fill(this.list, h("div", { class: "placeholder" }, h("div", { class: "placeholder-title" }, "Couldn't load pull requests"), h("div", { class: "placeholder-detail" }, errorMessage(err))));
    }
  }

  setPrs(prs) {
    const selected = this.visible[this.selected]?.number;
    this.prs = prs;
    this.filter(selected);
    setText(this.status, `${prs.length} open pull request${prs.length === 1 ? "" : "s"}`);
  }

  filter(keep = null) {
    this.query = this.search.value.trim().toLowerCase();
    this.visible = this.prs.filter((pr) => matches(pr, this.query));
    const index = keep ? this.visible.findIndex((pr) => pr.number === keep) : 0;
    this.renderList();
    this.select(Math.max(0, index), true);
  }

  renderList() {
    setText(this.count, this.visible.length ? String(this.visible.length) : "");
    if (!this.visible.length) {
      fill(this.list, h("div", { class: "browser-empty" }, this.prs.length ? "No matching pull requests" : "No open pull requests"));
      return;
    }
    fill(
      this.list,
      this.visible.map((pr, index) => {
        const tone = prTone(pr);
        const checks = checksLabel(pr.checks);
        return h(
          "div",
          { class: "browser-row", dataset: { index: String(index) }, role: "option" },
          h("span", { class: `pr-icon pr-icon-${tone}` }, icon(STATE_ICON[tone], 14)),
          h(
            "span",
            { class: "browser-row-text" },
            h("span", { class: "browser-row-title" }, pr.title),
            h("span", { class: "browser-row-meta" }, [`#${pr.number}`, pr.author, relativeTime(pr.updatedAt)].filter(Boolean).join(" · ")),
          ),
          checks ? h("span", { class: cls("browser-checks", `tone-text-${pr.checks.status === "failure" ? "bad" : pr.checks.status === "success" ? "good" : "muted"}`), title: checks }, icon(pr.checks.status === "failure" ? "xCircle" : pr.checks.status === "pending" ? "loader" : "checkCircle", 12, pr.checks.status === "pending" ? "spin" : "")) : null,
        );
      }),
    );
  }

  select(index, force = false) {
    if (!this.visible.length) {
      this.detail.pr = null;
      fill(this.detail.el);
      return;
    }
    const next = Math.max(0, Math.min(this.visible.length - 1, index));
    if (next === this.selected && !force && this.detail.pr?.number === this.visible[next].number) return;
    this.selected = next;
    for (const row of this.list.querySelectorAll(".browser-row")) row.classList.toggle("browser-row-on", Number(row.dataset.index) === next);
    this.list.querySelector(".browser-row-on")?.scrollIntoView({ block: "nearest" });
    clearTimeout(this.detailTimer);
    this.detailTimer = setTimeout(() => void this.detail.open(this.visible[next]), force ? 0 : 120);
  }

  onKey(event) {
    const pr = this.visible[this.selected];
    const typing = event.target !== this.search && !!event.target.closest?.("input, textarea, select");
    if (event.key === "Escape" && typing) {
      event.preventDefault();
      return event.target.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      return close();
    }
    if (event.metaKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      return void this.load();
    }
    if (typing || event.target.closest?.(".popover")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      return this.select(this.selected + (event.key === "ArrowDown" ? 1 : -1));
    }
    if (event.key === "Enter" && pr && event.target === this.search) {
      event.preventDefault();
      if (event.shiftKey) return void ops.worktreePr(this.ctl, pr, this.search, () => close());
      return void ops.checkoutPr(this.ctl, pr).then((ok) => {
        if (!ok) return;
        toast(`Checked out #${pr.number}`, pr.title);
        close();
      });
    }
  }
}
