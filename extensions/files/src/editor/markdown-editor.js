import { CodeEditor } from "@/editor/code-editor";
import { MarkdownView } from "@/editor/markdown-view";

export class MarkdownEditor {
  constructor({ parent, filePath, value, isDark, config, mode, onDirty, onSave }) {
    this.parent = parent;
    this.filePath = filePath;
    this.source = value;
    this.isDark = isDark;
    this.config = config;
    this.mode = mode;
    this.onDirty = onDirty;
    this.onSave = onSave;
    this.child = null;
    this.render();
  }

  render() {
    this.destroyChild();
    if (this.mode === "preview") {
      this.child = new MarkdownView({ source: this.source, fontSize: this.config.fontSize });
      this.parent.replaceChildren(this.child.element);
      return;
    }
    this.child = new CodeEditor({
      parent: this.parent,
      filePath: this.filePath,
      value: this.source,
      isDark: this.isDark,
      config: this.config,
      onDirty: this.onDirty,
      onSave: this.onSave,
    });
  }

  destroyChild() {
    this.child?.destroy?.();
    this.child = null;
  }

  getValue() {
    return this.child?.getValue?.() ?? this.source;
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
      this.child?.update?.(this.source, config.fontSize);
      return;
    }
    this.child?.updateConfig?.(config, isDark);
  }

  destroy() {
    this.source = this.getValue();
    this.destroyChild();
  }
}
