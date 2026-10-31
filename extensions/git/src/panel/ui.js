import { cls, h } from "@/shared/dom";
import { icon } from "@/shared/icons";

export function iconButton(name, title, { action = null, onClick = null, small = false, className = "" } = {}) {
  return h(
    "button",
    {
      type: "button",
      class: cls("icon-btn", small && "icon-btn-sm", className),
      title,
      "aria-label": title,
      dataset: action ? { action } : null,
      onclick: onClick,
    },
    icon(name, small ? 13 : 14),
  );
}

export function button(label, { primary = false, iconName = null, onClick = null, className = "", title = null } = {}) {
  return h(
    "button",
    { type: "button", class: cls("btn", primary && "btn-primary", className), onclick: onClick, title },
    iconName ? icon(iconName, 13) : null,
    h("span", { class: "btn-label" }, label),
  );
}

export function placeholder(title, detail = "", ...actions) {
  return h(
    "div",
    { class: "placeholder" },
    h("div", { class: "placeholder-title" }, title),
    detail ? h("div", { class: "placeholder-detail" }, detail) : null,
    actions.length ? h("div", { class: "placeholder-actions" }, actions) : null,
  );
}

export function stat(additions, deletions) {
  if (additions === null && deletions === null) return null;
  return h(
    "span",
    { class: "stat" },
    additions ? h("span", { class: "text-add" }, `+${additions}`) : null,
    deletions ? h("span", { class: "text-remove" }, `−${deletions}`) : null,
  );
}

export function chips(options, value, onChange) {
  return h(
    "div",
    { class: "chips" },
    options.map((option) =>
      h(
        "button",
        {
          type: "button",
          class: cls("chip-btn", option.value === value && "chip-btn-on"),
          onclick: () => onChange(option.value),
        },
        option.label,
      ),
    ),
  );
}

export function spinner(size = 14) {
  return icon("loader", size, "spin");
}
