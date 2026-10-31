import { cls, h, fill } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenu } from "@/shared/menu";
import { VirtualList } from "@/shared/virtual-list";
import { iconButton, stat } from "@/panel/ui";
import { selectedEntries } from "@/panel/changes/model";
import * as ops from "@/panel/ops/changes";

const ROW_HEIGHT = 24;
const CODE_TITLE = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", T: "Type changed", U: "Untracked", "!": "Conflict" };

function rowActions(row) {
  const { type, section } = row;
  const out = [];
  if (type === "file") out.push(["openFile", "Open File", "openFile"]);
  if (section === "unstaged") out.push(["discard", type === "section" ? "Discard All Changes" : "Discard Changes", "undo"]);
  if (section === "staged") out.push(["unstage", type === "section" ? "Unstage All" : "Unstage", "minus"]);
  else if (section === "unstaged") out.push(["stage", type === "section" ? "Stage All" : "Stage", "plus"]);
  else if (type === "file") out.push(["stage", "Mark as Resolved", "check"]);
  return out;
}

export class ChangeList {
  constructor(ctl, { onToggle }) {
    this.ctl = ctl;
    this.onToggle = onToggle;
    this.rows = [];
    this.selected = new Set();
    this.cursor = null;
    this.anchor = null;
    this.canvas = h("div", { class: "list-canvas" });
    this.el = h("div", { class: "list", tabindex: "0", role: "tree", "aria-label": "Changes" }, this.canvas);
    this.list = new VirtualList(this.el, this.canvas, {
      rowHeight: ROW_HEIGHT,
      key: (row) => row.key,
      signature: (row) => `${this.selected.has(row.key) ? 1 : 0}${this.cursor === row.key ? 1 : 0}`,
      create: () => h("div", { class: "row", role: "treeitem" }),
      update: (el, row) => this.paint(el, row),
    });
    this.el.addEventListener("click", (event) => this.onClick(event));
    this.el.addEventListener("dblclick", (event) => this.onDoubleClick(event));
    this.el.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    this.el.addEventListener("keydown", (event) => this.onKey(event));
    this.el.addEventListener("focus", () => this.refreshSelection());
    this.el.addEventListener("blur", () => this.refreshSelection());
  }

  setRows(rows) {
    this.rows = rows;
    const keys = new Set(rows.map((row) => row.key));
    for (const key of [...this.selected]) if (!keys.has(key)) this.selected.delete(key);
    if (this.cursor && !keys.has(this.cursor)) this.cursor = null;
    this.list.setItems(rows);
  }

  paint(el, row) {
    const selected = this.selected.has(row.key);
    el.className = cls("row", `row-${row.type}`, selected && "row-selected", this.cursor === row.key && "row-cursor");
    el.style.setProperty("--depth", String(row.depth ?? 0));
    el.setAttribute("aria-selected", String(selected));
    const actions = h("span", { class: "row-actions" }, rowActions(row).map(([action, title, name]) => iconButton(name, title, { action, small: true })));
    if (row.type === "section") {
      el.setAttribute("aria-expanded", String(row.open));
      fill(el, 
        h("span", { class: cls("twisty", row.open && "twisty-open") }, icon("chevronRight", 12)),
        h("span", { class: "section-label" }, row.label),
        h("span", { class: "count" }, String(row.count)),
        actions,
      );
      return;
    }
    if (row.type === "folder") {
      el.setAttribute("aria-expanded", String(row.open));
      fill(el, 
        h("span", { class: cls("twisty", row.open && "twisty-open") }, icon("chevronRight", 12)),
        h("span", { class: "row-icon" }, icon("folder", 13)),
        h("span", { class: "row-name", title: row.path }, row.name),
        h("span", { class: "row-meta" }, String(row.entries.length)),
        actions,
      );
      return;
    }
    el.removeAttribute("aria-expanded");
    const { entry } = row;
    const tree = row.depth > 0 || this.tree;
    fill(el, 
      tree ? h("span", { class: "twisty" }) : null,
      h("span", { class: `code code-${entry.code}`, title: CODE_TITLE[entry.code] ?? entry.code }, entry.code),
      h("span", { class: cls("row-name", entry.code === "D" && "row-deleted"), title: entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path }, entry.name),
      !tree && (entry.dir || entry.oldPath) ? h("span", { class: "row-dir" }, entry.oldPath ? `← ${entry.oldPath}` : entry.dir) : null,
      h("span", { class: "row-end" }, stat(entry.additions, entry.deletions), entry.binary ? h("span", { class: "row-meta" }, "binary") : null),
      actions,
    );
  }

  refreshSelection() {
    this.el.classList.toggle("list-focused", document.activeElement === this.el);
    this.list.invalidate();
    this.list.render();
  }

  rowFromEvent(event) {
    const el = event.target.closest?.(".row");
    return el && this.canvas.contains(el) ? el._item : null;
  }

  selectOnly(row) {
    this.selected = new Set(row.type === "file" ? [row.key] : []);
    this.cursor = row.key;
    this.anchor = row.key;
    this.refreshSelection();
  }

  selectRange(row) {
    const from = this.rows.findIndex((r) => r.key === (this.anchor ?? this.cursor));
    const to = this.rows.findIndex((r) => r.key === row.key);
    if (from === -1) return this.selectOnly(row);
    const [start, end] = from < to ? [from, to] : [to, from];
    this.selected = new Set(this.rows.slice(start, end + 1).filter((r) => r.type === "file").map((r) => r.key));
    this.cursor = row.key;
    this.refreshSelection();
  }

  targets(row) {
    if (row?.type === "file" && this.selected.has(row.key) && this.selected.size > 1) return selectedEntries(this.rows, this.selected);
    return row?.type === "file" ? [row] : [];
  }

  onClick(event) {
    const row = this.rowFromEvent(event);
    if (!row) return;
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (action) {
      event.stopPropagation();
      this.runAction(action, row, false);
      return;
    }
    if (event.shiftKey) return this.selectRange(row);
    if (event.metaKey || event.ctrlKey) {
      if (row.type !== "file") return;
      if (this.selected.has(row.key)) this.selected.delete(row.key);
      else this.selected.add(row.key);
      this.cursor = row.key;
      this.anchor = row.key;
      return this.refreshSelection();
    }
    this.selectOnly(row);
    this.activate(row);
  }

  onDoubleClick(event) {
    const row = this.rowFromEvent(event);
    if (row?.type === "file" && !event.target.closest?.("[data-action]") && row.entry.code !== "D") ops.openFile(row.entry);
  }

  activate(row) {
    if (row.type === "file") ops.openDiff(this.ctl, row.entry, row.section);
    else this.onToggle(row.key);
  }

  runAction(action, row, useSelection) {
    const rows = useSelection ? this.targets(row) : row.type === "file" ? [row] : [];
    const entries = row.type === "file" ? rows.map((r) => r.entry) : row.entries;
    const paths = entries.map((entry) => entry.path);
    if (action === "openFile") return entries.forEach((entry) => entry.code !== "D" && ops.openFile(entry));
    if (action === "stage") return ops.stagePaths(this.ctl, paths);
    if (action === "unstage") return ops.unstagePaths(this.ctl, paths);
    if (action === "discard") return ops.discardEntries(this.ctl, entries.filter((entry) => entry.code !== "!"));
  }

  onContextMenu(event) {
    const row = this.rowFromEvent(event);
    if (!row) return;
    event.preventDefault();
    if (!this.selected.has(row.key)) this.selectOnly(row);
    const items = row.type === "file" ? this.fileMenu(row) : this.groupMenu(row);
    openMenu(items, event.clientX, event.clientY, (restore) => restore && this.el.focus());
  }

  groupMenu(row) {
    return rowActions(row).map(([action, title]) => ({ label: title, danger: action === "discard", run: () => this.runAction(action, row, false) }));
  }

  fileMenu(row) {
    const rows = this.targets(row);
    const entries = rows.map((r) => r.entry);
    const single = entries.length === 1 ? entries[0] : null;
    const section = row.section;
    const plural = entries.length > 1 ? ` (${entries.length})` : "";
    return [
      { label: "Open Changes", run: () => rows.forEach((r) => ops.openDiff(this.ctl, r.entry, r.section)) },
      { label: "Open File", disabled: entries.every((entry) => entry.code === "D"), run: () => this.runAction("openFile", row, true) },
      single ? { label: "Reveal in Finder", run: () => ops.reveal(single) } : null,
      { label: entries.length > 1 ? "Copy Paths" : "Copy Path", run: () => ops.copyPath(entries) },
      "-",
      section === "staged" ? { label: `Unstage${plural}`, run: () => this.runAction("unstage", row, true) } : { label: section === "conflicts" ? `Mark as Resolved${plural}` : `Stage${plural}`, run: () => this.runAction("stage", row, true) },
      section === "unstaged" ? { label: `Discard Changes${plural}…`, danger: true, run: () => this.runAction("discard", row, true) } : null,
      section === "conflicts" && single ? "-" : null,
      section === "conflicts" && single ? { label: "Accept Current (Ours)", run: () => ops.resolveWith(this.ctl, single, "ours") } : null,
      section === "conflicts" && single ? { label: "Accept Incoming (Theirs)", run: () => ops.resolveWith(this.ctl, single, "theirs") } : null,
      single?.code === "U" ? "-" : null,
      single?.code === "U" ? { label: "Add to .gitignore", run: () => ops.ignore(this.ctl, single) } : null,
    ];
  }

  move(step, extend) {
    if (this.rows.length === 0) return;
    const index = this.rows.findIndex((row) => row.key === this.cursor);
    const next = this.rows[Math.max(0, Math.min(this.rows.length - 1, index === -1 ? 0 : index + step))];
    if (extend) this.selectRange(next);
    else this.selectOnly(next);
    this.list.scrollToIndex(this.rows.indexOf(next));
  }

  onKey(event) {
    const row = this.rows.find((r) => r.key === this.cursor) ?? null;
    const meta = event.metaKey || event.ctrlKey;
    let handled = true;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") this.move(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
    else if (event.key === "Enter" && row) this.activate(row);
    else if (event.key === "ArrowRight" && row && row.type !== "file" && !row.open) this.onToggle(row.key);
    else if (event.key === "ArrowLeft" && row && row.type !== "file" && row.open) this.onToggle(row.key);
    else if (event.key === " " && row) this.runAction(row.section === "staged" ? "unstage" : "stage", row, true);
    else if ((event.key === "Backspace" || event.key === "Delete") && row?.section === "unstaged") this.runAction("discard", row, true);
    else if (meta && event.key.toLowerCase() === "a") {
      this.selected = new Set(this.rows.filter((r) => r.type === "file").map((r) => r.key));
      this.refreshSelection();
    } else if (event.key === "Escape" && this.selected.size) {
      this.selected.clear();
      this.refreshSelection();
    } else handled = false;
    if (handled) event.preventDefault();
  }
}
