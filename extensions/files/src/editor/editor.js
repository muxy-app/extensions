import { basename, error_message, open_externally, reveal_in_finder, try_action } from "@/lib/files";
import { is_image, is_markdown, is_svg } from "@/lib/languages";
import { icon_for } from "@/lib/file-icon";
import { CodeEditor } from "@/editor/code-editor";
import { MarkdownEditor } from "@/editor/markdown-editor";
import { ImageViewer } from "@/editor/image-viewer";
import { SettingsSheet } from "@/editor/settings-sheet";
import { OpenIcon, RevealIcon, SaveIcon, SettingsIcon } from "@/editor/icons";
import {
  load_editor_config,
  subscribe_editor_config,
  update_editor_config,
} from "@/lib/editor-config";
import {
  clear_editor_state,
  create_editor_state_id,
  write_editor_state,
} from "@/lib/editor-state";
import { clear, cls, h } from "@/lib/dom";

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
    this.svgView = false;
    this.config = load_editor_config();
    this.editorStateId = create_editor_state_id();
    this.disposers = [];
    this.fileLoadId = 0;
    this.shell = null;
    this.shellFilePath = null;
    this.bodyKey = null;
    this.child = null;
    this.settingsSheet = null;
    this.tabFocused = document.hasFocus();
    this.pendingFocusRaf = 0;
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
      }),
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
    const offBeforeClose = muxy.lifecycle?.onBeforeClose?.(() => this.confirmClose());
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

  isSvg() {
    return this.filePath ? is_svg(this.filePath) : false;
  }

  async loadTarget() {
    const filePath = this.filePath;
    this.updateTabChrome();

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
    this.setDirty(false);
    this.render();

    // Raster images are binary, so skip the UTF-8 text read entirely; the image
    // viewer pulls the bytes in itself. `content` is set to an empty string so
    // renderBody treats the file as ready (it only branches to the viewer).
    if (this.isImage()) {
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
      this.content = file.content;
      this.error = null;
      this.setDirty(false);
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
      return;
    }
    this.setDirty(true);
  }

  async save() {
    if (!this.filePath || !this.child || this.saving) return false;
    if (typeof this.child.getValue !== "function") return false;
    const next = this.child.getValue();
    this.saving = true;
    this.updateTopbar();
    const ok = await try_action(() => muxy.files.write(this.filePath, next), "Save failed");
    this.saving = false;
    if (ok) {
      this.content = next;
      this.setDirty(false);
    }
    this.updateTopbar();
    return ok;
  }

  async confirmClose() {
    if (!this.dirty) return false;
    const name = this.filePath ? basename(this.filePath) : "This file";
    const choice = await muxy.dialog.confirm({
      title: "Unsaved changes",
      message: `${name} has unsaved changes. Save before closing?`,
      buttons: ["Save", "Don't Save", "Cancel"],
      default: "Save",
      cancel: "Cancel",
      style: "warning",
    });
    if (choice === null || choice === "Cancel") return true;
    if (choice === "Save") {
      const ok = await this.save();
      return !ok;
    }
    return false;
  }

  setMarkdownMode(mode) {
    if (this.mdMode === mode) return;
    if (this.child?.getValue) this.content = this.child.getValue();
    this.mdMode = mode;
    this.bodyKey = null;
    this.render();
  }

  setSvgView(view) {
    if (this.svgView === view) return;
    // Preserve in-editor edits so toggling to View renders the latest source.
    if (this.child?.getValue) this.content = this.child.getValue();
    this.svgView = view;
    this.bodyKey = null;
    this.render();
  }

  updateConfig(patch) {
    this.config = update_editor_config(this.config, patch);
    this.child?.updateConfig?.(this.config, this.isDark);
    this.settingsSheet?.setConfig(this.config);
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
    const svg = this.isSvg();
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
      actions.appendChild(h("span", { class: "toolbar-divider" }));
    }

    // Raster images can't be edited here, so they drop Save and editor Settings.
    if (!image) {
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

    if (!image) {
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
    const svgPreview = this.isSvg() && this.svgView;
    const markdown = this.isMarkdown();
    let key;
    if (image) key = `${this.filePath}:image`;
    else if (svgPreview) key = `${this.filePath}:svg-view`;
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
    if (svgPreview) {
      this.child = new ImageViewer({
        parent: this.body,
        filePath: this.filePath,
        svgSource: this.content,
      });
      return;
    }
    if (markdown) {
      this.child = new MarkdownEditor({
        parent: this.body,
        filePath: this.filePath,
        value: this.content,
        isDark: this.isDark,
        config: this.config,
        mode: this.mdMode,
        onDirty: () => this.markDirty(),
        onSave: () => this.save(),
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
      onDirty: () => this.markDirty(),
      onSave: () => this.save(),
    });
    this.focusEditor();
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
