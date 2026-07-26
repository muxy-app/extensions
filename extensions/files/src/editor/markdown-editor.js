import { CodeEditor } from "@/editor/code-editor";
import { MarkdownView } from "@/editor/markdown-view";

export class MarkdownEditor {
  constructor({ parent, filePath, value, isDark, config, mode, initialPosition, showToc, onDirty, onSave, onToggleTask }) {
    this.parent = parent;
    this.filePath = filePath;
    this.source = value;
    this.isDark = isDark;
    this.config = config;
    this.mode = mode;
    this.initialPosition = initialPosition;
    this.showToc = showToc === true;
    this.onDirty = onDirty;
    this.onSave = onSave;
    this.onToggleTask = onToggleTask;
    this.child = null;
    this.render();
  }

  render() {
    this.destroyChild();
    if (this.mode === "preview") {
      this.child = new MarkdownView({
        source: this.source,
        fontSize: this.config.fontSize,
        isDark: this.isDark,
        filePath: this.filePath,
        showToc: this.showToc,
        onToggleTask: (next) => {
          this.source = next;
          this.onToggleTask?.(next);
        },
      });
      this.parent.replaceChildren(this.child.element);
      return;
    }
    this.child = new CodeEditor({
      parent: this.parent,
      filePath: this.filePath,
      value: this.source,
      isDark: this.isDark,
      config: this.config,
      initialPosition: this.initialPosition,
      onDirty: this.onDirty,
      onSave: this.onSave,
    });
    this.initialPosition = null;
  }

  destroyChild() {
    this.child?.destroy?.();
    this.child = null;
  }

  getValue() {
    return this.child?.getValue?.() ?? this.source;
  }

  focus() {
    if (this.mode !== "edit") return;
    this.child?.focus?.();
  }

  setShowToc(showToc) {
    this.showToc = showToc;
    if (this.mode === "preview") this.child?.setShowToc?.(showToc);
  }

  hasToc() {
    return this.mode === "preview" && Boolean(this.child?.hasToc?.());
  }

  openSearch() {
    this.child?.openSearch?.();
  }

  openReplace() {
    this.child?.openReplace?.();
  }

  updateConfig(config, isDark) {
    this.config = config;
    this.isDark = isDark;
    if (this.mode === "preview") {
      this.child?.update?.(this.source, config.fontSize, this.isDark);
      return;
    }
    this.child?.updateConfig?.(config, isDark);
  }

  destroy() {
    this.source = this.getValue();
    this.destroyChild();
  }
}
