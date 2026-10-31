import { h, setText, toggle, fill } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { readJson, readString, writeJson, writeString } from "@/shared/prefs";
import { changeCount } from "@/core/status";
import { iconButton, placeholder } from "@/panel/ui";
import { onFrame } from "@/panel/store";
import { buildRows } from "@/panel/changes/model";
import { Composer } from "@/panel/changes/composer";
import { OperationBanner } from "@/panel/changes/banner";
import { ChangeList } from "@/panel/changes/list";
import { operationMessage } from "@/panel/ops/commit";

const VIEW_KEY = "muxy.git.changes.view";
const COLLAPSED_KEY = "muxy.git.changes.collapsed";

export class ChangesView {
  constructor(ctl) {
    this.ctl = ctl;
    this.tree = readString(VIEW_KEY, "list") === "tree";
    this.collapsed = new Set(readJson(COLLAPSED_KEY, []));
    this.filter = "";
    this.composer = new Composer(ctl);
    this.banner = new OperationBanner(ctl, this.composer);
    this.list = new ChangeList(ctl, { onToggle: (key) => this.toggleGroup(key) });
    this.summary = h("span", { class: "toolbar-text" });
    this.filterButton = iconButton("search", "Filter Changes (⌘F)", { onClick: () => this.toggleFilter(), small: true });
    this.viewButton = iconButton("tree", "", { onClick: () => this.toggleView(), small: true });
    this.filterInput = h("input", {
      class: "field",
      placeholder: "Filter changed files",
      spellcheck: "false",
      oninput: () => {
        this.filter = this.filterInput.value;
        this.schedule();
      },
      onkeydown: (event) => {
        if (event.key === "Escape") this.toggleFilter(false);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.list.el.focus();
          this.list.move(1, false);
        }
      },
    });
    this.filterRow = h("div", { class: "filter-row", hidden: true }, this.filterInput);
    this.empty = h("div", { class: "changes-empty", hidden: true }, placeholder("No changes", "Your working tree is clean."));
    this.el = h(
      "section",
      { class: "view changes" },
      this.banner.el,
      this.composer.el,
      h("div", { class: "toolbar" }, this.summary, this.filterButton, this.viewButton),
      this.filterRow,
      this.list.el,
      this.empty,
    );
    this.el.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        this.toggleFilter(true);
      }
    });
    this.schedule = onFrame(() => this.renderRows());
    this.syncViewButton();
  }

  toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    const keys = [...this.collapsed];
    writeJson(COLLAPSED_KEY, [...keys.filter((k) => k.startsWith("s:")), ...keys.filter((k) => k.startsWith("d:")).slice(-200)]);
    this.renderRows();
  }

  toggleView() {
    this.tree = !this.tree;
    writeString(VIEW_KEY, this.tree ? "tree" : "list");
    this.syncViewButton();
    this.renderRows();
  }

  syncViewButton() {
    this.viewButton.title = this.tree ? "View as List" : "View as Tree";
    fill(this.viewButton, icon(this.tree ? "list" : "tree", 13));
  }

  toggleFilter(force) {
    const open = force ?? this.filterRow.hidden;
    toggle(this.filterRow, !open);
    this.filterButton.classList.toggle("icon-btn-on", open);
    if (open) {
      this.filterInput.focus();
      this.filterInput.select();
    } else {
      this.filter = "";
      this.filterInput.value = "";
      this.list.el.focus();
    }
    this.renderRows();
  }

  renderRows() {
    const status = this.ctl.state.status;
    this.list.tree = this.tree;
    this.list.setRows(buildRows(status, { tree: this.tree, filter: this.filter, collapsed: this.collapsed }));
    const count = changeCount(status);
    setText(this.summary, count ? `${count} change${count === 1 ? "" : "s"}` : "No changes");
    toggle(this.empty, count > 0);
    toggle(this.list.el, count === 0);
  }

  update(state, prev) {
    this.composer.setRoot(state.repo?.root ?? null);
    if (state.status !== prev.status) this.schedule();
    if (state.status !== prev.status || state.op !== prev.op || state.busy !== prev.busy) {
      this.composer.sync();
      this.banner.update(state);
    }
    if (state.op && state.op !== prev.op && state.op !== "rebase" && !this.composer.message()) {
      void operationMessage().then((text) => {
        if (text && !this.composer.message() && this.ctl.state.op) this.composer.setMessage(text);
      });
    }
  }

  show() {
    this.schedule();
  }
}
