import {
  basename,
  canonical_dir,
  copy_path,
  entry_to_rel,
  open_externally,
  open_in_editor,
  parent_dir,
  reveal_in_finder,
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

function create_context_menu(item, ops, close) {
  const isDir = item.kind === "directory";
  const path = item.path;
  const createDir = isDir ? path : parent_dir(path);
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
    this.dropTarget = null;
    this.renameState = null;
    this.pendingDirs = new Set();
    this.reconcileTimer = null;
    this.contextMenu = null;
    this.contextDisposers = [];
    this.disposers = [];
    this.gitStatus = new GitStatusStore();
    this.dirtyFilter = false;
    this.iconTheme = load_icon_theme();

    this.ops = {
      createFile: (parentRel = "") => this.createFile(parentRel),
      createFolder: (parentRel = "") => this.createFolder(parentRel),
      deletePaths: (rels) => this.deletePaths(rels),
      duplicate: (rel) => this.duplicate(rel),
      rename: (rel) => this.startRename(rel),
      reveal: (rel) => reveal_in_finder(rel),
      openExternally: (rel) => open_externally(rel),
      copyPath: (rel) => copy_path(rel),
      openInEditor: (rel) => open_in_editor(rel),
      refresh: () => this.loadRoot(),
    };
  }

  start() {
    this.filterBar = h("div", { class: "file-tree-filter-bar", hidden: true });
    const panel = h("div", { class: "files-panel" }, this.filterBar, h("div", { class: "file-tree-wrap" }));
    this.root.replaceChildren(panel);
    this.wrap = panel.querySelector(".file-tree-wrap");
    this.list = h("div", {
      class: "file-tree-list",
      role: "tree",
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

    document.addEventListener("contextmenu", this.preventNativeContextMenu);
    this.disposers.push(
      this.gitStatus.subscribe(() => this.onGitStatusChange()),
      muxy.events.subscribe("worktree.switched", () => void this.loadRoot()),
      muxy.events.subscribe("project.switched", () => void this.loadRoot()),
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
  }

  async loadRoot() {
    this.entries.clear();
    this.children.clear();
    this.loadedDirs.clear();
    this.expandedDirs.clear();
    this.selectedPath = null;
    this.closeContextMenu();
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
    void this.gitStatus.refresh();
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
    if (selected && this.entries.has(selected)) this.selectedPath = selected;
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
    this.renderFilterBar();
    this.list.replaceChildren();
    const rootChildren = this.children.get("") ?? [];
    if (rootChildren.length === 0) {
      this.list.appendChild(h("div", { class: "files-status" }, "No files"));
      return;
    }
    if (this.dirtyFilter) {
      const visible = rootChildren.filter((path) => this.isVisibleInFilter(path, is_dir(path)));
      if (visible.length === 0) {
        const message = this.gitStatus.available ? "No changed files" : "No git changes";
        this.list.appendChild(h("div", { class: "files-status" }, message));
        return;
      }
      for (const path of visible) this.renderRow(path, 0);
      this.focusRenameInput();
      return;
    }
    for (const path of rootChildren) this.renderRow(path, 0);
    this.focusRenameInput();
  }

  renderRow(path, depth) {
    const entry = this.entries.get(path);
    if (!entry) return;
    const directory = entry.kind === "directory";
    const expanded = directory && (this.dirtyFilter || this.expandedDirs.has(path));
    const renaming = this.renameState?.path === path;
    const gitStatus = this.gitStatus.statusFor(path, directory);
    const row = h(
      "div",
      {
        class: cls(
          "file-tree-row",
          this.selectedPath === path && "file-tree-row-selected",
          entry.isIgnored && "file-tree-row-ignored",
          gitStatus && GIT_STATUS_CLASS[gitStatus],
          gitStatus && directory && "file-tree-row-git-folder",
          this.dropTarget === path && "file-tree-row-drop",
        ),
        role: "treeitem",
        "aria-selected": this.selectedPath === path,
        "aria-expanded": directory ? expanded : undefined,
        draggable: !renaming,
        dataset: { path, type: "item", itemType: directory ? "directory" : "file", itemPath: path },
        onClick: (event) => {
          event.stopPropagation();
          if (!renaming) void this.activatePath(path);
        },
        onContextMenu: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.showContextMenu({ kind: entry.kind, name: basename(path), path }, event.clientX, event.clientY);
        },
        onDragStart: (event) => {
          event.dataTransfer?.setData("text/plain", path);
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
                void this.toggleDirectory(path);
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
    this.list.appendChild(row);

    if (directory && expanded) {
      for (const child of this.children.get(path) ?? []) {
        if (this.dirtyFilter && !this.isVisibleInFilter(child, is_dir(child))) continue;
        this.renderRow(child, depth + 1);
      }
    }
  }

  renderRenameInput(path, directory) {
    const input = h("input", {
      class: "file-tree-rename-input",
      value: basename(path),
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
      onBlur: () => void this.commitRename(path, input.value, directory),
    });
    this.pendingRenameInput = input;
    return input;
  }

  focusRenameInput() {
    const input = this.pendingRenameInput;
    this.pendingRenameInput = null;
    if (!input) return;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  async activatePath(path) {
    this.selectedPath = path;
    const entry = this.entries.get(path);
    if (!entry) return;
    if (entry.kind === "directory") {
      await this.toggleDirectory(path);
      return;
    }
    this.render();
    this.persistMemory();
    void open_in_editor(path);
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
    this.selectedPath = dest;
    this.render();
    return true;
  }

  startRename(path, options = {}) {
    if (!this.entries.has(path)) return;
    this.renameState = { path, removeIfCanceled: Boolean(options.removeIfCanceled), committing: false };
    this.selectedPath = path;
    this.render();
  }

  async commitRename(path, rawName, directory) {
    const state = this.renameState;
    if (!state || state.path !== path || state.committing) return;
    const newName = rawName.trim();
    if (!newName || newName === basename(path)) {
      this.renameState = null;
      this.render();
      return;
    }
    state.committing = true;
    const dest = path_after_rename(path, newName, directory);
    const ok = await rename_fs(path, dest, directory);
    this.renameState = null;
    if (ok) {
      this.removeSubtree(path);
      await this.reconcileDir(parent_dir(dest));
      this.selectedPath = dest;
    }
    this.render();
  }

  async cancelRename() {
    const state = this.renameState;
    if (!state) return;
    this.renameState = null;
    if (state.removeIfCanceled) {
      await muxy.files.delete([state.path]).catch(() => undefined);
      await this.reconcileDir(parent_dir(state.path));
    }
    this.render();
  }

  async dropPaths(event, targetDirRel) {
    event.preventDefault();
    event.stopPropagation();
    const dragged = event.dataTransfer?.getData("text/plain");
    this.dropTarget = null;
    if (!dragged) return;
    const target = canonical_dir(targetDirRel);
    if (dragged === target || (dragged.endsWith("/") && target.startsWith(dragged))) {
      this.render();
      return;
    }
    const sourceParent = parent_dir(dragged);
    const ok = await move_fs([dragged], target);
    if (ok) {
      this.removeSubtree(dragged);
      await this.reconcileDir(sourceParent);
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
    const menu = create_context_menu(item, this.ops, () => this.closeContextMenu());
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
