import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
  completionStatus,
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
import { linter_for } from "@/lib/linters";
import { read_cursor_state, write_cursor_state } from "@/lib/cursor-state";
import { gitGutterExtension, setGitBaseline } from "@/editor/git-gutter";
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

// Chevron used in the fold gutter: points down when the section is open
// (click to fold), right when folded (click to unfold).
function foldMarker(open) {
  const svg = icon_svg([{ d: "M6 9l6 6 6-6" }]);
  const wrap = h("span", { class: cls("cm-fold-marker", !open && "cm-fold-marker-closed") }, svg);
  wrap.setAttribute("title", open ? "Fold" : "Unfold");
  wrap.setAttribute("aria-hidden", "true");
  return wrap;
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
  constructor({ parent, filePath, value, isDark, config, onDirty, onSave }) {
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

    const saved = read_cursor_state(filePath);
    // Clamp the saved selection to the current doc — the file may have shrunk on
    // disk since we last saw it.
    const selection =
      saved && saved.anchor <= value.length && saved.head <= value.length
        ? { anchor: saved.anchor, head: saved.head }
        : undefined;
    this.savedScrollTop = saved?.scrollTop ?? 0;

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

    this.restoreScroll();

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

  async loadGitBaseline(filePath) {
    const baseline = await head_baseline(filePath);
    if (this.destroyed || !this.view) return;
    this.view.dispatch({ effects: setGitBaseline.of(baseline) });
  }

  // Restore the saved scroll position once the view has laid out. requestMeasure
  // runs after the initial render so scrollDOM has its real scrollHeight.
  restoreScroll() {
    if (!this.savedScrollTop || !this.view) return;
    this.view.requestMeasure({
      read: () => {},
      write: () => {
        if (this.view) this.view.scrollDOM.scrollTop = this.savedScrollTop;
      },
    });
  }

  // Debounce cursor/scroll writes so rapid typing or scrolling doesn't hammer
  // localStorage — we only need the latest position.
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
          // Go to line. searchKeymap already binds this to Mod-Alt-g (and keeps
          // Mod-g as find-next, the macOS convention); we re-bind at highest
          // precedence so it can't be shadowed and works even when find is open.
          {
            key: "Mod-Alt-g",
            preventDefault: true,
            run: gotoLine,
          },
        ]),
      ),
      history(),
      drawSelection(),
      // Triple-click selects the line content only, excluding the trailing
      // newline. CodeMirror's default extends the selection to the start of
      // the next line, which makes drawSelection paint a sliver on the row
      // below so the next line appears (but isn't) selected.
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (event.detail < 3 || event.button !== 0) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          view.dispatch({
            selection: EditorSelection.range(line.from, line.to),
          });
          event.preventDefault();
          return true;
        },
      }),
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
      muxy_highlight_style(),
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
        autocompletion({ defaultKeymap: false, icons: false, activateOnTyping: true }),
        // Document-word completion as a baseline for every language (and for
        // plain text / grammars with no completion source of their own). The
        // active language's source — keywords, scope identifiers, CSS props,
        // etc. — is merged on top and ranks above these via its own boost.
        EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
      );
      keymaps.push(...completionKeymap);
    }
    if (config.codeFolding !== false) {
      extensions.push(codeFolding(), foldGutter({ markerDOM: (open) => foldMarker(open) }));
      keymaps.push(...foldKeymap);
    }
    if (config.linting !== false) keymaps.push(...lintKeymap);

    // Tab behavior. CodeMirror leaves Tab unbound by default so it can move
    // focus out of the editor (an a11y choice); we opt in:
    //   - autocomplete popup open  -> accept the highlighted suggestion
    //   - non-empty selection      -> indent the selected block (indentMore)
    //   - cursor only              -> insert spaces to the next tab stop
    // Shift-Tab dedents the line/selection.
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
    return extensions;
  }

  // Insert spaces at each cursor up to the next tab stop, so Tab aligns to
  // columns (e.g. at column 2 with tabSize 4 it inserts 2 spaces, not 4) instead
  // of indenting the whole line the way indentMore would.
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
    const lang = await language_for(filePath);
    if (this.destroyed || loadId !== this.languageLoadId) return;
    this.view.dispatch({
      effects: this.languageCompartment.reconfigure(lang ? [lang] : []),
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
    this.config = config;
    this.isDark = isDark;
    if (!this.view) return;
    this.view.dispatch({
      effects: [
        this.configCompartment.reconfigure(this.configExtensions(config, isDark)),
        this.lintCompartment.reconfigure(this.lintExtension()),
      ],
    });
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
    // Flush the final position while the view still exists — destroy() fires on
    // every reopen / markdown mode switch, so this is the main save point.
    if (this.view) this.saveCursorState();
    this.destroyed = true;
    this.gitBaselineDisposer?.();
    this.gitBaselineDisposer = null;
    window.removeEventListener("keydown", this.keyHandler, true);
    this.view?.destroy();
    this.view = null;
  }
}
