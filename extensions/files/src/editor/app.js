// The editor tab: loads one file, picks the view for it, and owns saving,
// dirty state, disk changes, drafts, and the topbar. Views are loaded on
// demand, so a code file never pays for the PDF or markdown machinery.
//
// Dirty tracking stays off the typing path: a change only flips `dirty` and
// resets a few timers. Whether the buffer is back at the saved content is
// checked once typing pauses (`matches`, a structural compare in CodeMirror).

import { basename, changed_rel } from "@/shared/paths";
import { cls, h } from "@/shared/dom";
import { alert_error, error_message, open_externally, reveal_in_finder } from "@/shared/actions";
import {
  ACTIVE_KEY,
  EditorRegistration,
  GOTO_KEY,
  MOVED_KEY,
  TAB_STATE_PREFIX,
  moved_path,
  open_file,
  project_root,
  request_replace,
} from "@/shared/editors";
import { keys_with_prefix, read_json, read_string, remove_key, watch_key, write_json, write_string } from "@/shared/prefs";
import { tab_symbol } from "@/shared/file-types";
import { is_binary_kind, is_html, is_svg, kind_of } from "./kinds";
import { AUTO_SAVE_DELAY_MS, load_editor_config, update_editor_config, watch_editor_config } from "./config";
import { clear_draft, prune_drafts, read_draft, write_draft } from "./drafts";
import { OpenIcon, RevealIcon, SaveIcon, SettingsIcon, TocIcon } from "./icons";
// Most files are code, so CodeMirror ships with the shell and loads while the
// page parses; every other view is fetched only when a file needs it.
import * as code_module from "./code/code-editor";

const TOC_PREF_KEY = "files:md-toc";
// The Preview / Edit mode last chosen for a markdown file; new files open in it.
const MD_MODE_KEY = "muxy.files.markdown-mode";
const RELOAD_DEBOUNCE_MS = 100;
const CLEAN_CHECK_MS = 300;
const DRAFT_DELAY_MS = 1000;
const LOADING_LABEL_DELAY_MS = 150;

const load_code = () => Promise.resolve(code_module);
const load_markdown = () => import("./viewers/markdown-editor");
const load_image = () => import("./viewers/image-viewer");
const load_pdf = () => import("./viewers/pdf-viewer");
const load_html = () => import("./viewers/html-viewer");
const load_settings = () => import("./settings-sheet");

const TAB_STATE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Forgets the saved state of tabs that haven't loaded in months (long closed). */
function prune_tab_states() {
  const now = Date.now();
  for (const key of keys_with_prefix(TAB_STATE_PREFIX)) {
    if (key === TAB_STATE_PREFIX + muxy.tabInstanceID) continue;
    const at = read_json(key)?.at;
    if (typeof at !== "number" || now - at > TAB_STATE_TTL_MS) remove_key(key);
  }
}

function position_from(data) {
  const line = Number(data?.line);
  if (!Number.isInteger(line) || line < 1) return null;
  const column = Number(data?.column);
  return { line, column: Number.isInteger(column) && column >= 1 ? column : 1 };
}

function is_text_entry(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** A read-only rendering (SVG view, HTML preview) of text the user may still have unsaved. */
class TextView {
  constructor(view, text) {
    this.view = view;
    this.text = text;
  }
  snapshot() {
    return this.text;
  }
  matches(snapshot) {
    return snapshot === this.text;
  }
  textOf(snapshot) {
    return String(snapshot);
  }
  snapshotOf(text) {
    return text;
  }
  getValue() {
    return this.text;
  }
  focus() {}
  updateConfig() {}
  destroy() {
    this.view.destroy();
  }
}

export class EditorApp {
  constructor(root, { firstRead = null } = {}) {
    this.root = root;
    this.firstRead = firstRead;
    this.data = muxy.data ?? {};
    // The editor tab in use before this page loaded: the tab a terminal link
    // should replace (this page becomes the active one as soon as it focuses).
    this.previousActive = read_json(ACTIVE_KEY);
    // A tab that replaced its file shows the replacement after a restart. The
    // host keeps the data the tab was opened with, so it is overridden here
    // only while that data is unchanged.
    const saved = read_json(TAB_STATE_PREFIX + muxy.tabInstanceID);
    const state = saved && saved.base === (this.data.filePath ?? null) ? saved : null;
    if (typeof state?.path === "string") this.data = { filePath: state.path };
    this.preview = !state?.kept;
    // A terminal-opened tab decides once, when it is created, whether to hand
    // its file to another tab. Restored after a restart, it must stay put.
    this.settled = Boolean(state?.settled);
    this.config = load_editor_config();
    this.isDark = muxy.theme?.colorScheme === "dark";
    this.showToc = read_string(TOC_PREF_KEY, "0") === "1";
    this.registration = new EditorRegistration();
    this.registration.preview = this.preview;
    this.registration.onReplace = (request) => this.onReplace(request);
    this.registration.onKeep = () => this.keep();
    this.disposers = [];
    this.loadId = 0;
    this.mountId = 0;
    this.path = null;
    this.kind = null;
    this.child = null;
    this.settings = null;
    this.timers = { reload: 0, autoSave: 0, clean: 0, draft: 0, loading: 0 };
    this.resetFileState();
  }

  resetFileState() {
    this.dirty = false;
    this.saving = false;
    this.conflictPending = false;
    this.recheckAfterSave = false;
    this.error = null;
    this.savedText = null; // what we believe is on disk
    this.savedSnap = null; // the same, as the view's cheap-to-compare snapshot
    this.baseline = null; // content to restore on "Discard" (open time or last deliberate save)
    this.mdMode = read_string(MD_MODE_KEY) === "edit" ? "edit" : "preview";
    this.svgView = false;
    this.htmlView = false;
  }

  start() {
    this.disposers.push(
      muxy.onDataChange((next) => this.onDataChange(next ?? {})),
      muxy.onThemeChange((theme) => {
        this.isDark = theme.colorScheme === "dark";
        this.child?.updateConfig?.(this.config, this.isDark);
      }),
      muxy.onFocus((focused) => {
        if (!focused) return;
        this.registration.activate();
        void this.consumeGoto();
      }),
      watch_editor_config((config) => this.applyConfig(config)),
      watch_key(MOVED_KEY, () => this.onMoved()),
      muxy.events.subscribe("file.changed", (payload) => this.onFileChanged(payload)),
    );

    const onKey = (event) => this.onKeyDown(event);
    window.addEventListener("keydown", onKey, true);
    const onWindowFocus = () => {
      if (!is_text_entry(document.activeElement)) this.focusEditor();
    };
    window.addEventListener("focus", onWindowFocus);
    const offBeforeClose = muxy.lifecycle?.onBeforeClose?.(() => this.handleBeforeClose());
    this.disposers.push(() => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focus", onWindowFocus);
      offBeforeClose?.();
    });

    setTimeout(prune_drafts, 2000);
    setTimeout(prune_tab_states, 2500);
    void this.loadTarget();
  }

  dispose() {
    for (const timer of Object.values(this.timers)) clearTimeout(timer);
    this.destroyChild();
    this.settings?.destroy();
    this.registration.dispose();
    for (const dispose of this.disposers) dispose?.();
    this.disposers = [];
  }

  // ---- Loading -------------------------------------------------------------

  async loadTarget() {
    const loadId = ++this.loadId;
    for (const key of ["reload", "autoSave", "clean", "draft", "loading"]) clearTimeout(this.timers[key]);
    this.resetFileState();
    this.path = this.data.filePath || null;
    this.kind = kind_of(this.path);
    this.saveTabState();
    this.updateTabChrome();
    this.destroyChild();

    if (!this.path) {
      this.root.replaceChildren(h("div", { class: "editor-empty" }, "No file open"));
      this.shell = null;
      return;
    }

    const position = position_from(this.data);
    if (this.kind === "markdown" && position) this.mdMode = "edit";
    this.buildShell();
    void this.registration.set(this.path).then(() => this.afterRegister(loadId));

    if (is_binary_kind(this.kind)) {
      await this.mountChild({ position });
      return;
    }

    this.timers.loading = setTimeout(() => this.showStatus("Loading…"), LOADING_LABEL_DELAY_MS);
    let content;
    try {
      content = (await this.readFile(this.path)).content;
    } catch (err) {
      if (loadId !== this.loadId) return;
      clearTimeout(this.timers.loading);
      this.error = error_message(err);
      this.showStatus(this.error, true);
      return;
    }
    if (loadId !== this.loadId) return;
    clearTimeout(this.timers.loading);
    this.savedText = content;
    this.baseline = content;
    await this.mountChild({ value: content, position });
    if (loadId === this.loadId) void this.restoreDraft(loadId, this.path, content);
  }

  /** The bootstrap starts reading the first file before this module loads. */
  readFile(path) {
    const early = this.firstRead;
    this.firstRead = null;
    if (early && early.path === path && early.promise) return early.promise;
    return muxy.files.read(path);
  }

  async afterRegister(loadId) {
    if (loadId !== this.loadId) return;
    if (muxy.focused || document.hasFocus()) {
      this.registration.activate();
      void this.consumeGoto();
    }
    if (this.data.source !== "terminal" || this.settled) return;
    this.settled = true;
    this.saveTabState();
    // Cmd-clicking a path in a terminal always opens a new tab. If the file is
    // already open in an older tab, go there; otherwise, with tab reuse on,
    // hand it to the preview tab that was in use. Either way close this one.
    const position = position_from(this.data);
    let target = await this.registration.findOlderTwin();
    if (target && position) await muxy.storage.set(GOTO_KEY, { pane: target, ...position, at: Date.now() }).catch(() => undefined);
    if (!target && this.config.reuseTab !== false) {
      const previous = this.previousActive;
      const root = this.registration.root;
      const usable = previous?.preview && previous.root === root && previous.pane !== this.registration.pane && read_json(`muxy.files.editor:${previous.pane}`);
      if (usable && (await request_replace(previous.pane, this.path, position))) target = previous.pane;
    }
    if (!target || loadId !== this.loadId || this.dirty) return;
    try {
      await muxy.tabs.switchTo(target);
    } catch {
      return;
    }
    this.closing = true;
    remove_key(TAB_STATE_PREFIX + muxy.tabInstanceID);
    void muxy.lifecycle.close();
  }

  // ---- Tab reuse -------------------------------------------------------------

  /**
   * Another opener asks this tab to show a different file. Only an unedited
   * preview tab agrees; anything edited stays open and the file gets its own tab.
   */
  onReplace(request) {
    if (!this.preview || this.dirty || this.saving || this.closing || !this.path) return false;
    const position = position_from(request.position);
    if (request.path === this.path) {
      this.gotoPosition(position);
      return true;
    }
    this.data = { filePath: request.path, ...(position ?? {}) };
    void this.loadTarget();
    return true;
  }

  /** Editing (or double-clicking the file in the tree) keeps the tab open. */
  keep() {
    if (!this.preview) return;
    this.preview = false;
    this.registration.setPreview(false);
    this.saveTabState();
    this.updateTopbar();
  }

  saveTabState() {
    const key = TAB_STATE_PREFIX + muxy.tabInstanceID;
    const base = muxy.data?.filePath ?? null;
    if (this.path === base && this.preview && !this.settled) remove_key(key);
    else write_json(key, { base, path: this.path, kept: !this.preview, settled: this.settled, at: Date.now() });
  }

  async consumeGoto() {
    const goto = await this.registration.takeGoto();
    if (goto) this.gotoPosition(position_from(goto));
  }

  gotoPosition(position) {
    if (!position) return;
    if (this.kind === "markdown" && this.mdMode === "preview") {
      void this.setMarkdownMode("edit", position);
      return;
    }
    this.child?.gotoPosition?.(position);
  }

  async restoreDraft(loadId, path, disk) {
    const root = await project_root();
    if (loadId !== this.loadId || !root) return;
    const draft = read_draft(root, path);
    if (!draft) return;
    // Only edits made on top of exactly what is on disk now are safe to replay.
    if (draft.baseline !== disk || draft.content === disk || !this.child?.replaceContent) {
      clear_draft(root, path);
      return;
    }
    this.child.replaceContent(draft.content, { userEdit: true });
  }

  // ---- Views ---------------------------------------------------------------

  async mountChild({ value = this.child?.getValue?.() ?? this.savedText ?? "", position = null } = {}) {
    const mountId = ++this.mountId;
    const path = this.path;
    const [load, build] = this.viewFor(path, value, position);
    let module;
    try {
      module = await load();
    } catch (err) {
      if (mountId === this.mountId) this.showStatus(error_message(err), true);
      return;
    }
    if (mountId !== this.mountId || path !== this.path || !this.body) return;
    this.destroyChild();
    this.body.replaceChildren();
    this.child = build(module, this.body);
    if (this.savedText !== null && this.child.snapshotOf) {
      this.savedSnap = this.dirty ? this.child.snapshotOf(this.savedText) : this.child.snapshot();
    }
    this.updateTopbar();
    this.focusEditor();
  }

  /** The module to load for this file and how to build its view. */
  viewFor(path, value, position) {
    const common = { filePath: path, isDark: this.isDark, config: this.config };
    const onChange = (isExternal) => this.onChange(isExternal);
    const onSave = () => this.save();
    if (this.kind === "image") return [load_image, (m, parent) => new m.ImageViewer({ parent, filePath: path })];
    if (this.kind === "pdf") return [load_pdf, (m, parent) => new m.PdfViewer({ parent, filePath: path })];
    if (this.kind === "markdown") {
      const onToggleTask = () => {
        this.keep();
        this.setDirty(true);
        void this.save();
      };
      return [
        load_markdown,
        (m, parent) =>
          new m.MarkdownEditor({ ...common, parent, value, mode: this.mdMode, initialPosition: position, showToc: this.showToc, onChange, onSave, onToggleTask }),
      ];
    }
    if (is_svg(path) && this.svgView) {
      return [load_image, (m, parent) => new TextView(new m.ImageViewer({ parent, filePath: path, svgSource: value }), value)];
    }
    if (is_html(path) && this.htmlView) {
      return [load_html, (m, parent) => new TextView(new m.HtmlViewer({ parent, filePath: path, source: value }), value)];
    }
    return [load_code, (m, parent) => new m.CodeEditor({ ...common, parent, value, initialPosition: position, onChange, onSave })];
  }

  destroyChild() {
    this.child?.destroy?.();
    this.child = null;
  }

  showStatus(message, isError = false) {
    if (!this.body) return;
    this.destroyChild();
    this.body.replaceChildren(h("div", { class: cls("editor-status", isError && "editor-error") }, message));
  }

  focusEditor() {
    if (!document.hasFocus()) return;
    cancelAnimationFrame(this.focusRaf);
    this.focusRaf = requestAnimationFrame(() => this.child?.focus?.());
  }

  /**
   * `remember` marks a choice the user made (the Preview / Edit toggle, the
   * `e` key), which new markdown files then open in. Switching to edit to
   * search or jump to a line doesn't change it.
   */
  async setMarkdownMode(mode, position = null, { remember = false } = {}) {
    if (remember) write_string(MD_MODE_KEY, mode);
    if (this.mdMode === mode && !position) return;
    if (this.mdMode === mode) return this.child?.gotoPosition?.(position);
    const value = this.child?.getValue?.() ?? this.savedText ?? "";
    this.mdMode = mode;
    this.updateTopbar();
    await this.mountChild({ value, position });
  }

  async setSourceView(field, view) {
    if (this[field] === view) return;
    const value = this.child?.getValue?.() ?? this.savedText ?? "";
    this[field] = view;
    this.updateTopbar();
    await this.mountChild({ value });
  }

  // ---- Editing, saving -----------------------------------------------------

  onChange(isExternal) {
    if (isExternal) return;
    this.keep();
    if (!this.dirty) this.setDirty(true);
    clearTimeout(this.timers.clean);
    this.timers.clean = setTimeout(() => this.checkClean(), CLEAN_CHECK_MS);
    this.scheduleAutoSave();
    this.scheduleDraft();
  }

  /** Undoing back to the saved text makes the buffer clean again. */
  checkClean() {
    if (!this.dirty || this.saving || !this.child?.matches || this.savedSnap === null) return;
    if (!this.child.matches(this.savedSnap)) return;
    clearTimeout(this.timers.autoSave);
    this.dropDraft();
    this.setDirty(false);
  }

  setDirty(dirty) {
    if (this.dirty === dirty) return;
    this.dirty = dirty;
    this.updateTopbar();
  }

  scheduleAutoSave() {
    clearTimeout(this.timers.autoSave);
    if (this.config.autoSave === false || !this.path || is_binary_kind(this.kind)) return;
    this.timers.autoSave = setTimeout(() => {
      if (this.dirty && !this.saving && !this.conflictPending) void this.save(false);
    }, AUTO_SAVE_DELAY_MS);
  }

  scheduleDraft() {
    clearTimeout(this.timers.draft);
    if (this.config.autoSave !== false) return;
    this.timers.draft = setTimeout(() => void this.writeDraft(), DRAFT_DELAY_MS);
  }

  async writeDraft() {
    const path = this.path;
    const root = await project_root();
    if (!root || path !== this.path || !this.dirty || this.savedText === null || !this.child?.getValue) return;
    write_draft(root, path, this.child.getValue(), this.savedText);
  }

  dropDraft() {
    clearTimeout(this.timers.draft);
    const path = this.path;
    if (path) void project_root().then((root) => clear_draft(root, path));
  }

  /**
   * Writes the buffer. A deliberate save (Cmd+S, the button) also becomes the
   * content "Discard" returns to; auto saves stay discardable.
   */
  async save(deliberate = true) {
    const path = this.path;
    if (!path || !this.child?.snapshot || this.saving || is_binary_kind(this.kind)) return false;
    clearTimeout(this.timers.autoSave);
    if (!this.dirty) {
      if (deliberate && this.savedText !== null) this.baseline = this.savedText;
      return true;
    }
    const snap = this.child.snapshot();
    const text = this.child.textOf(snap);
    this.saving = true;
    this.updateTopbar();
    let ok = true;
    try {
      await muxy.files.write(path, text);
    } catch (err) {
      ok = false;
      await alert_error("Save failed", err);
    }
    this.saving = false;
    if (path !== this.path) return ok;
    if (ok) {
      this.savedText = text;
      this.savedSnap = snap;
      if (deliberate) this.baseline = text;
      this.dropDraft();
      // Typing during the write leaves the buffer dirty again.
      const stillDirty = !this.child.matches(snap);
      this.setDirty(stillDirty);
      if (stillDirty) {
        this.scheduleAutoSave();
        this.scheduleDraft();
      }
    } else {
      this.scheduleAutoSave();
    }
    this.updateTopbar();
    if (this.recheckAfterSave) {
      this.recheckAfterSave = false;
      this.scheduleReload();
    }
    return ok;
  }

  async handleBeforeClose() {
    if (this.closing) return false;
    const block = await this.confirmClose();
    if (!block) this.dropDraft();
    return block;
  }

  async confirmClose() {
    if (!this.dirty || !this.path || is_binary_kind(this.kind)) return false;
    clearTimeout(this.timers.autoSave);
    let choice;
    try {
      choice = await muxy.dialog.confirm({
        title: "Unsaved changes",
        message: `${basename(this.path)} has unsaved changes. Save them before closing?`,
        buttons: ["Save", "Discard", "Cancel"],
        default: "Save",
        cancel: "Cancel",
        style: "warning",
      });
    } catch {
      choice = "Cancel";
    }
    if (choice === null || choice === "Cancel") {
      this.scheduleAutoSave();
      return true;
    }
    if (choice === "Save") {
      const ok = await this.save();
      if (!ok) this.scheduleAutoSave();
      return !ok;
    }
    return this.discardChanges();
  }

  /** Puts back the content from open time (or the last Cmd+S) if auto save already wrote over it. */
  async discardChanges() {
    if (this.baseline === null) return false;
    let onDisk;
    try {
      onDisk = (await muxy.files.read(this.path)).content;
    } catch {
      return false;
    }
    if (onDisk === this.baseline) return false;
    try {
      await muxy.files.write(this.path, this.baseline);
    } catch (err) {
      await alert_error("Discard failed", err);
      return true;
    }
    this.savedText = this.baseline;
    this.dropDraft();
    this.setDirty(false);
    return false;
  }

  // ---- Changes on disk -----------------------------------------------------

  /**
   * The files panel renamed or moved this file (or a folder holding it): keep
   * the buffer and follow it, so the next save doesn't recreate the old path.
   */
  onMoved() {
    const move = read_json(MOVED_KEY);
    const root = this.registration.root;
    if (!move || !root || move.root !== root) return;
    const next = moved_path(this.path, move);
    if (!next) return;
    const previous = this.path;
    void clear_draft(root, previous);
    this.path = next;
    this.data = { ...this.data, filePath: next };
    this.saveTabState();
    void this.registration.set(next);
    this.updateTabChrome();
    if (this.topbarParts?.name) {
      this.topbarParts.name.textContent = basename(next);
      this.topbarParts.name.title = next;
    }
    this.child?.setFilePath?.(next);
    if (this.dirty) this.scheduleDraft();
  }

  onFileChanged(payload) {
    if (!this.path) return;
    const rel = changed_rel(payload, this.registration.root);
    if (rel === null) return;
    if (rel === ".git/index") {
      this.child?.refreshGitBaseline?.();
      return;
    }
    if (rel !== "" && rel !== this.path) return;
    if (this.saving) {
      this.recheckAfterSave = true;
      return;
    }
    this.scheduleReload();
  }

  scheduleReload() {
    clearTimeout(this.timers.reload);
    this.timers.reload = setTimeout(() => void this.reloadFromDisk(), RELOAD_DEBOUNCE_MS);
  }

  async reloadFromDisk() {
    const path = this.path;
    const loadId = this.loadId;
    if (!path || this.saving || this.conflictPending) return;
    if (is_binary_kind(this.kind)) {
      await this.mountChild();
      return;
    }
    if (this.savedText === null) return;
    let next;
    try {
      next = (await muxy.files.read(path)).content;
    } catch {
      return;
    }
    if (loadId !== this.loadId || this.saving || this.conflictPending) return;
    // Our own save echoing back, or a touch that changed nothing.
    if (next === this.savedText) return;
    if (!this.dirty) {
      await this.applyDiskContent(next);
      return;
    }
    if (this.child?.getValue?.() === next) {
      this.savedText = next;
      this.savedSnap = this.child.snapshot();
      this.dropDraft();
      this.setDirty(false);
      return;
    }
    await this.promptConflict(path, next);
  }

  async applyDiskContent(next) {
    this.savedText = next;
    this.baseline = next;
    this.dropDraft();
    clearTimeout(this.timers.autoSave);
    if (this.child?.replaceContent) {
      this.child.replaceContent(next);
      this.savedSnap = this.child.snapshot();
    } else {
      await this.mountChild({ value: next });
    }
    this.setDirty(false);
  }

  async promptConflict(path, diskContent) {
    this.conflictPending = true;
    let choice = null;
    try {
      choice = await muxy.dialog.confirm({
        title: "File changed on disk",
        message: `${basename(path)} was modified outside the editor and you have unsaved changes. Reload from disk and discard your edits, or keep editing?`,
        buttons: ["Reload", "Keep My Changes"],
        default: "Keep My Changes",
        cancel: "Keep My Changes",
        style: "warning",
      });
    } catch {}
    this.conflictPending = false;
    if (this.path !== path || this.saving) return;
    if (choice === "Reload") await this.applyDiskContent(diskContent);
  }

  // ---- Data, config, keys --------------------------------------------------

  onDataChange(next) {
    const nextPath = next.filePath || null;
    if (nextPath === this.path) {
      this.data = next;
      this.gotoPosition(position_from(next));
      return;
    }
    if (this.dirty && this.path) {
      // Keep the unsaved buffer; show the requested file in its own tab.
      if (nextPath) void open_file(nextPath, position_from(next));
      return;
    }
    this.data = next;
    void this.loadTarget();
  }

  applyConfig(config) {
    const autoSaveTurnedOn = config.autoSave !== false && this.config.autoSave === false;
    this.config = config;
    this.child?.updateConfig?.(config, this.isDark);
    this.settings?.setConfig(config);
    this.updateTopbar();
    if (config.autoSave === false) clearTimeout(this.timers.autoSave);
    else if (autoSaveTurnedOn && this.dirty) this.scheduleAutoSave();
  }

  onKeyDown(event) {
    const key = event.key.toLowerCase();
    const modified = event.metaKey || event.ctrlKey;
    if (this.kind === "markdown" && this.mdMode === "preview") {
      const find = modified && !event.shiftKey && key === "f";
      const replace = modified && !event.shiftKey && !event.altKey && key === "r";
      const edit = !modified && !event.altKey && !event.shiftKey && key === "e" && !is_text_entry(event.target);
      if (find || replace || edit) {
        event.preventDefault();
        event.stopPropagation();
        void this.setMarkdownMode("edit", null, { remember: edit }).then(() => {
          if (find) this.child?.openSearch?.();
          if (replace) this.child?.openReplace?.();
        });
        return;
      }
    }
    if (modified && key === "s" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      void this.save();
    }
  }

  // ---- Chrome --------------------------------------------------------------

  updateTabChrome() {
    if (!this.path) {
      void muxy.tabs.setTitle("").catch?.(() => undefined);
      void muxy.tabs.setIcon(null).catch?.(() => undefined);
      return;
    }
    const name = basename(this.path);
    void muxy.tabs.setTitle(name).catch?.(() => undefined);
    void muxy.tabs.setIcon({ symbol: tab_symbol(name) }).catch?.(() => undefined);
  }

  /** Builds the topbar for this file's kind; later state changes only toggle it. */
  buildShell() {
    const path = this.path;
    const binary = is_binary_kind(this.kind);
    const segmented = (field, options) => {
      const buttons = options.map(([label, value, onClick]) =>
        h("button", { type: "button", role: "tab", class: "segment", onClick }, label),
      );
      const update = () =>
        options.forEach(([, value], index) => {
          const active = this[field] === value;
          buttons[index].classList.toggle("segment-active", active);
          buttons[index].setAttribute("aria-selected", String(active));
        });
      return { element: h("div", { class: "segmented topbar-segmented", role: "tablist" }, buttons), update };
    };
    const toolButton = (label, icon, onClick, extra = {}) =>
      h("button", { class: "tool-button", type: "button", "aria-label": label, title: label, onClick, ...extra }, icon());

    const actions = h("div", { class: "toolbar-actions" });
    const updaters = [];
    let toc = null;
    if (is_svg(path) || is_html(path)) {
      const field = is_svg(path) ? "svgView" : "htmlView";
      const control = segmented(field, [
        ["Code", false, () => void this.setSourceView(field, false)],
        [is_svg(path) ? "View" : "Preview", true, () => void this.setSourceView(field, true)],
      ]);
      updaters.push(control.update);
      actions.append(control.element);
    }
    if (this.kind === "markdown") {
      const control = segmented("mdMode", [
        ["Preview", "preview", () => void this.setMarkdownMode("preview", null, { remember: true })],
        ["Edit", "edit", () => void this.setMarkdownMode("edit", null, { remember: true })],
      ]);
      updaters.push(control.update);
      toc = toolButton("Table of contents", TocIcon, () => {
        this.showToc = !this.showToc;
        write_string(TOC_PREF_KEY, this.showToc ? "1" : "0");
        this.child?.setShowToc?.(this.showToc);
        this.updateTopbar();
      });
      actions.append(control.element, toc);
    }
    const save = binary ? null : toolButton("Save", SaveIcon, () => void this.save());
    if (save) actions.append(save);
    actions.append(
      toolButton("Reveal in Finder", RevealIcon, () => reveal_in_finder(this.path)),
      toolButton("Open externally", OpenIcon, () => open_externally(this.path)),
    );
    if (!binary) {
      actions.append(toolButton("Editor settings", SettingsIcon, () => void this.openSettings()));
    }

    const dot = h("span", { class: "editor-dirty", "aria-label": "Unsaved", hidden: true });
    const name = h("span", { class: "editor-name", title: path }, basename(path));
    const title = h("div", { class: "editor-title" }, name, dot);
    this.topbarParts = { dot, name, save, toc, updaters };
    this.body = h("div", { class: "editor-body" });
    this.shell = h("div", { class: "editor" }, h("div", { class: "topbar" }, title, actions), this.body);
    this.root.replaceChildren(this.shell);
    this.updateTopbar();
  }

  updateTopbar() {
    const parts = this.topbarParts;
    if (!parts || !this.shell) return;
    parts.dot.hidden = !this.dirty;
    // Like an IDE's preview tab: an italic name means the next file you open
    // replaces this one. Editing the file keeps it.
    const preview = this.preview && this.config.reuseTab !== false;
    parts.name.classList.toggle("editor-name-preview", preview);
    parts.name.title = preview ? `${this.path} — preview: the next file you open replaces it; edit it to keep it open` : (this.path ?? "");
    if (parts.save) {
      parts.save.disabled = !this.dirty || this.saving;
      parts.save.classList.toggle("tool-button-accent", this.dirty);
    }
    if (parts.toc) {
      parts.toc.hidden = this.mdMode !== "preview";
      parts.toc.classList.toggle("tool-button-active", this.showToc);
      parts.toc.setAttribute("aria-pressed", String(this.showToc));
    }
    for (const update of parts.updaters) update();
  }

  async openSettings() {
    if (this.settings) return;
    const { SettingsSheet } = await load_settings();
    if (this.settings || !this.shell) return;
    this.settings = new SettingsSheet({
      parent: this.shell,
      config: this.config,
      // Saving announces the change, which applies it here and in every other editor tab.
      update: (patch) => void update_editor_config(this.config, patch),
      onClose: () => {
        this.settings?.destroy();
        this.settings = null;
        this.focusEditor();
      },
    });
  }
}
