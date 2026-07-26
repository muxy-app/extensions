import { basename, error_message, open_externally, reveal_in_finder, same_file, try_action } from "@/lib/files";
import { is_html, is_image, is_markdown, is_pdf, is_svg } from "@/lib/languages";
import { icon_for } from "@/lib/file-icon";
import { CodeEditor } from "@/editor/code-editor";
import { MarkdownEditor } from "@/editor/markdown-editor";
import { ImageViewer } from "@/editor/image-viewer";
import { PdfViewer } from "@/editor/pdf-viewer";
import { HtmlViewer } from "@/editor/html-viewer";
import { SettingsSheet } from "@/editor/settings-sheet";
import { OpenIcon, RevealIcon, SaveIcon, SettingsIcon, TocIcon } from "@/editor/icons";
import {
  AUTO_SAVE_DELAY_MS,
  load_editor_config,
  subscribe_editor_config,
  update_editor_config,
} from "@/lib/editor-config";
import {
  clear_editor_state,
  create_editor_state_id,
  write_editor_state,
} from "@/lib/editor-state";
import { clear_draft, read_draft, write_draft } from "@/lib/draft-state";
import { clear, cls, h, read_pref, write_pref } from "@/lib/dom";

const RELOAD_DEBOUNCE_MS = 250;
const TOC_PREF_KEY = "files:md-toc";

function read_data() {
  return window.muxy?.data ?? {};
}

function is_text_entry(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export class EditorApp {
  constructor(root) {
    this.root = root;
    this.data = read_data();
    this.content = null;
    this.loading = false;
    this.error = null;
    this.dirty = false;
    this.saving = false;
    this.isDark = muxy.theme?.colorScheme === "dark";
    this.showSettings = false;
    this.mdMode = "preview";
    this.showToc = read_pref(TOC_PREF_KEY, "0") === "1";
    this.svgView = false;
    this.htmlView = false;
    this.config = load_editor_config();
    this.editorStateId = create_editor_state_id();
    this.disposers = [];
    this.fileLoadId = 0;
    this.pendingPosition = null;
    this.shell = null;
    this.shellFilePath = null;
    this.bodyKey = null;
    this.child = null;
    this.settingsSheet = null;
    this.tabFocused = document.hasFocus();
    this.pendingFocusRaf = 0;
    this.reloadTimer = 0;
    this.conflictPending = false;
    this.autoSaveTimer = 0;
    this.lastWritten = null;
    this.baseline = null;
  }

  start() {
    this.disposers.push(
      muxy.onDataChange((next) => {
        const nextData = next ?? {};
        const prevPath = this.data.filePath;
        const nextPath = nextData.filePath;

        if (this.dirty && prevPath) {
          if (nextPath && nextPath !== prevPath) {
            void muxy.tabs.open({
              kind: "extensionWebView",
              extension: {
                id: muxy.extensionID,
                tabType: "code-editor",
                data: { filePath: nextPath, replaceable: false },
              },
            });
          }
          return;
        }

        this.data = nextData;
        void this.loadTarget();
      }),
      muxy.onThemeChange((theme) => {
        this.isDark = theme.colorScheme === "dark";
        this.child?.updateConfig?.(this.config, this.isDark);
      }),
      subscribe_editor_config((config) => {
        this.config = config;
        this.child?.updateConfig?.(this.config, this.isDark);
        this.settingsSheet?.setConfig(this.config);
        this.syncAutoSave();
      }),
      muxy.events.subscribe("file.changed", (payload) => this.onFileChanged(payload)),
      muxy.events.subscribe("command.files-save", () => {
        if (!document.hasFocus()) return;
        void this.save();
      }),
      muxy.events.subscribe("command.files-find", () => {
        if (!document.hasFocus()) return;
        if (this.isMarkdown() && this.mdMode === "preview") {
          this.setMarkdownMode("edit");
          requestAnimationFrame(() => this.child?.openSearch?.());
          return;
        }
        this.child?.openSearch?.();
      }),
      muxy.events.subscribe("command.files-replace", () => {
        if (!document.hasFocus()) return;
        if (this.isMarkdown() && this.mdMode === "preview") {
          this.setMarkdownMode("edit");
          requestAnimationFrame(() => this.child?.openReplace?.());
          return;
        }
        this.child?.openReplace?.();
      }),
    );

    this.keyHandler = (event) => {
      const key = event.key.toLowerCase();
      if (this.isMarkdown() && this.mdMode === "preview") {
        const modified = event.metaKey || event.ctrlKey;
        const isFindKey = modified && !event.shiftKey && key === "f";
        const isReplaceKey = modified && !event.shiftKey && !event.altKey && key === "r";
        const isEditKey = !modified && !event.altKey && !event.shiftKey && key === "e" && !is_text_entry(event.target);
        if (isFindKey || isReplaceKey || isEditKey) {
          event.preventDefault();
          event.stopPropagation();
          this.setMarkdownMode("edit");
          if (isFindKey) requestAnimationFrame(() => this.child?.openSearch?.());
          if (isReplaceKey) requestAnimationFrame(() => this.child?.openReplace?.());
          return;
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        void this.save();
      }
    };
    window.addEventListener("keydown", this.keyHandler, true);
    this.disposers.push(() => window.removeEventListener("keydown", this.keyHandler, true));

    const onWindowFocus = () => {
      this.tabFocused = true;
      if (!is_text_entry(document.activeElement)) this.focusEditor();
    };
    const onWindowBlur = () => {
      this.tabFocused = false;
    };
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("blur", onWindowBlur);
    this.disposers.push(() => {
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("blur", onWindowBlur);
    });

    this.heartbeat = window.setInterval(() => this.publishEditorState(), 2000);
    const clearState = () => clear_editor_state(this.editorStateId);
    window.addEventListener("pagehide", clearState);
    const offBeforeClose = muxy.lifecycle?.onBeforeClose?.(() => this.handleBeforeClose());
    this.disposers.push(() => {
      window.clearInterval(this.heartbeat);
      window.removeEventListener("pagehide", clearState);
      offBeforeClose?.();
      clearState();
    });

    void this.loadTarget();
  }

  dispose() {
    if (this.pendingFocusRaf) cancelAnimationFrame(this.pendingFocusRaf);
    if (this.reloadTimer) window.clearTimeout(this.reloadTimer);
    this.cancelAutoSave();
    this.destroyChild();
    this.destroySettings();
    for (const dispose of this.disposers) dispose?.();
    this.disposers = [];
  }

  get filePath() {
    return this.data.filePath;
  }

  get replaceable() {
    return this.data.replaceable !== false;
  }

  isMarkdown() {
    return this.filePath ? is_markdown(this.filePath) : false;
  }

  isImage() {
    return this.filePath ? is_image(this.filePath) : false;
  }

  isPdf() {
    return this.filePath ? is_pdf(this.filePath) : false;
  }

  isBinaryViewer() {
    return this.isImage() || this.isPdf();
  }

  isSvg() {
    return this.filePath ? is_svg(this.filePath) : false;
  }

  isHtml() {
    return this.filePath ? is_html(this.filePath) : false;
  }

  async loadTarget() {
    const filePath = this.filePath;
    this.pendingPosition = this.positionFromData();
    this.updateTabChrome();

    // Switching/reloading the target supersedes any pending external-change work.
    if (this.reloadTimer) {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = 0;
    }
    this.cancelAutoSave();
    this.conflictPending = false;
    this.lastWritten = null;
    this.baseline = null;

    if (!filePath) {
      this.fileLoadId += 1;
      this.content = null;
      this.error = null;
      this.loading = false;
      this.setDirty(false);
      this.render();
      return;
    }

    const loadId = ++this.fileLoadId;
    this.loading = true;
    this.error = null;
    this.content = null;
    this.mdMode = "preview";
    this.svgView = false;
    this.htmlView = false;
    this.setDirty(false);
    this.render();

    if (this.isBinaryViewer()) {
      this.content = "";
      this.error = null;
      this.loading = false;
      this.setDirty(false);
      this.render();
      return;
    }

    try {
      const file = await muxy.files.read(filePath);
      if (this.fileLoadId !== loadId) return;
      const draft = await this.restorableDraft(filePath, file.content);
      if (this.fileLoadId !== loadId) return;
      this.content = draft ? draft.content : file.content;
      this.baseline = draft ? draft.baseline : file.content;
      this.error = null;
      this.setDirty(Boolean(draft));
    } catch (err) {
      if (this.fileLoadId !== loadId) return;
      this.content = null;
      this.error = error_message(err);
    } finally {
      if (this.fileLoadId === loadId) {
        this.loading = false;
        this.render();
      }
    }
  }

  async restorableDraft(filePath, diskContent) {
    let draft;
    try {
      draft = await read_draft(filePath);
    } catch {
      return null;
    }
    if (!draft) return null;
    if (draft.content === diskContent) {
      void clear_draft(filePath);
      return null;
    }
    return draft;
  }

  onFileChanged(payload) {
    const filePath = this.filePath;
    if (!filePath) return;
    const changed = payload && typeof payload === "object" && "path" in payload ? payload.path : undefined;
    if (typeof changed !== "string" || !same_file(changed, filePath)) return;
    // Skip while loading or mid-save: those go through loadTarget()/save(),
    // which already sync this.content with the freshest value.
    if (this.loading || this.saving) return;
    // A conflict prompt is open — don't queue another reload behind it.
    if (this.conflictPending) return;
    if (this.reloadTimer) return;
    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = 0;
      void this.reloadFromDisk(filePath);
    }, RELOAD_DEBOUNCE_MS);
  }

  async reloadFromDisk(filePath) {
    if (this.filePath !== filePath) return;
    if (this.loading || this.saving) return;
    // A conflict prompt for this file is already open — let the user resolve it first.
    if (this.conflictPending) return;

    if (this.isBinaryViewer()) {
      // Re-mount binary viewers so they re-fetch the changed bytes.
      this.bodyKey = null;
      this.render();
      return;
    }

    let next;
    try {
      const file = await muxy.files.read(filePath);
      next = file.content;
    } catch {
      return;
    }
    if (this.filePath !== filePath || this.saving || this.conflictPending) return;

    if (next === this.lastWritten) {
      this.content = next;
      return;
    }

    if (!this.dirty) {
      // Clean buffer: silently adopt the new bytes. Ignore no-op events (e.g. our own save).
      if (next === this.content) return;
      this.applyDiskContent(next);
      return;
    }

    // Unsaved edits exist. Compare against the live buffer, not this.content
    // (which still holds the value the file was opened with).
    const buffer = this.child?.getValue ? this.child.getValue() : this.content;
    if (next === buffer) return; // Disk matches what the user has — no real conflict.

    void this.promptConflict(filePath, next);
  }

  applyDiskContent(next) {
    this.content = next;
    this.baseline = next;
    this.error = null;
    this.bodyKey = null;
    this.dropDraft();
    this.setDirty(false);
    this.render();
  }

  async promptConflict(filePath, diskContent) {
    this.conflictPending = true;
    const name = basename(filePath);
    let choice;
    try {
      choice = await muxy.dialog.confirm({
        title: "File changed on disk",
        message: `${name} was modified outside the editor and you have unsaved changes. Reload from disk and discard your edits, or keep editing?`,
        buttons: ["Reload", "Keep My Changes"],
        default: "Keep My Changes",
        cancel: "Keep My Changes",
        style: "warning",
      });
    } catch {
      choice = null;
    } finally {
      this.conflictPending = false;
    }
    // The user may have switched files or saved while the dialog was open.
    if (this.filePath !== filePath || this.saving) return;
    if (choice === "Reload") this.applyDiskContent(diskContent);
  }

  updateTabChrome() {
    if (!this.filePath) {
      void muxy.tabs.setTitle("");
      void muxy.tabs.setIcon(null);
      return;
    }
    void muxy.tabs.setTitle(basename(this.filePath));
    void muxy.tabs.setIcon({ symbol: icon_for(this.filePath) });
  }

  publishEditorState(nextDirty = this.dirty) {
    write_editor_state(this.editorStateId, {
      dirty: nextDirty,
      filePath: this.filePath,
      replaceable: this.replaceable,
    });
  }

  setDirty(next) {
    this.dirty = next;
    this.publishEditorState(next);
    this.updateTopbar();
  }

  markDirty() {
    if (this.dirty) {
      this.publishEditorState(true);
    } else {
      this.setDirty(true);
    }
    this.persistDraft();
    this.scheduleAutoSave();
  }

  persistDraft() {
    if (!this.filePath || this.isBinaryViewer() || this.baseline === null) return;
    if (typeof this.child?.getValue !== "function") return;
    void write_draft(this.filePath, this.child.getValue(), this.baseline);
  }

  dropDraft(filePath = this.filePath) {
    if (!filePath) return;
    void clear_draft(filePath);
  }

  scheduleAutoSave() {
    if (this.autoSaveTimer) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = 0;
    }
    if (this.config.autoSave === false) return;
    if (!this.filePath || this.isBinaryViewer()) return;
    this.autoSaveTimer = window.setTimeout(() => {
      this.autoSaveTimer = 0;
      // Re-check at fire time: the buffer may be clean again, or a save/conflict in flight.
      if (!this.dirty || this.saving || this.conflictPending) return;
      void this.save(false);
    }, AUTO_SAVE_DELAY_MS);
  }

  cancelAutoSave() {
    if (this.autoSaveTimer) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = 0;
    }
  }

  async save(deliberate = true) {
    if (!this.filePath || !this.child || this.saving) return false;
    if (typeof this.child.getValue !== "function") return false;
    this.cancelAutoSave();
    const next = this.child.getValue();
    this.saving = true;
    this.updateTopbar();
    const ok = await try_action(() => muxy.files.write(this.filePath, next), "Save failed");
    this.saving = false;
    if (ok) {
      this.content = next;
      this.lastWritten = next;
      // A deliberate save commits a new baseline; auto-saves stay discardable
      // back to the content the tab was opened with.
      if (deliberate) this.baseline = next;
      this.dropDraft();
      this.setDirty(false);
    }
    this.updateTopbar();
    return ok;
  }

  async handleBeforeClose() {
    const block = await this.confirmClose();
    if (!block) this.dropDraft();
    return block;
  }

  async confirmClose() {
    if (!this.dirty || !this.filePath || this.isBinaryViewer()) return false;
    this.cancelAutoSave();
    const name = basename(this.filePath);
    const choice = await muxy.dialog.confirm({
      title: "Unsaved changes",
      message: `${name} has unsaved changes. Save them before closing?`,
      buttons: ["Save", "Discard", "Cancel"],
      default: "Save",
      cancel: "Cancel",
      style: "warning",
    });
    if (choice === null || choice === "Cancel") {
      // Reinstate auto-save the user cancelled out of, so pending edits still flush.
      this.scheduleAutoSave();
      return true;
    }
    if (choice === "Save") {
      const ok = await this.save();
      if (!ok) this.scheduleAutoSave();
      return !ok; // Block the close only if the save failed.
    }
    // Discard: if auto-save already flushed edits to disk, restore the content
    // the file had when this tab was opened before letting the close proceed.
    return await this.discardChanges();
  }

  async discardChanges() {
    if (this.baseline === null) return false;
    let onDisk;
    try {
      const file = await muxy.files.read(this.filePath);
      onDisk = file.content;
    } catch {
      // Can't read disk — nothing safe to restore; allow the close.
      return false;
    }
    if (onDisk === this.baseline) return false; // Disk already holds the original.
    const ok = await try_action(() => muxy.files.write(this.filePath, this.baseline), "Discard failed");
    if (ok) {
      this.content = this.baseline;
      this.lastWritten = this.baseline;
      this.dropDraft();
      this.setDirty(false);
    }
    return !ok; // Block the close only if restoring the original failed.
  }

  onTaskToggled(next) {
    this.content = next;
    void this.save();
  }

  setMarkdownMode(mode) {
    if (this.mdMode === mode) return;
    if (this.child?.getValue) this.content = this.child.getValue();
    this.mdMode = mode;
    this.bodyKey = null;
    this.render();
  }

  toggleToc() {
    this.showToc = !this.showToc;
    write_pref(TOC_PREF_KEY, this.showToc ? "1" : "0");
    this.child?.setShowToc?.(this.showToc);
    this.updateTopbar();
  }

  setSvgView(view) {
    if (this.svgView === view) return;
    if (this.child?.getValue) this.content = this.child.getValue();
    this.svgView = view;
    this.bodyKey = null;
    this.render();
  }

  setHtmlView(view) {
    if (this.htmlView === view) return;
    if (this.child?.getValue) this.content = this.child.getValue();
    this.htmlView = view;
    this.bodyKey = null;
    this.render();
  }

  updateConfig(patch) {
    this.config = update_editor_config(this.config, patch);
    this.child?.updateConfig?.(this.config, this.isDark);
    this.settingsSheet?.setConfig(this.config);
    this.syncAutoSave();
  }

  syncAutoSave() {
    if (this.config.autoSave === false) {
      this.cancelAutoSave();
      return;
    }
    // Turned on (or already on) with pending edits — make sure a save is scheduled.
    if (this.dirty && !this.autoSaveTimer) this.scheduleAutoSave();
  }

  render() {
    const filePath = this.filePath;
    if (!filePath) {
      this.destroyChild();
      this.destroySettings();
      this.shell = null;
      this.shellFilePath = null;
      this.root.replaceChildren(h("div", { class: "editor" }, h("div", { class: "editor-empty" }, "No file open")));
      return;
    }

    if (!this.shell || this.shellFilePath !== filePath) {
      this.destroyChild();
      this.destroySettings();
      this.shellFilePath = filePath;
      this.bodyKey = null;
      this.topbar = h("div", { class: "topbar" });
      this.body = h("div", { class: "editor-body" });
      this.shell = h("div", { class: "editor" }, this.topbar, this.body);
      this.root.replaceChildren(this.shell);
    }

    this.updateTopbar();
    this.renderBody();
    this.renderSettings();
  }

  updateTopbar() {
    if (!this.topbar || !this.filePath) return;
    const markdown = this.isMarkdown();
    const image = this.isImage();
    const pdf = this.isPdf();
    const binaryViewer = image || pdf;
    const svg = this.isSvg();
    const html = this.isHtml();
    clear(this.topbar);
    const title = h("div", { class: "editor-title" }, h("span", { class: "editor-name" }, basename(this.filePath)));
    if (this.dirty) title.appendChild(h("span", { class: "editor-dirty", "aria-label": "Unsaved" }));

    const actions = h("div", { class: "toolbar-actions" });
    if (svg) {
      actions.appendChild(
        h(
          "div",
          { class: "segmented topbar-segmented", role: "tablist" },
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": !this.svgView,
              class: cls("segment", !this.svgView && "segment-active"),
              onClick: () => this.setSvgView(false),
            },
            "Code",
          ),
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": this.svgView,
              class: cls("segment", this.svgView && "segment-active"),
              onClick: () => this.setSvgView(true),
            },
            "View",
          ),
        ),
      );
      actions.appendChild(h("span", { class: "toolbar-divider" }));
    }
    if (html) {
      actions.appendChild(
        h(
          "div",
          { class: "segmented topbar-segmented", role: "tablist" },
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": !this.htmlView,
              class: cls("segment", !this.htmlView && "segment-active"),
              onClick: () => this.setHtmlView(false),
            },
            "Code",
          ),
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": this.htmlView,
              class: cls("segment", this.htmlView && "segment-active"),
              onClick: () => this.setHtmlView(true),
            },
            "Preview",
          ),
        ),
      );
      actions.appendChild(h("span", { class: "toolbar-divider" }));
    }
    if (markdown) {
      actions.appendChild(
        h(
          "div",
          { class: "segmented topbar-segmented", role: "tablist" },
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": this.mdMode === "preview",
              class: cls("segment", this.mdMode === "preview" && "segment-active"),
              onClick: () => this.setMarkdownMode("preview"),
            },
            "Preview",
          ),
          h(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": this.mdMode === "edit",
              class: cls("segment", this.mdMode === "edit" && "segment-active"),
              onClick: () => this.setMarkdownMode("edit"),
            },
            "Edit",
          ),
        ),
      );
      if (this.mdMode === "preview") {
        actions.appendChild(
          h(
            "button",
            {
              class: cls("tool-button", this.showToc && "tool-button-active"),
              type: "button",
              "aria-label": "Table of contents",
              "aria-pressed": this.showToc,
              title: "Table of contents",
              onClick: () => this.toggleToc(),
            },
            TocIcon(),
          ),
        );
      }
      actions.appendChild(h("span", { class: "toolbar-divider" }));
    }

    if (!binaryViewer) {
      actions.append(
        h(
          "button",
          {
            class: cls("tool-button", this.dirty && "tool-button-accent"),
            type: "button",
            "aria-label": "Save",
            title: "Save",
            disabled: !this.dirty || this.saving,
            onClick: () => void this.save(),
          },
          SaveIcon(),
        ),
      );
    }

    actions.append(
      h(
        "button",
        {
          class: "tool-button",
          type: "button",
          "aria-label": "Reveal in Finder",
          title: "Reveal in Finder",
          onClick: () => void reveal_in_finder(this.filePath),
        },
        RevealIcon(),
      ),
      h(
        "button",
        {
          class: "tool-button",
          type: "button",
          "aria-label": "Open externally",
          title: "Open externally",
          onClick: () => void open_externally(this.filePath),
        },
        OpenIcon(),
      ),
    );

    if (!binaryViewer) {
      actions.append(
        h("span", { class: "toolbar-divider" }),
        h(
          "button",
          {
            class: "tool-button",
            type: "button",
            "aria-label": "Editor settings",
            title: "Editor settings",
            onClick: () => {
              this.showSettings = true;
              this.renderSettings();
            },
          },
          SettingsIcon(),
        ),
      );
    }

    this.topbar.append(title, actions);
  }

  renderBody() {
    if (!this.body) return;
    if (this.loading) {
      this.destroyChild();
      this.body.replaceChildren(h("div", { class: "editor-status" }, "Loading..."));
      return;
    }
    if (this.error) {
      this.destroyChild();
      this.body.replaceChildren(h("div", { class: "editor-status editor-error" }, this.error));
      return;
    }
    if (this.content === null) {
      this.destroyChild();
      this.body.replaceChildren();
      return;
    }

    const image = this.isImage();
    const pdf = this.isPdf();
    const svgPreview = this.isSvg() && this.svgView;
    const htmlPreview = this.isHtml() && this.htmlView;
    const markdown = this.isMarkdown();
    let key;
    if (image) key = `${this.filePath}:image`;
    else if (pdf) key = `${this.filePath}:pdf`;
    else if (svgPreview) key = `${this.filePath}:svg-view`;
    else if (htmlPreview) key = `${this.filePath}:html-view`;
    else if (markdown) key = `${this.filePath}:markdown:${this.mdMode}`;
    else key = `${this.filePath}:code`;
    if (this.bodyKey === key && this.child) {
      this.child.updateConfig?.(this.config, this.isDark);
      return;
    }

    this.destroyChild();
    this.bodyKey = key;
    if (image) {
      this.child = new ImageViewer({ parent: this.body, filePath: this.filePath });
      return;
    }
    if (pdf) {
      this.child = new PdfViewer({ parent: this.body, filePath: this.filePath });
      return;
    }
    if (svgPreview) {
      this.child = new ImageViewer({
        parent: this.body,
        filePath: this.filePath,
        svgSource: this.content,
      });
      return;
    }
    if (htmlPreview) {
      this.child = new HtmlViewer({
        parent: this.body,
        filePath: this.filePath,
        source: this.content,
      });
      return;
    }
    if (markdown) {
      const initialPosition = this.initialPosition();
      if (initialPosition) this.mdMode = "edit";
      this.child = new MarkdownEditor({
        parent: this.body,
        filePath: this.filePath,
        value: this.content,
        isDark: this.isDark,
        config: this.config,
        mode: this.mdMode,
        initialPosition,
        showToc: this.showToc,
        onDirty: () => this.markDirty(),
        onSave: () => this.save(),
        onToggleTask: (next) => this.onTaskToggled(next),
      });
      this.focusEditor();
      return;
    }

    this.child = new CodeEditor({
      parent: this.body,
      filePath: this.filePath,
      value: this.content,
      isDark: this.isDark,
      config: this.config,
      initialPosition: this.initialPosition(),
      onDirty: () => this.markDirty(),
      onSave: () => this.save(),
    });
    this.focusEditor();
  }

  positionFromData() {
    const line = Number(this.data.line);
    if (!Number.isInteger(line) || line < 1) return null;
    const column = Number(this.data.column);
    return {
      line,
      column: Number.isInteger(column) && column >= 1 ? column : 1,
    };
  }

  initialPosition() {
    const position = this.pendingPosition;
    this.pendingPosition = null;
    return position;
  }

  focusEditor() {
    if (!this.tabFocused) return;
    if (this.pendingFocusRaf) cancelAnimationFrame(this.pendingFocusRaf);
    this.pendingFocusRaf = requestAnimationFrame(() => {
      this.pendingFocusRaf = 0;
      this.child?.focus?.();
    });
  }

  renderSettings() {
    if (!this.shell) return;
    if (!this.showSettings) {
      this.destroySettings();
      return;
    }
    if (this.settingsSheet) {
      this.settingsSheet.setConfig(this.config);
      return;
    }
    this.settingsSheet = new SettingsSheet({
      parent: this.shell,
      config: this.config,
      update: (patch) => this.updateConfig(patch),
      onClose: () => {
        this.showSettings = false;
        this.renderSettings();
      },
    });
  }

  destroyChild() {
    this.child?.destroy?.();
    this.child = null;
    this.bodyKey = null;
  }

  destroySettings() {
    this.settingsSheet?.destroy?.();
    this.settingsSheet = null;
  }
}
