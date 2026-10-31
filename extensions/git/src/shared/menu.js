import { cls, h } from "@/shared/dom";

let current = null;

export function closeMenu() {
  current?.close(false);
}

export function menuOpen() {
  return current !== null;
}

function buildNodes(items) {
  const buttons = [];
  const nodes = [];
  let lastWasSeparator = true;
  for (const item of items) {
    if (!item) continue;
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
        class: cls("menu-item", item.danger && "menu-item-danger", item.checked && "menu-item-checked"),
        disabled: item.disabled ? true : null,
        tabindex: "-1",
      },
      h("span", { class: "menu-check" }, item.checked ? "✓" : ""),
      h("span", { class: "menu-label" }, item.label),
      item.hint ? h("span", { class: "menu-hint" }, item.hint) : null,
    );
    button._run = item.run;
    if (!item.disabled) buttons.push(button);
    nodes.push(button);
    lastWasSeparator = false;
  }
  if (nodes.at(-1)?.classList.contains("menu-separator")) nodes.pop();
  return { buttons, nodes };
}

export function openMenu(items, x, y, onClose = () => {}) {
  closeMenu();
  const { buttons, nodes } = buildNodes(items);
  if (nodes.length === 0) return null;
  const checkable = items.some((item) => item && item !== "-" && item.checked !== undefined);
  const menu = h("div", { class: cls("menu", checkable && "menu-checkable"), role: "menu" }, nodes);
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
    button._run?.();
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
    const index = buttons.indexOf(event.target.closest?.(".menu-item"));
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

export function openMenuBelow(anchor, items, align = "start") {
  const rect = anchor.getBoundingClientRect();
  const state = openMenu(items, rect.left, rect.bottom + 4);
  if (!state || align !== "end") return state;
  const menu = document.querySelector(".menu");
  const width = menu.getBoundingClientRect().width;
  menu.style.left = `${Math.max(6, rect.right - width)}px`;
  return state;
}
