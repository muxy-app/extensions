import { cls, fill, h, setText } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { baseName, dirName } from "@/shared/paths";
import { readJson, readString, writeJson, writeString } from "@/shared/prefs";
import { VirtualList } from "@/shared/virtual-list";
import { buildRows } from "@/panel/changes/model";

const ROW_HEIGHT = 24;
const VIEW_KEY = "muxy.git.diff.view";
const COLLAPSED_KEY = "muxy.git.diff.collapsed";

function stat(item) {
  return h(
    "span",
    { class: "stat" },
    item.additions ? h("span", { class: "text-add" }, `+${item.additions}`) : null,
    item.deletions ? h("span", { class: "text-remove" }, `−${item.deletions}`) : null,
  );
}

export class FileRail {
  constructor({ onSelect, actionsFor, onAction }) {
    this.onSelect = onSelect;
    this.actionsFor = actionsFor;
    this.onAction = onAction;
    this.groups = [];
    this.rows = [];
    this.active = "";
    this.tree = readString(VIEW_KEY, "list") === "tree";
    this.collapsed = new Set(readJson(COLLAPSED_KEY, []));
    this.count = h("span", { class: "count" }, "0");
    this.viewButton = h("button", { type: "button", class: "icon-btn icon-btn-sm", onclick: () => this.toggleView() });
    this.canvas = h("div", { class: "list-canvas" });
    this.listEl = h("div", { class: "list rail-list", tabindex: "0", "aria-label": "Files" }, this.canvas);
    this.el = h("div", { class: "rail-body" }, h("div", { class: "rail-head" }, h("span", { class: "section-label" }, "Files"), this.count, h("span", { class: "spacer" }), this.viewButton), this.listEl);
    this.list = new VirtualList(this.listEl, this.canvas, {
      rowHeight: ROW_HEIGHT,
      key: (row) => row.key,
      signature: (row) => (row.entry?.id === this.active ? "1" : "0"),
      create: () => h("div", { class: "row" }),
      update: (el, row) => this.paint(el, row),
    });
    this.listEl.addEventListener("click", (event) => this.onClick(event));
    this.listEl.addEventListener("keydown", (event) => this.onKey(event));
    this.syncViewButton();
  }

  syncViewButton() {
    this.viewButton.title = this.tree ? "View as List" : "View as Tree";
    fill(this.viewButton, icon(this.tree ? "list" : "tree", 13));
  }

  toggleView() {
    this.tree = !this.tree;
    writeString(VIEW_KEY, this.tree ? "tree" : "list");
    this.syncViewButton();
    this.renderRows();
  }

  setGroups(groups) {
    this.groups = groups.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, name: baseName(item.path), dir: dirName(item.path) })) }));
    setText(this.count, String(groups.reduce((sum, group) => sum + group.items.length, 0)));
    this.renderRows();
  }

  renderRows() {
    const sections = this.groups.map((group) => ({ id: group.id, label: group.label }));
    const source = Object.fromEntries(this.groups.map((group) => [group.id, group.items]));
    const showHeaders = this.groups.filter((group) => group.items.length).length > 1;
    this.rows = buildRows(source, { tree: this.tree, collapsed: this.collapsed, sections }).filter((row) => showHeaders || row.type !== "section");
    this.list.setItems(this.rows);
  }

  setActive(id) {
    this.active = id;
    this.list.invalidate();
    this.list.render();
    const index = this.rows.findIndex((row) => row.entry?.id === id);
    if (index !== -1) this.list.scrollToIndex(index);
  }

  toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    writeJson(COLLAPSED_KEY, [...this.collapsed].slice(-200));
    this.renderRows();
  }

  paint(el, row) {
    el.style.setProperty("--depth", String(row.depth ?? 0));
    if (row.type === "section" || row.type === "folder") {
      el.className = cls("row", row.type === "section" ? "row-section" : "row-folder");
      el.title = row.path ?? row.label;
      fill(
        el,
        h("span", { class: cls("twisty", row.open && "twisty-open") }, icon("chevronRight", 12)),
        row.type === "folder" ? h("span", { class: "row-icon" }, icon("folder", 13)) : null,
        h("span", { class: row.type === "section" ? "section-label" : "row-name" }, row.type === "section" ? row.label : row.name),
        h("span", { class: "count" }, String(row.type === "section" ? row.count : row.entries.length)),
      );
      return;
    }
    const item = row.entry;
    el.className = cls("row", "row-file", item.id === this.active && "row-selected");
    el.title = item.oldPath ? `${item.oldPath} → ${item.path}` : item.path;
    const actions = this.actionsFor(item);
    fill(
      el,
      this.tree ? h("span", { class: "twisty" }) : null,
      h("span", { class: `code code-${item.code}` }, item.code),
      h("span", { class: cls("row-name", item.code === "D" && "row-deleted") }, item.name),
      this.tree ? null : h("span", { class: "row-dir" }, item.dir),
      h("span", { class: "row-end" }, stat(item)),
      actions.length
        ? h(
            "span",
            { class: "row-actions" },
            actions.map(([action, title, name]) => h("button", { type: "button", class: "icon-btn icon-btn-sm", title, "aria-label": title, dataset: { action } }, icon(name, 13))),
          )
        : null,
    );
  }

  onClick(event) {
    const el = event.target.closest?.(".row");
    const row = el && this.canvas.contains(el) ? el._item : null;
    if (!row) return;
    if (row.type !== "file") return this.toggleGroup(row.key);
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (action) this.onAction(action, row.entry);
    else this.onSelect(row.entry.id);
  }

  onKey(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const files = this.rows.filter((row) => row.type === "file");
    const index = files.findIndex((row) => row.entry.id === this.active);
    const next = files[Math.max(0, Math.min(files.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) this.onSelect(next.entry.id);
  }
}
