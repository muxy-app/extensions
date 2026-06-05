import { basename, error_message, open_externally, reveal_in_finder, try_action } from "@/lib/files";
import { is_markdown } from "@/lib/languages";
import { icon_for } from "@/lib/file-icon";
import { CodeEditor } from "@/editor/code-editor";
import { MarkdownEditor } from "@/editor/markdown-editor";
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
    this.config = load_editor_config();
    this.editorStateId = create_editor_state_id();
    this.disposers = [];
    this.fileLoadId = 0;
    this.shell = null;
    this.shellFilePath = null;
    this.bodyKey = null;
    this.child = null;
    this.settingsSheet = null;
  }

  start() {
    this.disposers.push(
      muxy.onDataChange((next) => {
        this.data = next ?? {};
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        void this.save();
      }
    };
    window.addEventListener("keydown", this.keyHandler, true);
    this.disposers.push(() => window.removeEventListener("keydown", this.keyHandler, true));

    this.heartbeat = window.setInterval(() => this.publishEditorState(), 2000);
    const clearState = () => clear_editor_state(this.editorStateId);
    window.addEventListener("pagehide", clearState);
    window.addEventListener("beforeunload", clearState);
    this.disposers.push(() => {
      window.clearInterval(this.heartbeat);
      window.removeEventListener("pagehide", clearState);
      window.removeEventListener("beforeunload", clearState);
      clearState();
    });

    void this.loadTarget();
  }

  dispose() {
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
    this.setDirty(false);
    this.render();

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
    if (!this.filePath || !this.child || this.saving) return;
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
  }

  setMarkdownMode(mode) {
    if (this.mdMode === mode) return;
    if (this.child?.getValue) this.content = this.child.getValue();
    this.mdMode = mode;
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
    clear(this.topbar);
    const title = h("div", { class: "editor-title" }, h("span", { class: "editor-name" }, basename(this.filePath)));
    if (this.dirty) title.appendChild(h("span", { class: "editor-dirty", "aria-label": "Unsaved" }));

    const actions = h("div", { class: "toolbar-actions" });
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

    const markdown = this.isMarkdown();
    const key = markdown ? `${this.filePath}:markdown:${this.mdMode}` : `${this.filePath}:code`;
    if (this.bodyKey === key && this.child) {
      this.child.updateConfig?.(this.config, this.isDark);
      return;
    }

    this.destroyChild();
    this.bodyKey = key;
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
