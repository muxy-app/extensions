import { bracketMatching, indentUnit } from "@codemirror/language";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel as openCodeMirrorSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
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
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { h, icon_svg } from "@/lib/dom";
import { muxy_cm_theme } from "@/lib/editor-theme";
import { muxy_highlight_style } from "@/lib/syntax-theme";
import { language_for } from "@/lib/languages";

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
    this.languageLoadId = 0;
    this.languageCompartment = new Compartment();
    this.configCompartment = new Compartment();

    this.container = h("div", { class: "editor-host" });
    this.parent.replaceChildren(this.container);

    this.view = new EditorView({
      parent: this.container,
      state: EditorState.create({
        doc: value,
        extensions: [
          this.configCompartment.of(this.configExtensions(config, isDark)),
          this.languageCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.value = update.state.doc.toString();
            this.onDirty();
          }),
        ],
      }),
    });

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
        ]),
      ),
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      rectangularSelection(),
      bracketMatching(),
      search({ top: true, createPanel: (view) => new FindPanel(view) }),
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
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

    if (config.lineNumbers) extensions.push(lineNumbers());
    if (config.wordWrap) extensions.push(EditorView.lineWrapping);
    return extensions;
  }

  async loadLanguage(filePath) {
    const loadId = ++this.languageLoadId;
    const lang = await language_for(filePath);
    if (this.destroyed || loadId !== this.languageLoadId) return;
    this.view.dispatch({
      effects: this.languageCompartment.reconfigure(lang ? [lang] : []),
    });
  }

  updateConfig(config, isDark) {
    this.config = config;
    this.isDark = isDark;
    if (!this.view) return;
    this.view.dispatch({
      effects: this.configCompartment.reconfigure(this.configExtensions(config, isDark)),
    });
  }

  getValue() {
    return this.value;
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
    this.destroyed = true;
    window.removeEventListener("keydown", this.keyHandler, true);
    this.view?.destroy();
    this.view = null;
  }
}
