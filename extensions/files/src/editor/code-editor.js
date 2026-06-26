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
import { lintGutter, lintKeymap } from "@codemirror/lint";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  openSearchPanel as openCodeMirrorSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
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
  runScopeHandlers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { cls, h, icon_svg } from "@/lib/dom";
import { muxy_cm_theme } from "@/lib/editor-theme";
import { muxy_highlight_style } from "@/lib/syntax-theme";
import { language_for } from "@/lib/languages";
import { tree_sitter_for } from "@/lib/tree-sitter";
import { tree_sitter_highlight } from "@/editor/tree-sitter-highlight";
import { linter_for } from "@/lib/linters";
import { read_cursor_state, write_cursor_state } from "@/lib/cursor-state";
import { gitGutterExtension, setGitBaseline } from "@/editor/git-gutter";
import { colorSwatchExtension } from "@/editor/color-swatch";
import { head_baseline } from "@/lib/git-baseline";

const replacePanelMode = new WeakMap();

function findPanelButton(name, label, onClick, attrs = {}) {
  return h(
    "button",
    {
      ...attrs,
      class: attrs.class ? `cm-button ${attrs.class}` : "cm-button",
      name,
      type: "button",
      onClick,
    },
    label,
  );
}

function closeIcon() {
  return icon_svg([
    { d: "M6 6l12 12" },
    { d: "M18 6L6 18" },
  ]);
}

function foldMarker(open) {
  const svg = icon_svg([{ d: "M6 9l6 6 6-6" }]);
  const wrap = h("span", { class: cls("cm-fold-marker", !open && "cm-fold-marker-closed") }, svg);
  wrap.setAttribute("title", open ? "Fold" : "Unfold");
  wrap.setAttribute("aria-hidden", "true");
  return wrap;
}

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

    return {
      get: (curEvent) => selectionFor(curEvent),
      update: () => {},
    };
  });
}

class FindPanel {
  constructor(view) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    this.canReplace = !view.state.readOnly;
    this.replaceVisible = this.canReplace && replacePanelMode.get(view) === true;
    this.searchField = h("input", {
      value: this.query.search,
      placeholder: "Find",
      "aria-label": "Find",
      class: "cm-textfield",
      name: "search",
      form: "",
      "main-field": "true",
      onInput: () => this.commit(),
      onChange: () => this.commit(),
    });
    this.caseField = h("input", {
      type: "checkbox",
      name: "case",
      form: "",
      checked: this.query.caseSensitive,
      onChange: () => this.commit(),
    });
    this.reField = h("input", {
      type: "checkbox",
      name: "re",
      form: "",
      checked: this.query.regexp,
      onChange: () => this.commit(),
    });
    this.wordField = h("input", {
      type: "checkbox",
      name: "word",
      form: "",
      checked: this.query.wholeWord,
      onChange: () => this.commit(),
    });
    this.replaceField = h("input", {
      value: this.query.replace,
      placeholder: "Replace",
      "aria-label": "Replace",
      class: "cm-textfield",
      name: "replace",
      form: "",
      onInput: () => this.commit(),
      onChange: () => this.commit(),
    });
    this.replaceToggle = findPanelButton(
      "toggle-replace",
      "Replace",
      () => this.setReplaceVisible(!this.replaceVisible, true),
      {
        "aria-expanded": String(this.replaceVisible),
      },
    );
    this.replaceToggle.classList.toggle("cm-button-active", this.replaceVisible);
    this.replaceRow = h(
      "div",
      { class: "cm-find-row cm-replace-row", hidden: !this.replaceVisible },
      this.replaceField,
      findPanelButton("replace", "Replace", () => replaceNext(view)),
      findPanelButton("replaceAll", "Replace All", () => replaceAll(view)),
    );

    this.dom = h(
      "div",
      { class: "cm-search cm-find-panel", onKeyDown: (event) => this.keydown(event) },
      h(
        "div",
        { class: "cm-find-row" },
        this.searchField,
        findPanelButton("next", "Next", () => findNext(view)),
        findPanelButton("prev", "Previous", () => findPrevious(view)),
        findPanelButton("select", "All", () => selectMatches(view)),
        this.canReplace && this.replaceToggle,
        h("label", {}, this.caseField, "match case"),
        h("label", {}, this.reField, "regexp"),
        h("label", {}, this.wordField, "by word"),
        h("button", {
          name: "close",
          "aria-label": "close",
          title: "Close",
          type: "button",
          onClick: () => closeSearchPanel(view),
        }, closeIcon()),
      ),
      this.canReplace && this.replaceRow,
    );
    this.dom.addEventListener("muxy-open-replace", () => this.setReplaceVisible(true, true));
  }

  commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.reField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  setReplaceVisible(visible, focus = false) {
    if (!this.canReplace) return;
    this.replaceVisible = visible;
    replacePanelMode.set(this.view, visible);
    this.replaceRow.hidden = !visible;
    this.replaceToggle.setAttribute("aria-expanded", String(visible));
    this.replaceToggle.classList.toggle("cm-button-active", visible);
    if (!focus) return;
    requestAnimationFrame(() => {
      const input = visible ? this.replaceField : this.searchField;
      input.focus();
      input.select();
    });
  }

  keydown(event) {
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
    } else if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(this.view);
    }
  }

  update(update) {
    const query = getSearchQuery(update.state);
    if (!query.eq(this.query)) this.setQuery(query);
  }

  setQuery(query) {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.reField.checked = query.regexp;
    this.wordField.checked = query.wholeWord;
  }

  mount() {
    const input = this.replaceVisible ? this.replaceField : this.searchField;
    input.focus();
    input.select();
  }

  get pos() {
    return 80;
  }

  get top() {
    return true;
  }
}

export class CodeEditor {
  constructor({ parent, filePath, value, isDark, config, initialPosition, onDirty, onSave }) {
    this.parent = parent;
    this.filePath = filePath;
    this.value = value;
    this.isDark = isDark;
    this.config = config;
    this.onDirty = onDirty;
    this.onSave = onSave;
    this.destroyed = false;
    this.cursorSaveTimer = 0;
    this.languageLoadId = 0;
    this.languageCompartment = new Compartment();
    this.lintCompartment = new Compartment();
    this.configCompartment = new Compartment();

    this.container = h("div", { class: "editor-host" });
    this.parent.replaceChildren(this.container);

    const initialSelection = this.selectionFromPosition(value, initialPosition);
    const saved = initialSelection ? null : read_cursor_state(filePath);
    const selection =
      initialSelection ??
      (saved && saved.anchor <= value.length && saved.head <= value.length
        ? { anchor: saved.anchor, head: saved.head }
        : undefined);
    this.savedScrollTop = initialSelection ? 0 : (saved?.scrollTop ?? 0);

    this.view = new EditorView({
      parent: this.container,
      state: EditorState.create({
        doc: value,
        selection,
        extensions: [
          this.configCompartment.of(this.configExtensions(config, isDark)),
          this.languageCompartment.of([]),
          this.lintCompartment.of([]),
          gitGutterExtension(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.value = update.state.doc.toString();
              this.onDirty();
            }
            if (update.docChanged || update.selectionSet) this.scheduleCursorSave();
          }),
          EditorView.domEventHandlers({
            scroll: () => this.scheduleCursorSave(),
          }),
        ],
      }),
    });

    if (initialSelection) this.revealInitialSelection(initialSelection.anchor);
    else this.restoreScroll();

    this.keyHandler = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      const isFindKey = event.key.toLowerCase() === "f" || event.code === "KeyF";
      const isReplaceKey = !event.altKey && (event.key.toLowerCase() === "r" || event.code === "KeyR");
      if (!isFindKey && !isReplaceKey) return;
      if (!this.view) return;
      event.preventDefault();
      event.stopPropagation();
      if (isReplaceKey) this.openReplace();
      else this.openSearch();
    };
    window.addEventListener("keydown", this.keyHandler, true);
    this.loadLanguage(filePath);
    this.loadLinter();
    this.loadGitBaseline(filePath);
    this.gitBaselineDisposer = muxy.events.subscribe("file.changed", () => this.loadGitBaseline(filePath));
  }

  selectionFromPosition(value, position) {
    if (!position) return null;
    const targetLine = Math.max(1, position.line);
    const targetColumn = Math.max(1, position.column ?? 1);
    const lines = value.split("\n");
    const lineIndex = Math.min(targetLine, lines.length) - 1;
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      offset += lines[index].length + 1;
    }
    offset += Math.min(targetColumn - 1, lines[lineIndex]?.length ?? 0);
    return { anchor: Math.min(offset, value.length), head: Math.min(offset, value.length) };
  }

  revealInitialSelection(pos) {
    if (!this.view) return;
    this.view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }

  async loadGitBaseline(filePath) {
    const baseline = await head_baseline(filePath);
    if (this.destroyed || !this.view) return;
    this.view.dispatch({ effects: setGitBaseline.of(baseline) });
  }

  restoreScroll() {
    if (!this.savedScrollTop || !this.view) return;
    this.view.requestMeasure({
      read: () => {},
      write: () => {
        if (this.view) this.view.scrollDOM.scrollTop = this.savedScrollTop;
      },
    });
  }

  scheduleCursorSave() {
    if (this.destroyed) return;
    if (this.cursorSaveTimer) return;
    this.cursorSaveTimer = window.setTimeout(() => {
      this.cursorSaveTimer = 0;
      this.saveCursorState();
    }, 400);
  }

  saveCursorState() {
    if (!this.view) return;
    const { anchor, head } = this.view.state.selection.main;
    write_cursor_state(this.filePath, {
      anchor,
      head,
      scrollTop: this.view.scrollDOM.scrollTop,
    });
  }

  configExtensions(config, isDark) {
    const extensions = [
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void this.onSave();
              return true;
            },
          },
          {
            key: "Mod-f",
            preventDefault: true,
            run: () => {
              this.openSearch();
              return true;
            },
          },
          {
            key: "Mod-r",
            preventDefault: true,
            run: () => {
              this.openReplace();
              return true;
            },
          },
          {
            key: "Mod-Alt-g",
            preventDefault: true,
            run: gotoLine,
          },
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
        ".cm-content": { fontFamily: '"SF Mono", Menlo, monospace' },
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
      keymaps.push(...completionKeymap);
      keymaps.push({ key: "Ctrl-Space", preventDefault: true, run: startCompletion });
    }
    if (config.codeFolding !== false) {
      extensions.push(codeFolding(), foldGutter({ markerDOM: (open) => foldMarker(open) }));
      keymaps.push(...foldKeymap);
    }
    if (config.linting !== false) keymaps.push(...lintKeymap);

    keymaps.push({
      key: "Tab",
      preventDefault: true,
      run: (view) => {
        if (config.autocomplete !== false && completionStatus(view.state) === "active") {
          return acceptCompletion(view);
        }
        if (view.state.selection.ranges.some((range) => !range.empty)) {
          return indentMore(view);
        }
        return this.insertIndentAtCursor(view);
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

  insertIndentAtCursor(view) {
    const tabSize = view.state.tabSize;
    const changes = view.state.changeByRange((range) => {
      const col = range.head - view.state.doc.lineAt(range.head).from;
      const count = tabSize - (col % tabSize);
      const insert = " ".repeat(count);
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + count),
      };
    });
    view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  }

  async loadLanguage(filePath) {
    const loadId = ++this.languageLoadId;
    const [lang, treeSitter] = await Promise.all([
      language_for(filePath),
      this.config.treeSitter !== false ? tree_sitter_for(filePath).catch(() => null) : Promise.resolve(null),
    ]);
    if (this.destroyed || loadId !== this.languageLoadId) return;
    const extensions = lang ? [lang] : [];
    extensions.push(treeSitter ? tree_sitter_highlight(treeSitter) : muxy_highlight_style());
    this.view.dispatch({
      effects: this.languageCompartment.reconfigure(extensions),
    });
  }

  lintExtension() {
    if (this.config.linting === false) return [];
    const lint = linter_for(this.filePath);
    return lint ? [lint, lintGutter()] : [];
  }

  loadLinter() {
    if (this.destroyed || !this.view) return;
    this.view.dispatch({
      effects: this.lintCompartment.reconfigure(this.lintExtension()),
    });
  }

  updateConfig(config, isDark) {
    const treeSitterChanged = (this.config.treeSitter !== false) !== (config.treeSitter !== false);
    this.config = config;
    this.isDark = isDark;
    if (!this.view) return;
    this.view.dispatch({
      effects: [
        this.configCompartment.reconfigure(this.configExtensions(config, isDark)),
        this.lintCompartment.reconfigure(this.lintExtension()),
      ],
    });
    if (treeSitterChanged) this.loadLanguage(this.filePath);
  }

  getValue() {
    return this.value;
  }

  focus() {
    this.view?.focus();
  }

  openSearch() {
    this.openSearchPanel(false);
  }

  openReplace() {
    this.openSearchPanel(true);
  }

  openSearchPanel(showReplace) {
    if (!this.view) return;
    replacePanelMode.set(this.view, showReplace);
    openCodeMirrorSearchPanel(this.view);
    requestAnimationFrame(() => {
      const panel = this.view?.dom.querySelector(".cm-find-panel");
      if (showReplace) panel?.dispatchEvent(new CustomEvent("muxy-open-replace"));
      const selector = showReplace ? ".cm-search input[name='replace']" : ".cm-search [main-field]";
      const input = this.view?.dom.querySelector(selector);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    });
  }

  destroy() {
    if (this.cursorSaveTimer) {
      window.clearTimeout(this.cursorSaveTimer);
      this.cursorSaveTimer = 0;
    }
    if (this.view) this.saveCursorState();
    this.destroyed = true;
    this.gitBaselineDisposer?.();
    this.gitBaselineDisposer = null;
    window.removeEventListener("keydown", this.keyHandler, true);
    this.view?.destroy();
    this.view = null;
  }
}
