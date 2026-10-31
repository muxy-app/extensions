import { CodeEditor } from "../code/code-editor";
import { MarkdownView } from "./markdown-view";

// A markdown file shows as a rendered preview or as source in CodeMirror.
// The app recreates this when the mode switches, carrying the text across.
export class MarkdownEditor {
  constructor({ parent, filePath, value, isDark, config, mode, initialPosition, showToc, onChange, onSave, onToggleTask }) {
    this.parent = parent;
    this.filePath = filePath;
    this.source = value;
    this.isDark = isDark;
    this.config = config;
    this.mode = mode;
    if (mode === "preview") {
      this.preview = new MarkdownView({
        source: value,
        fontSize: config.fontSize,
        isDark,
        filePath,
        showToc: showToc === true,
        onToggleTask: (next) => {
          this.source = next;
          onToggleTask?.(next);
        },
      });
      parent.replaceChildren(this.preview.element);
    } else {
      this.code = new CodeEditor({ parent, filePath, value, isDark, config, initialPosition, onChange, onSave });
    }
  }

  snapshot() {
    return this.code ? this.code.snapshot() : this.source;
  }

  matches(snapshot) {
    return this.code ? this.code.matches(snapshot) : snapshot === this.source;
  }

  textOf(snapshot) {
    return this.code ? this.code.textOf(snapshot) : String(snapshot);
  }

  snapshotOf(text) {
    return this.code ? this.code.snapshotOf(text) : text;
  }

  getValue() {
    return this.code ? this.code.getValue() : this.source;
  }

  replaceContent(text, options) {
    if (this.code) return this.code.replaceContent(text, options);
    this.source = text;
    this.preview.update(text, this.config.fontSize, this.isDark);
  }

  focus() {
    this.code?.focus();
  }

  setShowToc(showToc) {
    this.preview?.setShowToc(showToc);
  }

  openSearch() {
    this.code?.openSearch();
  }

  openReplace() {
    this.code?.openReplace();
  }

  gotoPosition(position) {
    this.code?.gotoPosition(position);
  }

  setFilePath(filePath) {
    this.filePath = filePath;
    this.code?.setFilePath(filePath);
  }

  refreshGitBaseline() {
    this.code?.refreshGitBaseline();
  }

  updateConfig(config, isDark) {
    const restyle = config.fontSize !== this.config.fontSize || isDark !== this.isDark;
    this.config = config;
    this.isDark = isDark;
    if (this.code) this.code.updateConfig(config, isDark);
    else if (restyle) this.preview.update(this.source, config.fontSize, isDark);
  }

  destroy() {
    this.code?.destroy();
    this.preview?.destroy();
    this.code = null;
    this.preview = null;
  }
}
