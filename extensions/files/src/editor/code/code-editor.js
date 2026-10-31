// CodeMirror editor for one file. Typing only runs CodeMirror's own update
// plus a cheap `onChange` callback: full-text copies, git diffs, cursor
// persistence, and linting all happen later, when the editor is idle.

import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { gotoLine, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Text } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { cls, h, icon_svg } from "@/shared/dom";
import { extname } from "@/shared/paths";
import { muxy_cm_theme } from "./theme";
import { muxy_highlight_style } from "./syntax-theme";
import { grammar_for } from "./tree-sitter-langs";
import { tree_sitter_highlight } from "./tree-sitter-highlight";
import { FindPanel, open_find_panel } from "./find-panel";
import { git_gutter, set_git_baseline } from "./git-gutter";
import { head_baseline } from "./git-baseline";
import { colorSwatchExtension } from "./color-swatch";
import { read_cursor_state, write_cursor_state } from "../cursor-state";

const CURSOR_SAVE_DELAY_MS = 1000;
const BASELINE_DELAY_MS = 300;
const TREE_SITTER_GRACE_MS = 150;
const LINT_EXT = new Set([".json", ".webmanifest", ".jsonc", ".json5", ".yaml", ".yml"]);

/** Marks transactions that sync the buffer with disk rather than user edits. */
const external = Annotation.define();

function foldMarker(open) {
  const wrap = h("span", { class: cls("cm-fold-marker", !open && "cm-fold-marker-closed") }, icon_svg([{ d: "M6 9l6 6 6-6" }]));
  wrap.setAttribute("title", open ? "Fold" : "Unfold");
  wrap.setAttribute("aria-hidden", "true");
  return wrap;
}

// Triple-click selects whole lines, and dragging extends by lines.
function lineSelectionStyle() {
  return EditorView.mouseSelectionStyle.of((view, startEvent) => {
    if (startEvent.detail < 3 || startEvent.button !== 0) return null;
    const startPos = view.posAtCoords({ x: startEvent.clientX, y: startEvent.clientY });
    if (startPos == null) return null;
    const anchorLine = view.state.doc.lineAt(startPos);
    const selectionFor = (event) => {
      const doc = view.state.doc;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      const headLine = doc.lineAt(pos);
      const from = Math.min(anchorLine.from, headLine.from);
      const to = Math.max(anchorLine.to, headLine.to);
      return headLine.number < anchorLine.number
        ? EditorSelection.range(to, from, undefined, undefined, 1)
        : EditorSelection.range(from, to, undefined, undefined, -1);
    };
    return { get: (event) => selectionFor(event), update: () => {} };
  });
}

/** CRLF files keep CRLF on save; anything else is split on any break, joined with \n. */
function line_separator(value) {
  let crlf = 0;
  let lf = 0;
  for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", i + 1)) {
    lf += 1;
    if (i > 0 && value.charCodeAt(i - 1) === 13) crlf += 1;
  }
  return crlf > 0 && crlf === lf ? "\r\n" : null;
}

function offset_of(doc, position) {
  if (!position) return null;
  const line = doc.line(Math.max(1, Math.min(Math.floor(position.line), doc.lines)));
  const column = Math.max(1, Math.floor(position.column ?? 1));
  return Math.min(line.from + column - 1, line.to);
}

export class CodeEditor {
  constructor({ parent, filePath, value, isDark, config, initialPosition = null, onChange, onSave }) {
    this.filePath = filePath;
    this.isDark = isDark;
    this.config = config;
    this.onChange = onChange;
    this.onSave = onSave;
    this.destroyed = false;
    this.cursorTimer = 0;
    this.baselineTimer = 0;
    this.languageLoadId = 0;
    this.baselineLoadId = 0;
    this.languageCompartment = new Compartment();
    this.lintCompartment = new Compartment();
    this.configCompartment = new Compartment();

    this.container = h("div", { class: "editor-host" });
    parent.replaceChildren(this.container);

    const separator = line_separator(value);
    const extensions = [
      EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocorrect: "off", translate: "no" }),
      separator ? EditorState.lineSeparator.of(separator) : [],
      this.configCompartment.of(this.configExtensions(config, isDark)),
      this.languageCompartment.of([]),
      this.lintCompartment.of([]),
      git_gutter(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const isExternal = update.transactions.every((tr) => !tr.docChanged || tr.annotation(external));
          this.onChange?.(isExternal);
        }
        if (update.docChanged || update.selectionSet) this.scheduleCursorSave();
        if (update.focusChanged && !update.view.hasFocus) this.saveCursorState();
      }),
      EditorView.domEventHandlers({ scroll: () => this.scheduleCursorSave() }),
    ];

    const initialDoc = EditorState.create({ doc: value, extensions: separator ? EditorState.lineSeparator.of(separator) : [] }).doc;
    const initialOffset = offset_of(initialDoc, initialPosition);
    const saved = initialOffset === null ? read_cursor_state(filePath) : null;
    let selection;
    if (initialOffset !== null) selection = { anchor: initialOffset };
    else if (saved && saved.anchor <= initialDoc.length && saved.head <= initialDoc.length) {
      selection = { anchor: saved.anchor, head: saved.head };
    }

    this.view = new EditorView({
      parent: this.container,
      state: EditorState.create({ doc: initialDoc, selection, extensions }),
    });

    if (initialOffset !== null) {
      this.view.dispatch({ effects: EditorView.scrollIntoView(initialOffset, { y: "center" }) });
    } else if (saved?.scrollTop) {
      const top = saved.scrollTop;
      this.view.requestMeasure({ read: () => {}, write: () => { if (this.view) this.view.scrollDOM.scrollTop = top; } });
    }

    // Cmd+F / Cmd+R also work while focus is in the topbar.
    this.keyHandler = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      const isFind = event.key.toLowerCase() === "f" || event.code === "KeyF";
      const isReplace = !event.altKey && (event.key.toLowerCase() === "r" || event.code === "KeyR");
      if (!isFind && !isReplace) return;
      event.preventDefault();
      event.stopPropagation();
      open_find_panel(this.view, isReplace);
    };
    window.addEventListener("keydown", this.keyHandler, true);

    this.loadLanguage();
    this.loadLinter();
    this.scheduleBaseline(0);
  }

  // ---- Content -------------------------------------------------------------

  /** An immutable handle on the current content; O(1). */
  snapshot() {
    return this.view.state.doc;
  }

  matches(snapshot) {
    return snapshot instanceof Text ? this.view.state.doc.eq(snapshot) : this.getValue() === snapshot;
  }

  textOf(snapshot) {
    return snapshot instanceof Text ? snapshot.sliceString(0, snapshot.length, this.view.state.lineBreak) : String(snapshot);
  }

  snapshotOf(text) {
    return this.view.state.toText(text);
  }

  getValue() {
    return this.view.state.sliceDoc();
  }

  /**
   * Replaces the content with `text`, touching only the span that differs so
   * the cursor and scroll position survive. Disk reloads are flagged
   * `external` (they don't make the buffer dirty); restored drafts aren't.
   */
  replaceContent(text, { userEdit = false } = {}) {
    const state = this.view.state;
    const current = state.doc.toString();
    const next = state.toText(text).toString();
    if (current === next) return;
    let start = 0;
    const max = Math.min(current.length, next.length);
    while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;
    let end = 0;
    while (end < max - start && current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) {
      end += 1;
    }
    this.view.dispatch({
      changes: { from: start, to: current.length - end, insert: Text.of(next.slice(start, next.length - end).split("\n")) },
      annotations: userEdit ? [] : [external.of(true)],
      userEvent: userEdit ? "input.restore" : "reload",
    });
  }

  // ---- Focus, search, navigation -------------------------------------------

  focus() {
    this.view?.focus();
  }

  openSearch() {
    if (this.view) open_find_panel(this.view, false);
  }

  openReplace() {
    if (this.view) open_find_panel(this.view, true);
  }

  gotoPosition(position) {
    if (!this.view || !position?.line) return;
    const offset = offset_of(this.view.state.doc, position);
    this.view.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: "center" }),
    });
  }

  // ---- Configuration -------------------------------------------------------

  configExtensions(config, isDark) {
    const extensions = [
      Prec.highest(
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (void this.onSave?.(), true) },
          { key: "Mod-f", preventDefault: true, run: (view) => (open_find_panel(view, false), true) },
          { key: "Mod-r", preventDefault: true, run: (view) => (open_find_panel(view, true), true) },
          { key: "Mod-Alt-g", preventDefault: true, run: gotoLine },
        ]),
      ),
      history(),
      drawSelection(),
      lineSelectionStyle(),
      dropCursor(),
      highlightSpecialChars(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      rectangularSelection(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      search({ top: true, createPanel: (view) => new FindPanel(view) }),
      muxy_cm_theme(isDark),
      EditorView.theme({
        "&": { fontSize: `${config.fontSize}px` },
        ".cm-scroller": { fontSize: `${config.fontSize}px` },
      }),
      indentUnit.of(" ".repeat(config.tabSize)),
      EditorState.tabSize.of(config.tabSize),
    ];

    const keymaps = [...closeBracketsKeymap, ...searchKeymap, ...historyKeymap];
    if (config.autocomplete !== false) {
      extensions.push(
        autocompletion({ defaultKeymap: false, icons: false, activateOnTyping: false }),
        EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
      );
      keymaps.push(...completionKeymap, { key: "Ctrl-Space", preventDefault: true, run: startCompletion });
    }
    if (config.codeFolding !== false) {
      extensions.push(codeFolding(), foldGutter({ markerDOM: (open) => foldMarker(open) }));
      keymaps.push(...foldKeymap);
    }
    keymaps.push({
      key: "Tab",
      preventDefault: true,
      run: (view) => {
        if (config.autocomplete !== false && completionStatus(view.state) === "active") return acceptCompletion(view);
        if (view.state.selection.ranges.some((range) => !range.empty)) return indentMore(view);
        return insert_indent(view);
      },
      shift: indentLess,
    });
    keymaps.push(...defaultKeymap);
    extensions.push(keymap.of(keymaps));

    if (config.lineNumbers) extensions.push(lineNumbers());
    if (config.wordWrap) extensions.push(EditorView.lineWrapping);
    if (config.colorPreview !== false) extensions.push(colorSwatchExtension());
    return extensions;
  }

  updateConfig(config, isDark) {
    const previous = this.config;
    this.config = config;
    this.isDark = isDark;
    if (!this.view) return;
    this.view.dispatch({ effects: this.configCompartment.reconfigure(this.configExtensions(config, isDark)) });
    if ((previous.treeSitter !== false) !== (config.treeSitter !== false)) this.loadLanguage();
    if ((previous.linting !== false) !== (config.linting !== false)) this.loadLinter();
  }

  async loadLanguage() {
    const loadId = ++this.languageLoadId;
    const useTreeSitter = this.config.treeSitter !== false && grammar_for(this.filePath);
    const treeSitter = useTreeSitter
      ? import("./tree-sitter").then((m) => m.tree_sitter_for(this.filePath)).catch(() => null)
      : Promise.resolve(null);
    const lang = await import("./languages").then((m) => m.language_for(this.filePath)).catch(() => null);
    if (this.destroyed || loadId !== this.languageLoadId) return;

    const apply = (grammar) => {
      if (this.destroyed || loadId !== this.languageLoadId) return;
      const extensions = lang ? [lang] : [];
      extensions.push(grammar ? tree_sitter_highlight(grammar) : muxy_highlight_style());
      this.view.dispatch({ effects: this.languageCompartment.reconfigure(extensions) });
    };

    if (!useTreeSitter) return apply(null);
    // Give the grammar a moment so the file colors once; if it is still
    // compiling, color with Lezer now and switch when it is ready.
    const grace = new Promise((resolve) => setTimeout(() => resolve(undefined), TREE_SITTER_GRACE_MS));
    const early = await Promise.race([treeSitter, grace]);
    if (early !== undefined) return apply(early);
    apply(null);
    const grammar = await treeSitter;
    if (grammar) apply(grammar);
  }

  async loadLinter() {
    const enabled = this.config.linting !== false && LINT_EXT.has(extname(this.filePath));
    const extension = enabled ? await import("./linters").then((m) => m.lint_extension(this.filePath)).catch(() => null) : null;
    if (this.destroyed || !this.view) return;
    this.view.dispatch({ effects: this.lintCompartment.reconfigure(extension ?? []) });
  }

  // ---- Git gutter ----------------------------------------------------------

  /** The file was renamed or moved: keep the buffer, track the new path. */
  setFilePath(filePath) {
    this.filePath = filePath;
    this.refreshGitBaseline();
  }

  /** Re-reads the HEAD version (after a commit, checkout, …), debounced. */
  refreshGitBaseline() {
    this.scheduleBaseline(BASELINE_DELAY_MS);
  }

  scheduleBaseline(delay) {
    clearTimeout(this.baselineTimer);
    this.baselineTimer = setTimeout(() => void this.loadBaseline(), delay);
  }

  async loadBaseline() {
    const loadId = ++this.baselineLoadId;
    const baseline = await head_baseline(this.filePath);
    if (this.destroyed || !this.view || loadId !== this.baselineLoadId) return;
    if (baseline === this.baseline) return;
    this.baseline = baseline;
    this.view.dispatch({ effects: set_git_baseline(baseline) });
  }

  // ---- Cursor persistence --------------------------------------------------

  scheduleCursorSave() {
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => this.saveCursorState(), CURSOR_SAVE_DELAY_MS);
  }

  saveCursorState() {
    clearTimeout(this.cursorTimer);
    this.cursorTimer = 0;
    if (!this.view) return;
    const { anchor, head } = this.view.state.selection.main;
    write_cursor_state(this.filePath, { anchor, head, scrollTop: this.view.scrollDOM.scrollTop });
  }

  destroy() {
    if (this.view) this.saveCursorState();
    this.destroyed = true;
    clearTimeout(this.baselineTimer);
    window.removeEventListener("keydown", this.keyHandler, true);
    this.view?.destroy();
    this.view = null;
  }
}

// Tab with no selection inserts spaces up to the next tab stop.
function insert_indent(view) {
  const tabSize = view.state.tabSize;
  const changes = view.state.changeByRange((range) => {
    const col = range.head - view.state.doc.lineAt(range.head).from;
    const count = tabSize - (col % tabSize);
    return { changes: { from: range.from, insert: " ".repeat(count) }, range: EditorSelection.cursor(range.from + count) };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
}
