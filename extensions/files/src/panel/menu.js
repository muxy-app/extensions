// A context menu drawn to read like a native macOS menu: highlight follows the
// pointer and the arrow keys, Return activates, Escape / outside click / losing
// focus dismisses. The host has no native menu API for extension pages.

import { cls, h } from "@/shared/dom";

/** @typedef {{ label: string, run: () => void, danger?: boolean, disabled?: boolean, hint?: string } | "-"} MenuItem */

let current = null;

export function close_menu() {
  current?.close();
}

/**
 * Opens a menu at client coordinates. `onClose(restoreFocus)` runs once when
 * it goes away.
 * @param {MenuItem[]} items
 */
export function open_menu(items, x, y, onClose = () => {}) {
  close_menu();
  const buttons = [];
  const nodes = [];
  let lastWasSeparator = true;
  for (const item of items) {
    if (item === "-") {
      if (!lastWasSeparator) nodes.push(h("div", { class: "menu-separator", role: "separator" }));
      lastWasSeparator = true;
      continue;
    }
    const button = h(
      "button",
      {
        type: "button",
        role: "menuitem",
        class: cls("menu-item", item.danger && "menu-item-danger"),
        disabled: item.disabled ? true : null,
        tabindex: "-1",
      },
      h("span", { class: "menu-label" }, item.label),
      item.hint ? h("span", { class: "menu-hint" }, item.hint) : null,
    );
    button._run = item.run;
    if (!item.disabled) buttons.push(button);
    nodes.push(button);
    lastWasSeparator = false;
  }
  if (nodes.at(-1)?.classList.contains("menu-separator")) nodes.pop();

  const menu = h("div", { class: "menu", role: "menu" }, nodes);
  document.body.appendChild(menu);
  const margin = 6;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(margin, Math.min(x, innerWidth - rect.width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(y, innerHeight - rect.height - margin))}px`;

  let active = -1;
  const highlight = (index) => {
    buttons[active]?.classList.remove("menu-item-active");
    active = index;
    buttons[active]?.classList.add("menu-item-active");
  };
  const activate = (button) => {
    if (!button || button.disabled) return;
    state.close(false);
    button._run();
  };

  const onPointerDown = (event) => {
    if (!menu.contains(event.target)) state.close(false);
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      state.close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (buttons.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlight(active === -1 ? (step > 0 ? 0 : buttons.length - 1) : (active + step + buttons.length) % buttons.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active !== -1) activate(buttons[active]);
    }
    event.stopPropagation();
  };
  const onBlur = () => state.close(false);

  menu.addEventListener("pointermove", (event) => {
    const button = event.target.closest?.(".menu-item");
    const index = buttons.indexOf(button);
    if (index !== active) highlight(index);
  });
  menu.addEventListener("pointerleave", () => highlight(-1));
  menu.addEventListener("click", (event) => activate(event.target.closest?.(".menu-item")));
  menu.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onBlur);

  const state = {
    close(restoreFocus) {
      if (current !== state) return;
      current = null;
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      menu.remove();
      onClose(restoreFocus);
    },
  };
  current = state;
  return state;
}

export function menu_open() {
  return current !== null;
}
