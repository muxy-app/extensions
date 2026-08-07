import { h } from "@/lib/dom";
import { icon } from "@/lib/icons";

export function shortcut(keys, label) {
    return h("span", { class: "pr-shortcut" }, h("kbd", {}, keys), h("span", {}, label));
}

export function shortcuts(items) {
    return h("div", { class: "pr-shortcuts" }, items.map(([keys, label]) => shortcut(keys, label)));
}

export function heading(title, subtitle, iconName = "pr", back) {
    return h("header", { class: "pr-heading" }, back
        ? h("button", { type: "button", class: "pr-back", "aria-label": "Back", onclick: back }, icon("chevronRight", 13, "", 2))
        : h("span", { class: "pr-mark" }, icon(iconName, 14, "", 2)), h("div", { class: "pr-heading-copy" }, h("h1", {}, title), h("p", {}, subtitle)));
}

export function footer(label, items) {
    return h("footer", { class: "pr-footer" }, h("span", { class: "pr-footer-label", "aria-live": "polite" }, label), shortcuts(items));
}

export function message(text, iconName, retry) {
    return h("div", { class: "pr-message" }, icon(iconName, 16, iconName === "loader" ? "pr-spinner" : "", 2), h("span", {}, text), retry
        ? h("button", { type: "button", onclick: retry }, "Retry")
        : null);
}

export function refreshBar(active, label) {
    if (!active)
        return null;
    return h("div", { class: "pr-refresh-bar", role: "status", "aria-label": label }, h("span", {}));
}
