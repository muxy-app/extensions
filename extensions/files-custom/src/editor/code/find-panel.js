import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { runScopeHandlers } from "@codemirror/view";
import { h, icon_svg } from "@/shared/dom";

// Find/replace panel styled like the rest of Muxy, replacing CodeMirror's
// default. The replace row is shown or hidden per editor view.
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

export class FindPanel {
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
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
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
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
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

/** Opens the panel focused on the find field, or on replace. */
export function open_find_panel(view, showReplace) {
  replacePanelMode.set(view, showReplace);
  openSearchPanel(view);
  requestAnimationFrame(() => {
    const panel = view.dom.querySelector(".cm-find-panel");
    if (showReplace) panel?.dispatchEvent(new CustomEvent("muxy-open-replace"));
    const selector = showReplace ? ".cm-search input[name='replace']" : ".cm-search [main-field]";
    const input = view.dom.querySelector(selector);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
}
