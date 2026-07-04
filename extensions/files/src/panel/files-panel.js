import {
  basename,
  canonical_dir,
  copy_path,
  copy_paths,
  entry_to_rel,
  open_externally,
  open_in_editor,
  parent_dir,
  reveal_in_finder,
  reveal_paths,
  strip_slash,
} from "@/lib/files";
import {
  create_file,
  create_folder,
  delete_paths,
  duplicate as duplicate_op,
  move_fs,
  rename_fs,
} from "@/lib/file-ops";
import { cls, h, icon_svg } from "@/lib/dom";
import { material_file_icon, material_folder_icon } from "@/lib/material-icon";
import { FOLDER_PATHS, icon_paths_for } from "@/lib/file-icon";
import { load_icon_theme, save_icon_theme, subscribe_icon_theme } from "@/lib/icon-theme";
import { load_tree_memory, save_tree_memory } from "@/lib/tree-memory";
import { GitStatusStore } from "@/lib/git-status";
import { OpenTabsStore } from "@/lib/open-tabs";

const RECONCILE_DEBOUNCE_MS = 250;

const GIT_STATUS_CLASS = {
  M: "file-tree-git-modified",
  R: "file-tree-git-modified",
  A: "file-tree-git-added",
  "?": "file-tree-git-added",
  D: "file-tree-git-deleted",
};

const GIT_STATUS_LABEL = {
  M: "Modified",
  R: "Renamed",
  A: "Added",
  "?": "Untracked",
  D: "Deleted",
};

const GIT_STATUS_GLYPH = {
  M: "M",
  R: "R",
  A: "A",
  "?": "U",
  D: "D",
};

function is_dir(path) {
  return path === "" || path.endsWith("/");
}

// panel.opened payloads aren't strongly documented; accept the common shapes.
function panel_id_of(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") return payload.panel ?? payload.id ?? payload.panelId ?? null;
  return null;
}

function focused_tab_id_of(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const id = payload.tabID ?? payload.tabId ?? payload.id ?? payload.tabInstanceID ?? payload.instanceID;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function block_ends_within(dirSegs, pathSegs, maxEnd) {
  if (dirSegs.length === 0) return true;
  for (let start = 0; start + dirSegs.length <= maxEnd; start++) {
    let matched = true;
    for (let i = 0; i < dirSegs.length; i++) {
      if (pathSegs[start + i] !== dirSegs[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function sorted_rels(entries) {
  return entries
    .map((entry) => entry_to_rel(entry))
    .sort((a, b) => {
      const ad = is_dir(a);
      const bd = is_dir(b);
      if (ad !== bd) return ad ? -1 : 1;
      return basename(a).localeCompare(basename(b), undefined, { sensitivity: "base" });
    });
}

function chevron_icon(expanded) {
  return icon_svg([{ d: expanded ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6" }]);
}

function depth_of(rel) {
  const trimmed = rel.endsWith("/") ? rel.slice(0, -1) : rel;
  return trimmed ? trimmed.split("/").length : 0;
}

function file_icon(kind, path, theme) {
  if (theme === "material") {
    return kind === "directory" ? material_folder_icon() : material_file_icon(path);
  }
  return icon_svg(kind === "directory" ? FOLDER_PATHS : icon_paths_for(path));
}

function path_after_rename(sourcePath, newName, isFolder) {
  const parent = parent_dir(sourcePath);
  return isFolder ? canonical_dir(`${parent}${newName}`) : `${parent}${newName}`;
}

function context_menu_actions(item, ops, selection) {
  const path = item.path;
  const multi = selection.length > 1 && selection.includes(path);
  if (multi) {
    return [
      { label: "Reveal in Finder", run: () => void ops.revealPaths(selection) },
      { label: "Copy Paths", run: () => void ops.copyPaths(selection) },
      { label: `Delete ${selection.length} items`, run: () => void ops.deletePaths(selection), critical: true },
    ];
  }

  const createDir = item.kind === "directory" ? path : parent_dir(path);
  const actions = [
    { label: "New File", run: () => void ops.createFile(createDir) },
    { label: "New Folder", run: () => void ops.createFolder(createDir) },
  ];

  if (path !== "") {
    actions.push(
      { label: "Rename", run: () => ops.rename(path) },
      { label: "Duplicate", run: () => void ops.duplicate(path) },
      { label: "Reveal in Finder", run: () => void ops.reveal(path) },
      { label: "Copy Path", run: () => void ops.copyPath(path) },
      { label: "Open Externally", run: () => void ops.openExternally(path) },
      { label: "Delete", run: () => void ops.deletePaths([path]), critical: true },
    );
  } else {
    actions.push({ label: "Refresh", run: () => void ops.refresh() });
  }

  return actions;
}

function create_context_menu(item, ops, close, selection = []) {
  const actions = context_menu_actions(item, ops, selection);
  return h(
    "div",
    { class: "ctx-menu ctx-menu-floating", dataset: { fileTreeContextMenuRoot: "true" } },
    actions.map((action, index) =>
      h(
        "button",
        {
          type: "button",
          class: cls("ctx-item", action.critical && "ctx-item-critical", action.critical && index > 0 && "ctx-item-spaced"),
          onClick: () => {
            close();
            action.run();
          },
        },
        action.label,
      ),
    ),
  );
}

export class FilesPanelApp {
  constructor(root) {
    this.root = root;
    this.entries = new Map();
    this.children = new Map();
    this.loadedDirs = new Set();
    this.expandedDirs = new Set();
    this.selectedPath = null;
    this.selectedPaths = new Set();
    this.anchorPath = null;
    this.worktreeRoot = null;
    this.dropTarget = null;
    this.renameState = null;
    this.activeRenameInput = null;
    this.pendingDirs = new Set();
    this.reconcileTimer = null;
    this.contextMenu = null;
    this.contextDisposers = [];
    this.disposers = [];
    this.gitStatus = new GitStatusStore();
    this.openTabs = new OpenTabsStore();
    this.dirtyFilter = false;
    this.iconTheme = load_icon_theme();
    // Keyboard navigation: `visiblePaths` is the rendered rows in display
    // order, `rowElements` maps each path to its row node so selection can be
    // updated without a full re-render.
    this.visiblePaths = [];
    this.rowElements = new Map();
    this.typeahead = { buffer: "", timer: null };
    this.didInitialFocus = false;

    this.ops = {
      createFile: (parentRel = "") => this.createFile(parentRel),
      createFolder: (parentRel = "") => this.createFolder(parentRel),
      deletePaths: (rels) => this.deletePaths(rels),
      duplicate: (rel) => this.duplicate(rel),
      rename: (rel) => this.startRename(rel),
      reveal: (rel) => reveal_in_finder(rel),
      revealPaths: (rels) => reveal_paths(rels),
      openExternally: (rel) => open_externally(rel),
      copyPath: (rel) => copy_path(rel),
      copyPaths: (rels) => this.copyPaths(rels),
      openInEditor: (rel) => this.openFile(rel),
      refresh: () => this.loadRoot(),
    };
  }

  async openFile(rel) {
    const tabId = await this.openTabs.resolveTabId(rel);
    return open_in_editor(rel, tabId);
  }

  async revealActiveTab(payload) {
    const tabId = focused_tab_id_of(payload);
    if (!tabId) return;
    const rel = await this.openTabs.resolveFilePath(tabId);
    if (!rel) return;
    await this.revealFile(rel);
  }

  async revealFile(rel) {
    if (!rel || this.dirtyFilter) return;
    const ancestors = [];
    let parent = parent_dir(rel);
    while (parent !== "") {
      ancestors.unshift(parent);
      parent = parent_dir(parent);
    }
    for (const dir of ancestors) {
      await this.ensureLoaded(parent_dir(dir));
      if (!this.entries.has(dir)) return;
      this.expandedDirs.add(dir);
      await this.ensureLoaded(dir);
    }
    if (!this.entries.has(rel)) return;
    this.setSelection(rel);
    this.render();
    this.persistMemory();
    const el = this.rowElements.get(rel);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  start() {
    this.filterBar = h("div", { class: "file-tree-filter-bar", hidden: true });
    const panel = h("div", { class: "files-panel" }, this.filterBar, h("div", { class: "file-tree-wrap" }));
    this.root.replaceChildren(panel);
    this.wrap = panel.querySelector(".file-tree-wrap");
    this.list = h("div", {
      class: "file-tree-list",
      role: "tree",
      // Focusable so the tree can be driven entirely from the keyboard. The
      // active row is tracked via aria-activedescendant while DOM focus stays
      // on this container (which survives the full re-render on each change).
      tabindex: 0,
      "aria-label": "File tree",
      onKeyDown: (event) => this.onKeyDown(event),
      onFocus: () => this.onListFocus(),
      onClick: (event) => {
        if (event.target !== this.list) return;
        this.clearSelection();
      },
      onContextMenu: (event) => {
        event.preventDefault();
        this.showContextMenu({ kind: "directory", name: "Root", path: "" }, event.clientX, event.clientY);
      },
      onDragOver: (event) => {
        event.preventDefault();
        this.dropTarget = "";
      },
      onDrop: (event) => this.dropPaths(event, ""),
    });
    this.wrap.appendChild(this.list);

    this.openTabs.start();

    // Take keyboard focus whenever Muxy hands this panel focus (e.g. after the
    // toggle-files shortcut) so arrow keys work without a click first.
    this.handleWindowFocus = () => this.focusList();
    window.addEventListener("focus", this.handleWindowFocus);

    document.addEventListener("contextmenu", this.preventNativeContextMenu);
    this.disposers.push(
      () => this.openTabs.dispose(),
      this.gitStatus.subscribe(() => this.onGitStatusChange()),
      muxy.events.subscribe("worktree.switched", () => void this.loadRoot()),
      muxy.events.subscribe("project.switched", () => void this.loadRoot()),
      // When our panel is (re)opened, pull keyboard focus into the tree so it's
      // navigable immediately without a click.
      muxy.events.subscribe("panel.opened", (payload) => {
        if (panel_id_of(payload) === "files") requestAnimationFrame(() => this.focusList());
      }),
      muxy.events.subscribe("tab.focused", (payload) => {
        void this.revealActiveTab(payload);
      }),
      muxy.events.subscribe("file.changed", (payload) => {
        this.scheduleReconcile(payload);
        this.gitStatus.scheduleRefresh(RECONCILE_DEBOUNCE_MS);
      }),
      muxy.events.subscribe("command.files-new-file", () => void this.createFile("")),
      muxy.events.subscribe("command.files-new-folder", () => void this.createFolder("")),
      muxy.events.subscribe("command.files-refresh", () => void this.loadRoot()),
      muxy.events.subscribe("command.files-toggle-dirty-filter", () => this.toggleDirtyFilter()),
      muxy.events.subscribe("command.files-toggle-icon-theme", () => this.toggleIconTheme()),
      subscribe_icon_theme((theme) => {
        if (theme === this.iconTheme) return;
        this.iconTheme = theme;
        this.render();
      }),
      () => this.gitStatus.dispose(),
      () => document.removeEventListener("contextmenu", this.preventNativeContextMenu),
      () => window.removeEventListener("focus", this.handleWindowFocus),
    );

    void this.loadRoot();
    void this.gitStatus.refresh();
  }

  preventNativeContextMenu = (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-file-tree-context-menu-root='true']")) return;
    event.preventDefault();
  };

  dispose() {
    this.closeContextMenu();
    for (const dispose of this.disposers) dispose?.();
    this.disposers = [];
    if (this.reconcileTimer !== null) clearTimeout(this.reconcileTimer);
    if (this.typeahead.timer !== null) clearTimeout(this.typeahead.timer);
  }

  recordChildren(dirRel, entries) {
    const byRel = new Map(entries.map((entry) => [entry_to_rel(entry), entry]));
    const rels = sorted_rels(entries);
    const previous = this.children.get(dirRel) ?? [];
    const nextSet = new Set(rels);
    for (const oldPath of previous) {
      if (!nextSet.has(oldPath)) this.removeSubtree(oldPath);
    }
    for (const rel of rels) {
      const entry = byRel.get(rel);
      this.entries.set(rel, {
        path: rel,
        kind: rel.endsWith("/") ? "directory" : "file",
        isIgnored: Boolean(entry?.isIgnored),
      });
    }
    this.children.set(dirRel, rels);
    this.loadedDirs.add(dirRel);
  }

  removeSubtree(path) {
    if (path.endsWith("/")) {
      for (const child of this.children.get(path) ?? []) this.removeSubtree(child);
      this.children.delete(path);
      this.loadedDirs.delete(path);
      this.expandedDirs.delete(path);
    }
    this.entries.delete(path);
    if (this.selectedPath === path) this.selectedPath = null;
    this.selectedPaths.delete(path);
    if (this.anchorPath === path) this.anchorPath = null;
  }

  async loadRoot() {
    this.entries.clear();
    this.children.clear();
    this.loadedDirs.clear();
    this.expandedDirs.clear();
    this.setSelection(null);
    this.closeContextMenu();
    this.worktreeRoot = await this.resolveRoot();
    try {
      const entries = await muxy.files.list("");
      this.recordChildren("", entries);
    } catch (err) {
      void muxy
        .toast({
          title: "Files",
          body: err instanceof Error ? err.message : String(err),
          variant: "error",
        })
        .catch(() => undefined);
      this.children.set("", []);
    }
    await this.restoreMemory();
    this.render();
    this.maybeInitialFocus();
    void this.gitStatus.refresh();
    void this.revealActiveOnLoad();
  }

  async revealActiveOnLoad() {
    const rel = await this.openTabs.activeFilePath();
    if (rel) await this.revealFile(rel);
  }

  async restoreMemory() {
    const { expanded, selected } = await load_tree_memory();
    const ordered = expanded.slice().sort((a, b) => depth_of(a) - depth_of(b));
    for (const dir of ordered) {
      const parent = parent_dir(dir);
      if (parent !== "" && !this.expandedDirs.has(parent)) continue;
      await this.ensureLoaded(parent);
      if (!this.entries.has(dir)) continue;
      this.expandedDirs.add(dir);
      await this.ensureLoaded(dir);
    }
    if (selected && this.entries.has(selected)) this.setSelection(selected);
  }

  persistMemory() {
    void save_tree_memory(this.expandedDirs, this.selectedPath);
  }

  async loadChildren(dirRel) {
    try {
      const entries = await muxy.files.list(dirRel);
      this.recordChildren(dirRel, entries);
    } catch {
      return;
    }
  }

  async ensureLoaded(dirRel) {
    if (!this.loadedDirs.has(dirRel)) await this.loadChildren(dirRel);
  }

  async reconcileDir(dirRel) {
    if (!this.loadedDirs.has(dirRel)) return;
    try {
      const entries = await muxy.files.list(dirRel);
      this.recordChildren(dirRel, entries);
      this.render();
    } catch {
      return;
    }
  }

  async toggleDirtyFilter() {
    this.dirtyFilter = !this.dirtyFilter;
    if (this.dirtyFilter) {
      await this.gitStatus.refresh();
      await this.ensureDirtyLoaded();
    }
    this.render();
  }

  toggleIconTheme() {
    save_icon_theme(this.iconTheme === "material" ? "stroke" : "material");
  }

  onGitStatusChange() {
    if (this.dirtyFilter) {
      void this.ensureDirtyLoaded().then(() => this.render());
      return;
    }
    this.render();
  }

  async ensureDirtyLoaded() {
    const dirs = new Set();
    for (const filePath of this.gitStatus.files.keys()) {
      let parent = parent_dir(filePath);
      while (parent !== "") {
        dirs.add(parent);
        parent = parent_dir(parent);
      }
    }
    const ordered = Array.from(dirs).sort((a, b) => a.length - b.length);
    for (const dir of ordered) await this.ensureLoaded(dir);
  }

  isVisibleInFilter(path, directory) {
    return Boolean(this.gitStatus.statusFor(path, directory));
  }

  renderFilterBar() {
    if (!this.filterBar) return;
    this.filterBar.hidden = !this.dirtyFilter;
    if (!this.dirtyFilter) {
      this.filterBar.replaceChildren();
      return;
    }
    this.filterBar.replaceChildren(
      h("span", { class: "file-tree-filter-label" }, "Changed files only"),
      h(
        "button",
        {
          type: "button",
          class: "file-tree-filter-clear",
          onClick: () => void this.toggleDirtyFilter(),
        },
        "Clear",
      ),
    );
  }

  render() {
    if (!this.list) return;
    const active = this.activeRenameInput;
    if (active && document.activeElement === active) {
      this.renameSelection = { start: active.selectionStart, end: active.selectionEnd };
    } else {
      this.renameSelection = null;
    }
    this.reRendering = true;
    try {
      this.renderTree();
    } finally {
      this.reRendering = false;
    }
    this.focusRenameInput();
  }

  renderTree() {
    if (!this.list) return;
    this.renderFilterBar();
    this.list.replaceChildren();
    this.visiblePaths = [];
    this.rowElements = new Map();
    const rootChildren = this.children.get("") ?? [];
    if (rootChildren.length === 0) {
      this.list.appendChild(h("div", { class: "files-status" }, "No files"));
      this.syncActiveDescendant();
      return;
    }
    if (this.dirtyFilter) {
      const visible = rootChildren.filter((path) => this.isVisibleInFilter(path, is_dir(path)));
      if (visible.length === 0) {
        const message = this.gitStatus.available ? "No changed files" : "No git changes";
        this.list.appendChild(h("div", { class: "files-status" }, message));
        this.syncActiveDescendant();
        return;
      }
      for (const path of visible) this.renderRow(path, 0);
      this.syncActiveDescendant();
      return;
    }
    for (const path of rootChildren) this.renderRow(path, 0);
    this.syncActiveDescendant();
  }

  renderRow(path, depth) {
    const entry = this.entries.get(path);
    if (!entry) return;
    const directory = entry.kind === "directory";
    const expanded = directory && (this.dirtyFilter || this.expandedDirs.has(path));
    const renaming = this.renameState?.path === path;
    const gitStatus = this.gitStatus.statusFor(path, directory);
    const selected = this.selectedPaths.has(path);
    const row = h(
      "div",
      {
        class: cls(
          "file-tree-row",
          selected && "file-tree-row-selected",
          this.selectedPath === path && "file-tree-row-active",
          entry.isIgnored && "file-tree-row-ignored",
          gitStatus && GIT_STATUS_CLASS[gitStatus],
          gitStatus && directory && "file-tree-row-git-folder",
          this.dropTarget === path && "file-tree-row-drop",
        ),
        role: "treeitem",
        "aria-selected": selected,
        "aria-expanded": directory ? expanded : undefined,
        draggable: !renaming,
        dataset: { path, type: "item", itemType: directory ? "directory" : "file", itemPath: path },
        onClick: (event) => {
          event.stopPropagation();
          if (renaming) return;
          if (event.metaKey || event.ctrlKey) {
            this.toggleSelection(path);
            this.render();
            this.persistMemory();
            this.list?.focus({ preventScroll: true });
            return;
          }
          if (event.shiftKey) {
            this.selectRange(path);
            this.render();
            this.persistMemory();
            this.list?.focus({ preventScroll: true });
            return;
          }
          void this.activatePath(path);
          this.list?.focus({ preventScroll: true });
        },
        onContextMenu: (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.selectedPaths.has(path)) {
            this.setSelection(path);
            this.render();
          }
          this.showContextMenu({ kind: entry.kind, name: basename(path), path }, event.clientX, event.clientY);
        },
        onDragStart: (event) => {
          if (!event.dataTransfer) return;
          const dragging = this.selectedPaths.has(path) && this.selectedPaths.size > 1 ? this.selectionList() : [path];
          event.dataTransfer.setData("application/x-muxy-path", dragging.join("\n"));
          const abses = dragging.map((rel) => this.abs_path(rel)).filter(Boolean);
          if (abses.length === dragging.length) {
            event.dataTransfer.setData("text/uri-list", abses.map((abs) => this.file_url(abs)).join("\r\n"));
            event.dataTransfer.setData("text/plain", abses.join("\n"));
          } else {
            event.dataTransfer.setData("text/plain", dragging.join("\n"));
          }
        },
        onDragOver: (event) => {
          if (!directory) return;
          event.preventDefault();
          this.dropTarget = path;
          row.classList.add("file-tree-row-drop");
        },
        onDragLeave: () => {
          if (this.dropTarget === path) this.dropTarget = null;
          row.classList.remove("file-tree-row-drop");
        },
        onDrop: (event) => this.dropPaths(event, directory ? path : parent_dir(path)),
      },
      h("span", { class: "file-tree-indent", style: { width: `${depth * 10}px` } }),
      directory
        ? h(
            "button",
            {
              class: "file-tree-disclosure",
              type: "button",
              "aria-label": expanded ? "Collapse folder" : "Expand folder",
              onClick: (event) => {
                event.stopPropagation();
                this.setSelection(path);
                void this.toggleDirectory(path);
                this.list?.focus({ preventScroll: true });
              },
            },
            chevron_icon(expanded),
          )
        : h("span", { class: "file-tree-disclosure file-tree-disclosure-placeholder" }),
      h("span", { class: "file-tree-kind-icon" }, file_icon(entry.kind, path, this.iconTheme)),
      renaming ? this.renderRenameInput(path, directory) : h("span", { class: "file-tree-name", title: path }, basename(path)),
      !renaming && !directory && gitStatus
        ? h("span", { class: "file-tree-git-mark", title: GIT_STATUS_LABEL[gitStatus] }, GIT_STATUS_GLYPH[gitStatus])
        : null,
    );
    row.id = `ft-row-${this.visiblePaths.length}`;
    this.rowElements.set(path, row);
    this.visiblePaths.push(path);
    this.list.appendChild(row);

    if (directory && expanded) {
      for (const child of this.children.get(path) ?? []) {
        if (this.dirtyFilter && !this.isVisibleInFilter(child, is_dir(child))) continue;
        this.renderRow(child, depth + 1);
      }
    }
  }

  renderRenameInput(path, directory) {
    if (this.activeRenameInput && this.renameState?.path === path) {
      return this.activeRenameInput;
    }
    const input = h("input", {
      class: "file-tree-rename-input",
      type: "text",
      value: basename(path),
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
      onClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.commitRename(path, input.value, directory);
        } else if (event.key === "Escape") {
          event.preventDefault();
          void this.cancelRename();
        }
      },
      onBlur: () => {
        if (this.reRendering) return;
        void this.commitRename(path, input.value, directory);
      },
    });
    this.activeRenameInput = input;
    this.pendingRenameInput = input;
    return input;
  }

  focusRenameInput() {
    const fresh = this.pendingRenameInput;
    this.pendingRenameInput = null;
    if (fresh) {
      requestAnimationFrame(() => {
        fresh.focus();
        fresh.select();
      });
      return;
    }
    const restore = this.renameSelection;
    const input = this.activeRenameInput;
    this.renameSelection = null;
    if (!restore || !input) return;
    requestAnimationFrame(() => {
      if (document.activeElement === input) return;
      input.focus();
      const len = input.value.length;
      const start = restore.start ?? len;
      const end = restore.end ?? len;
      input.setSelectionRange(Math.min(start, len), Math.min(end, len));
    });
  }

  async activatePath(path) {
    this.setSelection(path);
    const entry = this.entries.get(path);
    if (!entry) return;
    if (entry.kind === "directory") {
      await this.toggleDirectory(path);
      return;
    }
    this.render();
    this.persistMemory();
    void this.openFile(path);
  }

  async toggleDirectory(path) {
    if (this.expandedDirs.has(path)) {
      this.expandedDirs.delete(path);
      this.render();
      this.persistMemory();
      return;
    }
    this.expandedDirs.add(path);
    await this.ensureLoaded(path);
    this.render();
    this.persistMemory();
  }

  setSelection(path, { anchor = true } = {}) {
    this.selectedPath = path;
    this.selectedPaths = path ? new Set([path]) : new Set();
    if (anchor) this.anchorPath = path;
  }

  clearSelection() {
    if (!this.selectedPath && this.selectedPaths.size === 0) return;
    this.setSelection(null);
    this.render();
    this.persistMemory();
  }

  toggleSelection(path) {
    if (!path) return;
    if (this.selectedPaths.has(path) && this.selectedPaths.size > 1) {
      this.selectedPaths.delete(path);
      if (this.selectedPath === path) this.selectedPath = this.lastSelected();
    } else {
      this.selectedPaths.add(path);
      this.selectedPath = path;
    }
    this.anchorPath = path;
  }

  selectRange(path) {
    const paths = this.visiblePaths;
    const anchor = this.anchorPath ?? this.selectedPath ?? path;
    const from = paths.indexOf(anchor);
    const to = paths.indexOf(path);
    if (from === -1 || to === -1) {
      this.setSelection(path);
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.selectedPaths = new Set(paths.slice(lo, hi + 1));
    this.selectedPath = path;
  }

  lastSelected() {
    for (let i = this.visiblePaths.length - 1; i >= 0; i -= 1) {
      if (this.selectedPaths.has(this.visiblePaths[i])) return this.visiblePaths[i];
    }
    return null;
  }

  selectionList() {
    return this.visiblePaths.filter((path) => this.selectedPaths.has(path));
  }

  async copyPaths(rels) {
    await copy_paths(rels);
  }

  // ---- Keyboard navigation -------------------------------------------------

  syncActiveDescendant() {
    if (!this.list) return;
    const el = this.selectedPath ? this.rowElements.get(this.selectedPath) : null;
    if (el) this.list.setAttribute("aria-activedescendant", el.id);
    else this.list.removeAttribute("aria-activedescendant");
  }

  moveSelection(path, { reveal = true, extend = false } = {}) {
    if (!path || !this.rowElements.has(path)) return;
    const previous = this.selectedPaths;
    let next;
    if (extend) {
      const paths = this.visiblePaths;
      const anchor = this.anchorPath ?? this.selectedPath ?? path;
      const from = paths.indexOf(anchor);
      const to = paths.indexOf(path);
      if (from === -1 || to === -1) {
        next = new Set([path]);
        this.anchorPath = path;
      } else {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        next = new Set(paths.slice(lo, hi + 1));
      }
    } else {
      next = new Set([path]);
      this.anchorPath = path;
    }
    for (const selected of previous) {
      if (next.has(selected)) continue;
      const selEl = this.rowElements.get(selected);
      if (selEl) {
        selEl.classList.remove("file-tree-row-selected");
        selEl.setAttribute("aria-selected", "false");
      }
    }
    for (const selected of next) {
      const selEl = this.rowElements.get(selected);
      if (selEl) {
        selEl.classList.add("file-tree-row-selected");
        selEl.setAttribute("aria-selected", "true");
      }
    }
    const prevActive = this.selectedPath ? this.rowElements.get(this.selectedPath) : null;
    if (prevActive) prevActive.classList.remove("file-tree-row-active");
    this.selectedPaths = next;
    this.selectedPath = path;
    const el = this.rowElements.get(path);
    el.classList.add("file-tree-row-active");
    if (reveal) el.scrollIntoView({ block: "nearest" });
    this.syncActiveDescendant();
    this.persistMemory();
  }

  focusList() {
    if (!this.list || this.renameState) return;
    // Don't steal focus from a field the user is typing in (e.g. a rename).
    const active = document.activeElement;
    if (
      active &&
      active !== this.list &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
    ) {
      return;
    }
    try {
      this.list.focus({ preventScroll: true });
    } catch {
      /* focus can throw if the element is detached; ignore */
    }
  }

  maybeInitialFocus() {
    if (this.didInitialFocus) return;
    this.didInitialFocus = true;
    this.focusList();
  }

  // When the tree gains focus with nothing selected, highlight the first row
  // so arrow keys have a starting point.
  onListFocus() {
    if (this.selectedPath && this.rowElements.has(this.selectedPath)) return;
    if (this.visiblePaths.length > 0) this.moveSelection(this.visiblePaths[0], { reveal: false });
  }

  onKeyDown(event) {
    // Rename input and context menu own their own keys.
    if (this.renameState || this.contextMenu) return;
    // Leave app-level shortcuts (cmd/ctrl/alt combos) to Muxy.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const paths = this.visiblePaths;
    if (paths.length === 0) return;
    const idx = this.selectedPath ? paths.indexOf(this.selectedPath) : -1;
    const extend = event.shiftKey;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.moveSelection(paths[idx < 0 ? 0 : Math.min(idx + 1, paths.length - 1)], { extend });
        return;
      case "ArrowUp":
        event.preventDefault();
        this.moveSelection(paths[idx < 0 ? paths.length - 1 : Math.max(idx - 1, 0)], { extend });
        return;
      case "ArrowRight":
        event.preventDefault();
        this.navigateRight(idx);
        return;
      case "ArrowLeft":
        event.preventDefault();
        this.navigateLeft(idx);
        return;
      case "Home":
        event.preventDefault();
        this.moveSelection(paths[0]);
        return;
      case "End":
        event.preventDefault();
        this.moveSelection(paths[paths.length - 1]);
        return;
      case "Enter":
      case " ":
        if (idx < 0) return;
        event.preventDefault();
        void this.activatePath(paths[idx]);
        return;
      case "F2":
        if (idx < 0 || paths[idx] === "") return;
        event.preventDefault();
        this.startRename(paths[idx]);
        return;
      case "Delete":
      case "Backspace": {
        const targets = this.selectionList().filter((path) => path !== "");
        if (targets.length === 0) return;
        event.preventDefault();
        void this.deletePaths(targets);
        return;
      }
      case "Escape":
        if (this.selectedPaths.size > 1) {
          event.preventDefault();
          this.setSelection(this.selectedPath);
          this.render();
        }
        return;
      default:
        this.handleTypeahead(event);
    }
  }

  navigateRight(idx) {
    const paths = this.visiblePaths;
    if (idx < 0) {
      this.moveSelection(paths[0]);
      return;
    }
    const path = paths[idx];
    const entry = this.entries.get(path);
    if (!entry || entry.kind !== "directory") return;
    const expanded = this.dirtyFilter || this.expandedDirs.has(path);
    if (!expanded) {
      this.setSelection(path);
      void this.toggleDirectory(path);
      return;
    }
    // Already open: step into the first child if the folder has visible ones.
    const next = paths[idx + 1];
    if (next && depth_of(next) > depth_of(path)) this.moveSelection(next);
  }

  navigateLeft(idx) {
    const paths = this.visiblePaths;
    if (idx < 0) {
      this.moveSelection(paths[0]);
      return;
    }
    const path = paths[idx];
    const entry = this.entries.get(path);
    const expanded = entry?.kind === "directory" && (this.dirtyFilter || this.expandedDirs.has(path));
    if (expanded && !this.dirtyFilter) {
      this.setSelection(path);
      void this.toggleDirectory(path);
      return;
    }
    // Otherwise jump to the parent folder when it's visible in the tree.
    const parent = parent_dir(path);
    if (parent && this.rowElements.has(parent)) this.moveSelection(parent);
  }

  handleTypeahead(event) {
    const ch = event.key;
    if (ch.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!/\S/.test(ch)) return;
    event.preventDefault();
    if (this.typeahead.timer !== null) clearTimeout(this.typeahead.timer);
    this.typeahead.buffer += ch.toLowerCase();
    this.typeahead.timer = setTimeout(() => {
      this.typeahead.buffer = "";
      this.typeahead.timer = null;
    }, 600);

    const paths = this.visiblePaths;
    const start = this.selectedPath ? paths.indexOf(this.selectedPath) : -1;
    const buffer = this.typeahead.buffer;
    for (let i = 1; i <= paths.length; i += 1) {
      const candidate = paths[(start + i) % paths.length];
      if (basename(candidate).toLowerCase().startsWith(buffer)) {
        this.moveSelection(candidate);
        return;
      }
    }
  }

  async createFile(parentRel) {
    const parent = canonical_dir(parentRel);
    const rel = await create_file(parent);
    if (!rel) return false;
    this.expandedDirs.add(parent);
    await this.ensureLoaded(parent);
    await this.reconcileDir(parent);
    this.startRename(rel, { removeIfCanceled: true });
    return true;
  }

  async createFolder(parentRel) {
    const parent = canonical_dir(parentRel);
    const rel = await create_folder(parent);
    if (!rel) return false;
    this.expandedDirs.add(parent);
    await this.ensureLoaded(parent);
    await this.reconcileDir(parent);
    this.startRename(rel, { removeIfCanceled: true });
    return true;
  }

  async deletePaths(rels) {
    const parents = new Set(rels.map((rel) => parent_dir(rel)));
    const ok = await delete_paths(rels);
    if (!ok) return false;
    for (const rel of rels) this.removeSubtree(rel);
    for (const parent of parents) await this.reconcileDir(parent);
    this.render();
    return true;
  }

  async duplicate(rel) {
    const dest = await duplicate_op(rel);
    if (!dest) return false;
    await this.reconcileDir(parent_dir(dest));
    this.setSelection(dest);
    this.render();
    return true;
  }

  startRename(path, options = {}) {
    if (!this.entries.has(path)) return;
    this.activeRenameInput = null;
    this.renameState = { path, removeIfCanceled: Boolean(options.removeIfCanceled), committing: false };
    this.setSelection(path);
    this.render();
  }

  async commitRename(path, rawName, directory) {
    const state = this.renameState;
    if (!state || state.path !== path || state.committing) return;
    const newName = rawName.trim();
    if (!newName || newName === basename(path)) {
      this.renameState = null;
      this.activeRenameInput = null;
      this.render();
      return;
    }
    state.committing = true;
    const dest = path_after_rename(path, newName, directory);
    const ok = await rename_fs(path, dest, directory);
    this.renameState = null;
    this.activeRenameInput = null;
    if (ok) {
      this.removeSubtree(path);
      await this.reconcileDir(parent_dir(dest));
      this.setSelection(dest);
    }
    this.render();
  }

  async cancelRename() {
    const state = this.renameState;
    if (!state) return;
    this.renameState = null;
    this.activeRenameInput = null;
    if (state.removeIfCanceled) {
      await muxy.files.delete([state.path]).catch(() => undefined);
      await this.reconcileDir(parent_dir(state.path));
    }
    this.render();
  }

  async resolveRoot() {
    // muxy.exec defaults its cwd to the active worktree root — the same root
    // muxy.files paths are relative to — so `pwd` yields the absolute base
    // without needing the worktrees:read permission.
    try {
      const res = await muxy.exec(["pwd"]);
      if (res?.exitCode === 0) return res.stdout.trim() || null;
    } catch {
      /* fall through */
    }
    return null;
  }

  abs_path(rel) {
    if (!this.worktreeRoot) return null;
    return `${this.worktreeRoot.replace(/\/+$/, "")}/${strip_slash(rel)}`;
  }

  file_url(abs) {
    return `file://${abs.split("/").map(encodeURIComponent).join("/")}`;
  }

  async dropPaths(event, targetDirRel) {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer?.getData("application/x-muxy-path");
    this.dropTarget = null;
    if (!raw) return;
    const target = canonical_dir(targetDirRel);
    const dragged = raw
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean)
      .filter((path) => path !== target && parent_dir(path) !== target && !(path.endsWith("/") && target.startsWith(path)));
    if (dragged.length === 0) {
      this.render();
      return;
    }
    const sourceParents = new Set(dragged.map((path) => parent_dir(path)));
    const ok = await move_fs(dragged, target);
    if (ok) {
      for (const path of dragged) this.removeSubtree(path);
      for (const parent of sourceParents) await this.reconcileDir(parent);
      await this.ensureLoaded(target);
      await this.reconcileDir(target);
    }
    this.render();
  }

  resolveLoadedDir(rawPath) {
    const segs = strip_slash(rawPath).split("/").filter(Boolean);
    const parentEnd = Math.max(0, segs.length - 1);
    let best = "";
    let bestDepth = -1;
    for (const dir of this.loadedDirs) {
      const dirSegs = strip_slash(dir).split("/").filter(Boolean);
      if (dirSegs.length <= bestDepth) continue;
      if (block_ends_within(dirSegs, segs, parentEnd)) {
        best = dir;
        bestDepth = dirSegs.length;
      }
    }
    return best;
  }

  scheduleReconcile(payload) {
    const raw = payload && typeof payload === "object" && "path" in payload ? payload.path : undefined;
    if (typeof raw !== "string" || raw.trim() === "") return;
    this.pendingDirs.add(this.resolveLoadedDir(raw));
    if (this.reconcileTimer !== null) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      const dirs = Array.from(this.pendingDirs);
      this.pendingDirs.clear();
      for (const pendingDir of dirs) void this.reconcileDir(pendingDir);
    }, RECONCILE_DEBOUNCE_MS);
  }

  showContextMenu(item, x, y) {
    this.closeContextMenu();
    const menu = create_context_menu(item, this.ops, () => this.closeContextMenu(), this.selectionList());
    document.body.appendChild(menu);
    const MARGIN = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    const closeOnPointer = (event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      this.closeContextMenu();
    };
    const closeOnKey = (event) => {
      if (event.key === "Escape") this.closeContextMenu();
    };
    window.addEventListener("mousedown", closeOnPointer, true);
    window.addEventListener("keydown", closeOnKey, true);
    this.contextMenu = menu;
    this.contextDisposers = [
      () => window.removeEventListener("mousedown", closeOnPointer, true),
      () => window.removeEventListener("keydown", closeOnKey, true),
    ];
  }

  closeContextMenu() {
    for (const dispose of this.contextDisposers) dispose();
    this.contextDisposers = [];
    this.contextMenu?.remove();
    this.contextMenu = null;
  }
}
