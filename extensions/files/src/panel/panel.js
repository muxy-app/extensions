import { TreeModel, entry_from_host } from "@/panel/model";
import { GitStatus } from "@/panel/git";
import { VirtualList } from "@/panel/virtual-list";
import { InlineInput } from "@/panel/inline-input";
import { close_menu, menu_open, open_menu } from "@/panel/menu";
import { cls, h, icon_svg } from "@/shared/dom";
import {
  ancestors_of,
  basename,
  changed_rel,
  depth_of,
  dir_path,
  is_within,
  parent_of,
  split_name,
  strip_slash,
} from "@/shared/paths";
import { material_icon, stroke_icon } from "@/shared/icons";
import { ACTIVE_KEY, announce_move, keep_editor, open_file, project_root } from "@/shared/editors";
import { alert_error, confirm_action, copy_text, error_message, open_externally, reveal_in_finder, toast } from "@/shared/actions";
import {
  load_icon_theme,
  read_json,
  remove_key,
  save_icon_theme,
  watch_icon_theme,
  watch_key,
  write_json,
  write_string,
} from "@/shared/prefs";

const ROW_HEIGHT = 24;
const MEMORY_PREFIX = "muxy.files.tree:";
const POINTER_KEY = "muxy.files.pointer-over-panel";
const MAX_REMEMBERED = 500;
const LIST_CONCURRENCY = 6;
const EVENT_FLUSH_MS = 40;
const SPRING_LOAD_MS = 650;
const TYPEAHEAD_RESET_MS = 700;

const GIT_LABEL = { M: "Modified", R: "Renamed", A: "Added", "?": "Untracked", D: "Deleted" };
const GIT_BADGE = { M: "M", R: "R", A: "A", "?": "U", D: "D" };
const GIT_CLASS = { M: "git-modified", R: "git-modified", A: "git-added", "?": "git-added", D: "git-deleted" };

const CHEVRON = [{ d: "M9 6l6 6-6 6" }];

function limiter(max) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= max || queue.length === 0) return;
    running += 1;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => {
      running -= 1;
      next();
    });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}

function validate_name(name) {
  if (!name) return "A name is required.";
  if (name === "." || name === "..") return `“${name}” is reserved.`;
  if (name.includes("/") || name.includes("\0")) return "Names can’t contain “/”.";
  return null;
}

export class FilesPanel {
  constructor(root) {
    this.host = root;
    this.model = new TreeModel();
    this.git = new GitStatus(() => this.onGitChange());
    this.limit = limiter(LIST_CONCURRENCY);
    this.loads = new Map();
    this.stale = new Set();
    this.root = null;
    this.generation = 0;
    this.status = "loading";
    this.error = null;

    this.selection = new Set();
    this.cursor = null;
    this.anchor = null;
    this.pendingSelect = null;

    this.filter = false;
    this.filterCollapsed = new Set();
    this.iconTheme = load_icon_theme();

    this.editing = null;
    this.drag = null;
    this.drop = null;
    this.springTimer = 0;
    this.typeahead = { text: "", timer: 0 };

    this.pendingDirs = new Set();
    this.pendingAll = false;
    this.flushTimer = 0;
    this.memoryTimer = 0;
    this.rowsFrame = 0;
    this.disposers = [];
  }

  // ---- Lifecycle -------------------------------------------------------------

  start() {
    this.filterBar = h("div", { class: "filter-bar", hidden: true });
    this.canvas = h("div", { class: "tree-canvas" });
    this.placeholder = h("div", { class: "tree-placeholder", hidden: true });
    this.scroller = h("div", {
      class: "tree",
      role: "tree",
      tabindex: "0",
      "aria-label": "Files",
      "aria-multiselectable": "true",
    });
    this.scroller.append(this.canvas, this.placeholder);
    this.host.replaceChildren(h("div", { class: "files" }, this.filterBar, this.scroller));

    this.list = new VirtualList(this.scroller, this.canvas, {
      rowHeight: ROW_HEIGHT,
      idPrefix: "row-",
      key: (entry) => entry.path,
      signature: (entry) => this.signature(entry),
      create: () => this.createRow(),
      update: (el, entry) => this.updateRow(el, entry),
      release: (el) => {
        // Pooled rows keep no identity, so selectors never match a hidden row.
        delete el.dataset.path;
        el._item = null;
      },
    });

    this.bindPointer();
    this.bindKeyboard();
    this.bindDrag();

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.disposers.push(() => target.removeEventListener(type, fn, opts));
    };
    on(window, "focus", () => this.focusTree());
    on(document, "contextmenu", (event) => {
      if (!event.target.closest?.(".inline-input-wrap")) event.preventDefault();
    });
    on(document, "mousemove", () => this.setPointerOver(true));
    on(document.documentElement, "mouseleave", () => this.setPointerOver(false));
    on(window, "pagehide", () => this.setPointerOver(false));

    const sub = (name, fn) => this.disposers.push(muxy.events.subscribe(name, fn));
    sub("file.changed", (payload) => this.onFileChanged(payload));
    sub("project.switched", () => void this.reload());
    sub("worktree.switched", () => void this.reload());
    sub("panel.opened", (payload) => {
      if ((payload?.panelID ?? payload?.panelId ?? payload?.id) === "files") requestAnimationFrame(() => this.focusTree());
    });
    sub("command.files-toggle-dirty-filter", () => void this.toggleFilter());
    sub("command.files-toggle-icon-theme", () => save_icon_theme(this.iconTheme === "material" ? "stroke" : "material"));
    sub("command.files-collapse-all", () => this.collapseAll());
    this.disposers.push(
      muxy.onFocus?.((focused) => focused && this.focusTree()) ?? (() => {}),
      watch_icon_theme((theme) => {
        this.iconTheme = theme;
        this.list.invalidate();
        this.list.render();
      }),
      watch_key(ACTIVE_KEY, () => this.onActiveEditor()),
    );

    void this.reload();
  }

  dispose() {
    close_menu();
    this.cancelEdit();
    this.git.dispose();
    this.list.dispose();
    for (const dispose of this.disposers) dispose?.();
    this.disposers = [];
    clearTimeout(this.flushTimer);
    clearTimeout(this.memoryTimer);
    clearTimeout(this.springTimer);
    clearTimeout(this.typeahead.timer);
    if (this.rowsFrame) cancelAnimationFrame(this.rowsFrame);
    this.setPointerOver(false);
  }

  /** Loads the current project from scratch (start, project or worktree switch). */
  async reload() {
    const generation = ++this.generation;
    close_menu();
    this.cancelEdit();
    this.git.reset();
    this.model.reset();
    this.loads.clear();
    this.stale.clear();
    this.pendingDirs.clear();
    this.pendingAll = false;
    this.selection = new Set();
    this.cursor = this.anchor = null;
    this.filterCollapsed.clear();
    this.status = "loading";
    this.root = null;
    this.refreshRows();

    const rootPromise = project_root({ fresh: true });
    const listing = this.list_dir("").then(
      (entries) => ({ entries }),
      (error) => ({ error }),
    );
    void this.git.refresh();

    const root = await rootPromise;
    const result = await listing;
    if (generation !== this.generation) return;
    this.root = root;
    if (result.error) {
      this.status = "error";
      this.error = error_message(result.error);
      this.refreshRows();
      return;
    }
    this.model.setChildren("", result.entries);
    this.status = "ready";
    this.refreshRows();
    this.focusTree({ initial: true });

    await this.restoreMemory(generation);
    if (generation !== this.generation) return;
    if (this.filter) await this.loadChanged();
    this.onActiveEditor({ center: true });
  }

  async restoreMemory(generation) {
    const memory = this.root ? read_json(MEMORY_PREFIX + this.root) : null;
    const expanded = Array.isArray(memory?.expanded) ? memory.expanded.filter((p) => typeof p === "string" && p.endsWith("/")) : [];
    // Every folder that will be on screen is listed at once (bounded by the
    // limiter) instead of level by level, so restoring costs ~one round trip.
    // Open folders inside collapsed ones load when they come into view.
    const remembered = new Set(expanded);
    const visible = expanded.filter((dir) => ancestors_of(dir).every((a) => remembered.has(a)));
    const loaded = await Promise.all(visible.map((dir) => this.load(dir).then(() => this.model.isLoaded(dir))));
    if (generation !== this.generation) return;
    const gone = new Set(visible.filter((_, i) => !loaded[i]));
    for (const dir of expanded) if (!gone.has(dir)) this.model.expanded.add(dir);
    const selected = typeof memory?.selected === "string" ? memory.selected : null;
    if (selected && !this.cursor) {
      this.cursor = this.anchor = selected;
      this.selection = new Set([selected]);
    }
    this.refreshRows();
    if (selected && this.model.indexOf(selected) !== -1 && !this.revealedActive) {
      this.list.scrollToIndex(this.model.indexOf(selected), { center: true });
    }
  }

  saveMemory() {
    if (!this.root) return;
    clearTimeout(this.memoryTimer);
    const key = MEMORY_PREFIX + this.root;
    this.memoryTimer = setTimeout(() => {
      write_json(key, { expanded: [...this.model.expanded].slice(-MAX_REMEMBERED), selected: this.cursor });
    }, 250);
  }

  // ---- Loading -----------------------------------------------------------------

  list_dir(dir) {
    let pending = this.loads.get(dir);
    if (!pending) {
      pending = this.limit(() => muxy.files.list(strip_slash(dir)))
        .then((items) => items.map(entry_from_host))
        .finally(() => this.loads.delete(dir));
      this.loads.set(dir, pending);
    }
    return pending;
  }

  /** Lists `dir` into the model. Resolves true when the visible tree changed. */
  async load(dir) {
    const generation = this.generation;
    this.stale.delete(dir);
    try {
      const entries = await this.list_dir(dir);
      if (generation !== this.generation) return false;
      return this.model.setChildren(dir, entries);
    } catch {
      if (generation !== this.generation || dir === "" || !this.model.get(dir)) return false;
      // The folder is gone (deleted or renamed underneath us).
      this.model.remove(dir);
      return true;
    }
  }

  async ensureLoaded(dir) {
    if (this.model.isLoaded(dir) && !this.stale.has(dir)) return;
    if (this.model.isLoaded(dir)) {
      // Show the cached listing now; refresh it in the background.
      void this.load(dir).then((changed) => changed && this.requestRows());
      return;
    }
    await this.load(dir);
  }

  /** Lists every folder holding a changed file, for the changed-files view. */
  async loadChanged() {
    const dirs = new Set([""]);
    for (const path of this.git.changedFiles.keys()) for (const dir of ancestors_of(path)) dirs.add(dir);
    const results = await Promise.all([...dirs].map((dir) => (this.model.isLoaded(dir) ? false : this.load(dir))));
    if (results.some(Boolean)) this.requestRows();
  }

  // ---- File and git events -------------------------------------------------------

  onFileChanged(payload) {
    if (!this.root || this.status !== "ready") return;
    const rel = changed_rel(payload, this.root);
    if (rel === null) return;
    if (rel === "") {
      this.pendingAll = true;
      this.git.schedule();
    } else if (rel === ".git" || rel.startsWith(".git/")) {
      this.git.schedule();
      return;
    } else {
      // Re-list the nearest loaded folder when the change is inside it, or
      // creates a folder it doesn't know yet (FSEvents may only report the
      // deepest path of a new nested folder).
      const parent = parent_of(rel);
      let dir = parent;
      while (dir !== "" && !this.model.isLoaded(dir)) dir = parent_of(dir);
      if (dir === parent || !this.model.get(rel.slice(0, rel.indexOf("/", dir.length) + 1))) this.touch(dir);
      if (this.model.isLoaded(`${rel}/`)) this.touch(`${rel}/`);
      if (!this.model.isUnderIgnored(rel) && !this.model.get(rel)?.ignored) this.git.schedule();
    }
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushChanges(), EVENT_FLUSH_MS);
  }

  /** Visible folders are re-listed now; collapsed ones refresh on next open. */
  touch(dir) {
    if (this.isOnScreen(dir)) this.pendingDirs.add(dir);
    else this.stale.add(dir);
  }

  isOnScreen(dir) {
    if (dir === "") return true;
    if (this.filter) return true;
    for (let d = dir; d !== ""; d = parent_of(d)) if (!this.model.expanded.has(d)) return false;
    return true;
  }

  async flushChanges() {
    this.flushTimer = 0;
    let dirs;
    if (this.pendingAll) {
      dirs = this.model.loadedDirs().filter((dir) => {
        if (this.isOnScreen(dir)) return true;
        this.stale.add(dir);
        return false;
      });
    } else {
      dirs = [...this.pendingDirs];
    }
    this.pendingAll = false;
    this.pendingDirs.clear();
    const results = await Promise.all(dirs.map((dir) => this.load(dir)));
    if (!results.some(Boolean)) return;
    this.dropMissingSelection();
    this.requestRows();
  }

  onGitChange() {
    if (this.filter) {
      void this.loadChanged().then(() => this.requestRows());
      return;
    }
    this.list.render();
  }

  dropMissingSelection() {
    for (const path of this.selection) if (!this.model.get(path)) this.selection.delete(path);
    if (this.cursor && !this.model.get(this.cursor)) this.cursor = [...this.selection].at(-1) ?? null;
  }

  // ---- Rendering -----------------------------------------------------------------

  filterSpec() {
    if (!this.filter) return null;
    return {
      visible: (entry) => this.git.statusOf(entry) !== null,
      open: (entry) => !this.filterCollapsed.has(entry.path),
    };
  }

  isOpen(entry) {
    return this.filter ? !this.filterCollapsed.has(entry.path) : this.model.expanded.has(entry.path);
  }

  /** Coalesces structural refreshes from async work into one per frame. */
  requestRows() {
    if (this.rowsFrame) return;
    this.rowsFrame = requestAnimationFrame(() => {
      this.rowsFrame = 0;
      this.refreshRows();
    });
  }

  refreshRows() {
    if (this.rowsFrame) {
      cancelAnimationFrame(this.rowsFrame);
      this.rowsFrame = 0;
    }
    const rows = this.status === "ready" ? this.model.flatten(this.filterSpec()) : [];
    this.list.setItems(rows);
    // Open folders without a listing yet (restored, renamed, or opened while
    // their parent was collapsed) fill in as their listings arrive.
    for (const dir of this.model.missing) {
      if (!this.loads.has(dir)) void this.load(dir).then((changed) => changed && this.requestRows());
    }
    this.renderPlaceholder(rows.length);
    this.renderFilterBar();
    this.placeEditor();
    this.syncActiveDescendant();
  }

  renderPlaceholder(count) {
    let content = null;
    if (this.status === "loading") content = null;
    else if (this.status === "error") content = [h("div", { class: "placeholder-title" }, "Can’t show this folder"), h("div", {}, this.error)];
    else if (count === 0 && this.filter) {
      content = [
        h("div", { class: "placeholder-title" }, this.git.available ? "No changes" : "Not a git repository"),
        h("button", { type: "button", class: "link-button", onClick: () => void this.toggleFilter() }, "Show all files"),
      ];
    } else if (count === 0) content = [h("div", { class: "placeholder-title" }, "No files")];
    this.placeholder.hidden = content === null;
    if (content) this.placeholder.replaceChildren(...content);
  }

  renderFilterBar() {
    this.filterBar.hidden = !this.filter;
    if (!this.filter) return;
    const count = this.git.changedFiles.size;
    this.filterBar.replaceChildren(
      h("span", { class: "filter-label" }, count === 1 ? "1 changed file" : `${count} changed files`),
      h("button", { type: "button", class: "link-button", onClick: () => void this.toggleFilter() }, "Show All"),
    );
  }

  signature(entry) {
    const git = this.git.statusOf(entry) ?? "";
    return `${entry.depth}${entry.dir ? (this.isOpen(entry) ? "o" : "c") : "f"}${this.selection.has(entry.path) ? "s" : ""}${
      this.cursor === entry.path ? "k" : ""
    }${this.drop === entry.path ? "d" : ""}${this.editing?.path === entry.path ? "e" : ""}${git}${this.iconTheme[0]}`;
  }

  createRow() {
    const twisty = h("span", { class: "row-twisty" }, icon_svg(CHEVRON, 12));
    const icon = h("span", { class: "row-icon" });
    const name = h("span", { class: "row-name" });
    const badge = h("span", { class: "row-badge" });
    const row = h("div", { class: "row", role: "treeitem", draggable: "true" }, twisty, icon, name, badge);
    row._icon = icon;
    row._name = name;
    row._badge = badge;
    row._iconKey = null;
    return row;
  }

  updateRow(row, entry) {
    const open = entry.dir && this.isOpen(entry);
    const selected = this.selection.has(entry.path);
    const git = this.git.statusOf(entry);
    row.dataset.path = entry.path;
    row.style.setProperty("--depth", String(entry.depth));
    row.className = cls(
      "row",
      entry.dir && "row-dir",
      open && "row-open",
      selected && "row-selected",
      this.cursor === entry.path && "row-cursor",
      entry.ignored && "row-ignored",
      this.drop === entry.path && "row-drop",
      (this.editing?.path === entry.path || entry.draft) && "row-editing",
      git && GIT_CLASS[git],
    );
    row.setAttribute("aria-level", String(entry.depth + 1));
    row.setAttribute("aria-selected", String(selected));
    if (entry.dir) row.setAttribute("aria-expanded", String(open));
    else row.removeAttribute("aria-expanded");
    row.draggable = !entry.draft;

    const iconKey = `${this.iconTheme}:${entry.dir ? (open ? "o" : "d") : entry.name}`;
    if (row._iconKey !== iconKey) {
      row._iconKey = iconKey;
      if (this.iconTheme === "material") {
        let img = row._icon.firstElementChild;
        if (!(img instanceof HTMLImageElement)) {
          img = h("img", { alt: "", width: "14", height: "14", draggable: "false" });
          row._icon.replaceChildren(img);
        }
        img.src = material_icon(entry.name, entry.dir);
      } else {
        row._icon.innerHTML = stroke_icon(entry.name, entry.dir ? (open ? "open" : "folder") : "file");
      }
    }
    if (row._name.textContent !== entry.name) row._name.textContent = entry.name;
    row.title = entry.draft ? "" : entry.path.replace(/\/$/, "");
    const badge = !entry.dir && git ? GIT_BADGE[git] : "";
    if (row._badge.textContent !== badge) row._badge.textContent = badge;
    row._badge.title = git ? GIT_LABEL[git] : "";
  }

  syncActiveDescendant() {
    const index = this.cursor ? this.model.indexOf(this.cursor) : -1;
    if (index === -1) this.scroller.removeAttribute("aria-activedescendant");
    else this.scroller.setAttribute("aria-activedescendant", `row-${index}`);
  }

  /** Re-renders rows whose state changed (selection, git, drop target). */
  paint() {
    this.list.render();
    this.syncActiveDescendant();
  }

  // ---- Selection -----------------------------------------------------------------

  rows() {
    return this.model.rows;
  }

  select(path, { extend = false, toggle = false, reveal = true } = {}) {
    if (!path) return;
    if (toggle) {
      const next = new Set(this.selection);
      if (next.has(path) && next.size > 1) next.delete(path);
      else next.add(path);
      this.selection = next;
      this.anchor = path;
    } else if (extend && this.anchor && this.model.indexOf(this.anchor) !== -1) {
      const a = this.model.indexOf(this.anchor);
      const b = this.model.indexOf(path);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      this.selection = new Set(this.rows().slice(lo, hi + 1).filter((entry) => !entry.draft).map((entry) => entry.path));
    } else {
      this.selection = new Set([path]);
      this.anchor = path;
    }
    this.cursor = path;
    this.paint();
    if (reveal) this.list.scrollToIndex(this.model.indexOf(path));
    this.saveMemory();
  }

  selectedPaths() {
    return this.rows().filter((entry) => this.selection.has(entry.path) && !entry.draft).map((entry) => entry.path);
  }

  // ---- Pointer ----------------------------------------------------------------------

  rowFromEvent(event) {
    const row = event.target.closest?.(".row");
    return row && row._item && !row.hidden ? row._item : null;
  }

  bindPointer() {
    this.scroller.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const entry = this.rowFromEvent(event);
      if (!entry || entry.draft) return;
      this.pointerDown = { path: entry.path, deferred: false };
      if (event.metaKey || event.ctrlKey) this.select(entry.path, { toggle: true, reveal: false });
      else if (event.shiftKey) this.select(entry.path, { extend: true, reveal: false });
      // Pressing an already-selected row keeps a multi-selection intact until
      // release, so it can be dragged; a plain click then narrows it.
      else if (this.selection.has(entry.path) && this.selection.size > 1) this.pointerDown.deferred = true;
      else this.select(entry.path, { reveal: false });
    });

    // Every click acts, including the 2nd, 3rd, … of a rapid series: clicking
    // a folder repeatedly keeps toggling it. Re-opening a file is harmless —
    // `open_file` focuses the tab it just opened instead of adding another.
    this.scroller.addEventListener("click", (event) => {
      const entry = this.rowFromEvent(event);
      if (!entry) {
        if (event.target === this.scroller || event.target === this.canvas) this.clearSelection();
        this.focusTree();
        return;
      }
      if (entry.draft || event.metaKey || event.ctrlKey || event.shiftKey) return this.focusTree();
      const pressed = this.pointerDown?.path === entry.path ? this.pointerDown : null;
      // Narrow a deferred multi-selection; also covers clicks with no
      // preceding pointerdown (assistive tech, synthetic events).
      if (!pressed || pressed.deferred) this.select(entry.path, { reveal: false });
      this.pointerDown = null;
      this.focusTree();
      this.activate(entry);
    });

    // Double-clicking a file keeps its tab, as in an IDE: the next file you
    // open goes to a new tab instead of replacing this one.
    this.scroller.addEventListener("dblclick", (event) => {
      const entry = this.rowFromEvent(event);
      if (entry && !entry.dir && !entry.draft) keep_editor(this.root, entry.path);
    });

    this.scroller.addEventListener("pointerover", (event) => {
      const entry = this.rowFromEvent(event);
      // Hovering a closed folder lists it ahead of the click.
      if (entry?.dir && !entry.draft && !this.model.isLoaded(entry.path)) void this.list_dir(entry.path).catch(() => {});
    });

    this.scroller.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const entry = this.rowFromEvent(event);
      if (entry?.draft) return;
      if (entry && !this.selection.has(entry.path)) this.select(entry.path, { reveal: false });
      this.showMenu(entry, event.clientX, event.clientY);
    });
  }

  clearSelection() {
    if (this.selection.size === 0) return;
    this.selection = new Set();
    this.anchor = null;
    this.paint();
    this.saveMemory();
  }

  focusTree({ initial = false } = {}) {
    if (this.editing || menu_open()) return;
    const active = document.activeElement;
    if (active && active !== this.scroller && active !== document.body && /^(INPUT|TEXTAREA|BUTTON)$/.test(active.tagName)) return;
    if (initial && this.didInitialFocus) return;
    this.didInitialFocus = true;
    this.scroller.focus({ preventScroll: true });
  }

  setPointerOver(over) {
    if (this.pointerOver === over) return;
    this.pointerOver = over;
    if (over) write_string(POINTER_KEY, "1");
    else remove_key(POINTER_KEY);
  }

  // ---- Activation ----------------------------------------------------------------------

  activate(entry) {
    if (entry.dir) void this.toggle(entry.path);
    else void this.openFile(entry.path);
  }

  async openFile(path) {
    try {
      await open_file(path);
    } catch (err) {
      toast(error_message(err), "error", "Open file");
    }
  }

  async toggle(dir, open = !this.isOpen(this.model.get(dir) ?? { path: dir, dir: true })) {
    if (this.filter) {
      if (open) this.filterCollapsed.delete(dir);
      else this.filterCollapsed.add(dir);
      this.refreshRows();
      return;
    }
    if (!open) {
      this.model.expanded.delete(dir);
      if (this.cursor && is_within(this.cursor, dir)) this.select(dir);
      this.refreshRows();
      this.saveMemory();
      return;
    }
    this.model.expanded.add(dir);
    this.saveMemory();
    if (this.model.isLoaded(dir)) {
      this.refreshRows();
      void this.ensureLoaded(dir);
      return;
    }
    // Turn the chevron now; the children follow the listing.
    this.list.render();
    await this.load(dir);
    if (this.model.expanded.has(dir)) this.refreshRows();
  }

  collapseAll() {
    if (this.filter) {
      for (const entry of this.rows()) if (entry.dir) this.filterCollapsed.add(entry.path);
    } else {
      this.model.expanded.clear();
    }
    const top = this.cursor ? this.cursor.split("/")[0] : null;
    this.refreshRows();
    if (top) {
      const path = this.model.get(`${top}/`) ? `${top}/` : top;
      if (this.model.indexOf(path) !== -1) this.select(path);
    }
    this.scroller.scrollTop = 0;
    this.list.render();
    this.saveMemory();
  }

  async toggleFilter() {
    this.filter = !this.filter;
    this.filterCollapsed.clear();
    if (this.filter) {
      await this.git.refresh();
      await this.loadChanged();
    }
    this.refreshRows();
    if (this.cursor) this.list.scrollToIndex(this.model.indexOf(this.cursor), { center: true });
  }

  // ---- Reveal ------------------------------------------------------------------------

  onActiveEditor({ center = false } = {}) {
    const active = read_json(ACTIVE_KEY);
    if (!active || !this.root || active.root !== this.root || typeof active.path !== "string") return;
    if (this.lastRevealed === `${active.pane}:${active.path}:${active.at}`) return;
    this.lastRevealed = `${active.pane}:${active.path}:${active.at}`;
    this.revealedActive = true;
    void this.reveal(active.path, { center });
  }

  async reveal(path, { center = true } = {}) {
    if (this.filter || this.status !== "ready") return;
    const generation = this.generation;
    const dirs = ancestors_of(path);
    // All ancestors are listed in parallel rather than one level at a time.
    await Promise.all(["", ...dirs].map((dir) => this.ensureLoaded(dir)));
    if (generation !== this.generation || !this.model.get(path)) return;
    let opened = false;
    for (const dir of dirs) {
      if (!this.model.expanded.has(dir)) {
        this.model.expanded.add(dir);
        opened = true;
      }
    }
    if (opened) {
      this.refreshRows();
      this.saveMemory();
    }
    if (this.editing) return;
    this.selection = new Set([path]);
    this.cursor = this.anchor = path;
    this.paint();
    this.list.scrollToIndex(this.model.indexOf(path), { center });
    this.saveMemory();
  }

  // ---- Keyboard --------------------------------------------------------------------

  bindKeyboard() {
    this.scroller.addEventListener("keydown", (event) => {
      if (this.editing || menu_open() || event.target !== this.scroller) return;
      const rows = this.rows();
      const index = this.cursor ? this.model.indexOf(this.cursor) : -1;
      const entry = index === -1 ? null : rows[index];
      const extend = event.shiftKey;
      const page = Math.max(1, Math.floor(this.scroller.clientHeight / ROW_HEIGHT) - 1);
      const moveTo = (i) => {
        if (rows.length === 0) return;
        const target = rows[Math.max(0, Math.min(rows.length - 1, i))];
        this.select(target.path, { extend });
      };

      if ((event.metaKey && event.key === "Backspace") || (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace"))) {
        const paths = this.selectedPaths();
        if (paths.length === 0) return;
        event.preventDefault();
        void this.deletePaths(paths);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveTo(index === -1 ? 0 : index + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          moveTo(index === -1 ? rows.length - 1 : index - 1);
          return;
        case "PageDown":
          event.preventDefault();
          moveTo(index + page);
          return;
        case "PageUp":
          event.preventDefault();
          moveTo(index - page);
          return;
        case "Home":
          event.preventDefault();
          moveTo(0);
          return;
        case "End":
          event.preventDefault();
          moveTo(rows.length - 1);
          return;
        case "ArrowRight":
          event.preventDefault();
          if (!entry) return moveTo(0);
          if (!entry.dir) return;
          if (!this.isOpen(entry)) void this.toggle(entry.path, true);
          else if (rows[index + 1]?.depth > entry.depth) this.select(rows[index + 1].path);
          return;
        case "ArrowLeft": {
          event.preventDefault();
          if (!entry) return moveTo(0);
          if (entry.dir && this.isOpen(entry)) return void this.toggle(entry.path, false);
          const parent = parent_of(entry.path);
          if (parent && this.model.indexOf(parent) !== -1) this.select(parent);
          return;
        }
        case "Enter":
        case " ":
          if (!entry) return;
          event.preventDefault();
          this.activate(entry);
          return;
        case "F2":
          if (!entry) return;
          event.preventDefault();
          this.startRename(entry.path);
          return;
        case "Escape":
          if (this.selection.size > 1 && this.cursor) {
            event.preventDefault();
            this.select(this.cursor);
          }
          return;
        default:
          this.typeAhead(event);
      }
    });
  }

  typeAhead(event) {
    if (event.key.length !== 1 || !/\S/.test(event.key)) return;
    event.preventDefault();
    clearTimeout(this.typeahead.timer);
    this.typeahead.text += event.key.toLowerCase();
    this.typeahead.timer = setTimeout(() => (this.typeahead.text = ""), TYPEAHEAD_RESET_MS);
    const rows = this.rows();
    const text = this.typeahead.text;
    const start = this.cursor ? this.model.indexOf(this.cursor) : -1;
    // A repeated single letter cycles; a longer prefix refines in place.
    const offset = text.length > 1 ? 0 : 1;
    for (let i = 0; i < rows.length; i += 1) {
      const entry = rows[(start + offset + i + rows.length) % rows.length];
      if (!entry.draft && entry.name.toLowerCase().startsWith(text)) {
        this.select(entry.path);
        return;
      }
    }
  }

  // ---- Context menu ----------------------------------------------------------------

  showMenu(entry, x, y) {
    const paths = entry ? this.selectedPaths() : [];
    const multi = paths.length > 1;
    const restore = () => this.focusTree();
    if (multi) {
      open_menu(
        [
          { label: "Reveal in Finder", run: () => reveal_in_finder(paths) },
          { label: "Copy Paths", run: () => this.copyPaths(paths, true) },
          { label: "Copy Relative Paths", run: () => this.copyPaths(paths, false) },
          "-",
          { label: `Delete ${paths.length} Items`, danger: true, hint: "⌘⌫", run: () => void this.deletePaths(paths) },
        ],
        x,
        y,
        restore,
      );
      return;
    }
    if (!entry) {
      open_menu(
        [
          { label: "New File…", run: () => void this.startCreate("", "file") },
          { label: "New Folder…", run: () => void this.startCreate("", "folder") },
          "-",
          { label: "Reveal in Finder", run: () => reveal_in_finder(".") },
          { label: "Open in Terminal", run: () => this.openTerminal("") },
          "-",
          { label: "Collapse All", run: () => this.collapseAll() },
          { label: "Refresh", run: () => void this.reload() },
        ],
        x,
        y,
        restore,
      );
      return;
    }
    const dir = entry.dir ? entry.path : parent_of(entry.path);
    open_menu(
      [
        ...(entry.dir ? [] : [{ label: "Open", run: () => void this.openFile(entry.path) }, { label: "Open with Default App", run: () => open_externally(entry.path) }, "-"]),
        { label: "New File…", run: () => void this.startCreate(dir, "file") },
        { label: "New Folder…", run: () => void this.startCreate(dir, "folder") },
        "-",
        { label: "Reveal in Finder", run: () => reveal_in_finder(entry.path) },
        { label: "Open in Terminal", run: () => this.openTerminal(dir) },
        "-",
        { label: "Copy Path", run: () => this.copyPaths([entry.path], true) },
        { label: "Copy Relative Path", run: () => this.copyPaths([entry.path], false) },
        "-",
        { label: "Rename…", hint: "F2", run: () => this.startRename(entry.path) },
        { label: "Duplicate", run: () => void this.duplicate(entry.path) },
        "-",
        { label: "Delete", danger: true, hint: "⌘⌫", run: () => void this.deletePaths([entry.path]) },
      ],
      x,
      y,
      restore,
    );
  }

  copyPaths(paths, absolute) {
    const text = paths
      .map((path) => {
        const rel = strip_slash(path);
        return absolute && this.root ? (rel ? `${this.root}/${rel}` : this.root) : rel || ".";
      })
      .join("\n");
    void copy_text(text, paths.length === 1 ? "Path copied" : `${paths.length} paths copied`);
  }

  openTerminal(dir) {
    const directory = strip_slash(dir);
    void muxy.tabs
      .open(directory ? { kind: "terminal", directory } : { kind: "terminal" })
      .catch((err) => toast(error_message(err), "error", "Open in Terminal"));
  }

  // ---- Inline editing (rename, new file / folder) ----------------------------------

  placeEditor() {
    if (!this.editing) return;
    const index = this.model.indexOf(this.editing.path);
    if (index === -1) {
      this.cancelEdit();
      return;
    }
    const entry = this.rows()[index];
    this.editing.input.place(index, entry.depth, ROW_HEIGHT);
  }

  beginEdit(path, value, selectEnd, commit) {
    this.cancelEdit();
    const index = this.model.indexOf(path);
    if (index === -1) return;
    const input = new InlineInput(this.canvas, {
      commit,
      cancel: () => this.cancelEdit(true),
    });
    this.editing = { path, input };
    this.list.scrollToIndex(index);
    this.paint();
    input.show(index, this.rows()[index].depth, ROW_HEIGHT, value, selectEnd);
  }

  cancelEdit(refocus = false) {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    editing.input.remove();
    if (this.model.draft) {
      this.model.setDraft(null);
      this.refreshRows();
    } else {
      this.paint();
    }
    if (refocus) this.focusTree();
  }

  nameTaken(parent, name, except = null) {
    const lower = name.toLowerCase();
    return (this.model.children.get(parent) ?? []).some((entry) => entry.path !== except && entry.name.toLowerCase() === lower);
  }

  startRename(path) {
    const entry = this.model.get(path);
    if (!entry || entry.draft) return;
    const { stem } = split_name(entry.name, entry.dir);
    this.beginEdit(path, entry.name, stem.length, async (value) => {
      if (!value || value === entry.name) {
        this.cancelEdit(true);
        return null;
      }
      const invalid = validate_name(value);
      if (invalid) return invalid;
      const parent = parent_of(path);
      if (this.nameTaken(parent, value, path)) return `“${value}” already exists here.`;
      try {
        await muxy.files.rename(strip_slash(path), value);
      } catch (err) {
        return error_message(err);
      }
      const to = entry.dir ? `${parent}${value}/` : `${parent}${value}`;
      const wasSelected = this.cursor === path;
      this.model.moveExpanded(path, to);
      this.model.remove(path);
      this.model.insert({ ...entry, path: to, name: value });
      this.announceMove(path, to);
      this.editing?.input.remove();
      this.editing = null;
      this.refreshRows();
      if (wasSelected || this.selection.has(path)) this.select(to);
      this.focusTree();
      void this.load(parent).then((changed) => changed && this.requestRows());
      return null;
    });
  }

  async startCreate(parent, kind) {
    if (this.filter) await this.toggleFilter();
    await this.ensureLoaded(parent);
    if (parent !== "" && !this.model.expanded.has(parent)) {
      this.model.expanded.add(parent);
      this.saveMemory();
    }
    this.cancelEdit();
    this.model.setDraft(parent, kind);
    this.refreshRows();
    const draftPath = this.model.draft.path;
    this.beginEdit(draftPath, "", 0, async (value) => {
      if (!value) {
        this.cancelEdit(true);
        return null;
      }
      const invalid = validate_name(value);
      if (invalid) return invalid;
      if (this.nameTaken(parent, value)) return `“${value}” already exists here.`;
      const rel = `${parent}${value}`;
      try {
        // Double-check on disk: never overwrite a file the listing hasn't shown yet.
        const exists = await muxy.files.stat(rel).then(() => true, () => false);
        if (exists) return `“${value}” already exists here.`;
        if (kind === "folder") await muxy.files.mkdir(rel);
        else await muxy.files.write(rel, "");
      } catch (err) {
        return error_message(err);
      }
      const path = kind === "folder" ? `${rel}/` : rel;
      this.model.setDraft(null);
      this.model.insert({ path, name: value, dir: kind === "folder", ignored: false, depth: depth_of(path) - 1 });
      this.editing?.input.remove();
      this.editing = null;
      this.refreshRows();
      this.select(path);
      this.focusTree();
      if (kind === "file") void this.openFile(path);
      void this.load(parent).then((changed) => changed && this.requestRows());
      return null;
    });
  }

  /** Lets editor tabs follow a rename or move of the file they show. */
  announceMove(from, to) {
    announce_move(this.root, from, to);
  }

  // ---- File operations ------------------------------------------------------------

  async duplicate(path) {
    const entry = this.model.get(path);
    if (!entry) return;
    const parent = parent_of(path);
    const { stem, ext } = split_name(entry.name, entry.dir);
    let name = `${stem} copy${ext}`;
    for (let n = 2; this.nameTaken(parent, name); n += 1) name = `${stem} copy ${n}${ext}`;
    const dest = `${parent}${name}`;
    try {
      const res = await muxy.exec(["cp", "-R", strip_slash(path), dest]);
      if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `cp exited with ${res.exitCode}`);
    } catch (err) {
      return alert_error("Duplicate", err);
    }
    const copy = entry.dir ? dir_path(dest) : dest;
    this.model.insert({ ...entry, path: copy, name });
    this.refreshRows();
    this.select(copy);
    void this.load(parent).then((changed) => changed && this.requestRows());
  }

  async deletePaths(paths) {
    // Deleting a folder already covers anything selected inside it.
    const targets = paths.filter((path) => !paths.some((other) => other !== path && other.endsWith("/") && is_within(path, other)));
    if (targets.length === 0) return;
    const label = targets.length === 1 ? `“${basename(targets[0])}”` : `${targets.length} items`;
    const ok = await confirm_action({
      title: `Move ${label} to the Trash?`,
      message: "You can restore items from the Trash.",
      confirmLabel: "Move to Trash",
      critical: true,
    });
    if (!ok) return this.focusTree();
    try {
      await muxy.files.delete(targets.map(strip_slash));
    } catch (err) {
      await alert_error("Delete", err);
      return this.focusTree();
    }
    // Land the cursor on the row after the deleted block (or before it).
    const rows = this.rows();
    const indices = targets.map((path) => this.model.indexOf(path)).filter((i) => i !== -1);
    const first = indices.length ? Math.min(...indices) : 0;
    const last = indices.length ? Math.max(...indices) : -1;
    let next = null;
    for (let i = last + 1; i < rows.length; i += 1) {
      if (!targets.some((path) => rows[i].path === path || is_within(rows[i].path, path))) {
        next = rows[i].path;
        break;
      }
    }
    for (const path of targets) this.model.remove(path);
    this.selection = new Set();
    this.refreshRows();
    const landing = next ?? this.rows()[first - 1]?.path ?? null;
    if (landing && this.model.indexOf(landing) !== -1) this.select(landing);
    this.focusTree();
  }

  async move(paths, target) {
    const sources = paths.filter((path) => parent_of(path) !== target && !(path.endsWith("/") && (path === target || is_within(target, path))));
    if (sources.length === 0) return;
    for (const path of sources) {
      if (this.nameTaken(target, basename(path))) {
        return alert_error("Move", new Error(`An item named “${basename(path)}” already exists in ${strip_slash(target) || "the project root"}.`));
      }
    }
    try {
      await muxy.files.move(sources.map(strip_slash), strip_slash(target));
    } catch (err) {
      return alert_error("Move", err);
    }
    const moved = [];
    for (const path of sources) {
      const to = `${target}${basename(path)}${path.endsWith("/") ? "/" : ""}`;
      const entry = this.model.get(path);
      this.model.moveExpanded(path, to);
      this.model.remove(path);
      if (entry && this.model.isLoaded(target)) this.model.insert({ ...entry, path: to, depth: depth_of(to) - 1 });
      this.announceMove(path, to);
      moved.push(to);
    }
    if (target !== "") this.model.expanded.add(target);
    await this.ensureLoaded(target);
    this.refreshRows();
    this.selection = new Set(moved.filter((path) => this.model.indexOf(path) !== -1));
    this.cursor = this.anchor = [...this.selection].at(-1) ?? null;
    this.paint();
    if (this.cursor) this.list.scrollToIndex(this.model.indexOf(this.cursor));
    this.saveMemory();
    this.focusTree();
  }

  // ---- Drag and drop -----------------------------------------------------------------

  bindDrag() {
    const DRAG_TYPE = "application/x-muxy-path";

    this.scroller.addEventListener("dragstart", (event) => {
      const entry = this.rowFromEvent(event);
      if (!entry || entry.draft || this.editing) return event.preventDefault();
      const paths = this.selection.has(entry.path) ? this.selectedPaths() : [entry.path];
      if (!this.selection.has(entry.path)) this.select(entry.path, { reveal: false });
      this.drag = { paths };
      const dt = event.dataTransfer;
      dt.effectAllowed = "copyMove";
      dt.setData(DRAG_TYPE, paths.join("\n"));
      if (this.root) {
        const abs = paths.map((path) => `${this.root}/${strip_slash(path)}`);
        dt.setData("text/uri-list", abs.map((p) => `file://${p.split("/").map(encodeURIComponent).join("/")}`).join("\r\n"));
        dt.setData("text/plain", abs.join("\n"));
      } else {
        dt.setData("text/plain", paths.map(strip_slash).join("\n"));
      }
    });

    this.scroller.addEventListener("dragover", (event) => {
      if (!this.drag || !event.dataTransfer?.types.includes(DRAG_TYPE)) return;
      const index = this.list.indexAtClientY(event.clientY);
      const entry = index === -1 ? null : this.rows()[index];
      const target = !entry ? "" : entry.dir ? entry.path : parent_of(entry.path);
      const allowed = this.drag.paths.some((path) => parent_of(path) !== target && !(path.endsWith("/") && (path === target || is_within(target, path))));
      event.preventDefault();
      event.dataTransfer.dropEffect = allowed ? "move" : "none";
      this.setDrop(allowed ? target : null, entry);
      this.autoScroll(event.clientY);
    });

    this.scroller.addEventListener("dragleave", (event) => {
      if (!this.scroller.contains(event.relatedTarget)) this.setDrop(null);
    });

    this.scroller.addEventListener("drop", (event) => {
      if (!this.drag) return;
      event.preventDefault();
      const target = this.drop;
      const paths = this.drag.paths;
      this.endDrag();
      if (target !== null) void this.move(paths, target);
    });

    this.scroller.addEventListener("dragend", () => this.endDrag());
  }

  setDrop(target, hovered = null) {
    if (target !== this.drop) {
      this.drop = target;
      this.scroller.classList.toggle("tree-drop-root", target === "");
      clearTimeout(this.springTimer);
      // Hovering a closed folder while dragging springs it open.
      if (target && hovered?.dir && hovered.path === target && !this.isOpen(hovered)) {
        this.springTimer = setTimeout(() => this.drop === target && void this.toggle(target, true), SPRING_LOAD_MS);
      }
      this.paint();
    }
  }

  autoScroll(clientY) {
    const rect = this.scroller.getBoundingClientRect();
    const edge = ROW_HEIGHT * 1.5;
    if (clientY < rect.top + edge) this.scroller.scrollTop -= ROW_HEIGHT / 2;
    else if (clientY > rect.bottom - edge) this.scroller.scrollTop += ROW_HEIGHT / 2;
  }

  endDrag() {
    this.drag = null;
    clearTimeout(this.springTimer);
    this.setDrop(null);
  }
}
