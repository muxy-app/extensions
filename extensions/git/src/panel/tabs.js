import { cls, h, setText, toggle } from "@/shared/dom";

export const TABS = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "prs", label: "Pull Requests" },
  { id: "runs", label: "Runs" },
];

export class Tabs {
  constructor(onSelect) {
    this.buttons = new Map();
    this.counts = new Map();
    this.el = h(
      "nav",
      { class: "tabs", role: "tablist" },
      TABS.map((tab) => {
        const count = h("span", { class: "tab-count" });
        const button = h("button", { type: "button", class: "tab", role: "tab", onclick: () => onSelect(tab.id) }, h("span", {}, tab.label), count);
        this.buttons.set(tab.id, button);
        this.counts.set(tab.id, count);
        return button;
      }),
    );
  }

  select(id) {
    for (const [tabId, button] of this.buttons) {
      button.className = cls("tab", tabId === id && "tab-on");
      button.setAttribute("aria-selected", String(tabId === id));
    }
  }

  setCount(id, value) {
    const node = this.counts.get(id);
    setText(node, value ? String(value) : "");
    toggle(node, !value);
  }

  setVisible(id, visible) {
    toggle(this.buttons.get(id), !visible);
  }
}
