import {
  basename,
  canonical_dir,
  copy_path,
  entry_to_rel,
  open_externally,
  open_in_editor,
  parent_dir,
  reveal_in_finder,
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

const RECONCILE_DEBOUNCE_MS = 250;

function is_dir(path) {
  return path === "" || path.endsWith("/");
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

function file_icon(kind) {
  if (kind === "directory") {
    return icon_svg([{ d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }]);
  }
  return icon_svg([
    { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" },
    { d: "M14 2v6h6" },
  ]);
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
    const panel = h("div", { class: "files-panel" }, h("div", { class: "file-tree-wrap" }));
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
      muxy.events.subscribe("worktree.switched", () => void this.loadRoot()),
      muxy.events.subscribe("project.switched", () => void this.loadRoot()),
      muxy.events.subscribe("file.changed", (payload) => this.scheduleReconcile(payload)),
      muxy.events.subscribe("command.files-new-file", () => void this.createFile("")),
      muxy.events.subscribe("command.files-new-folder", () => void this.createFolder("")),
      muxy.events.subscribe("command.files-refresh", () => void this.loadRoot()),
      () => document.removeEventListener("contextmenu", this.preventNativeContextMenu),
    );

    void this.loadRoot();
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
    this.render();
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

  render() {
    if (!this.list) return;
    this.list.replaceChildren();
    const rootChildren = this.children.get("") ?? [];
    if (rootChildren.length === 0) {
      this.list.appendChild(h("div", { class: "files-status" }, "No files"));
      return;
    }
    for (const path of rootChildren) this.renderRow(path, 0);
    this.focusRenameInput();
  }

  renderRow(path, depth) {
    const entry = this.entries.get(path);
    if (!entry) return;
    const directory = entry.kind === "directory";
    const expanded = this.expandedDirs.has(path);
    const renaming = this.renameState?.path === path;
    const row = h(
      "div",
      {
        class: cls(
          "file-tree-row",
          this.selectedPath === path && "file-tree-row-selected",
          entry.isIgnored && "file-tree-row-ignored",
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
      h("span", { class: "file-tree-kind-icon" }, file_icon(entry.kind)),
      renaming ? this.renderRenameInput(path, directory) : h("span", { class: "file-tree-name", title: path }, basename(path)),
    );
    this.list.appendChild(row);

    if (directory && expanded) {
      for (const child of this.children.get(path) ?? []) this.renderRow(child, depth + 1);
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
    void open_in_editor(path);
  }

  async toggleDirectory(path) {
    if (this.expandedDirs.has(path)) {
      this.expandedDirs.delete(path);
      this.render();
      return;
    }
    this.expandedDirs.add(path);
    await this.ensureLoaded(path);
    this.render();
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

  scheduleReconcile(payload) {
    const raw = payload && typeof payload === "object" && "path" in payload ? payload.path : undefined;
    if (typeof raw !== "string") return;
    const dir = parent_dir(raw.replace(/^\/+/, ""));
    this.pendingDirs.add(dir);
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
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
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
