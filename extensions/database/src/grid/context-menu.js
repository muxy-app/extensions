import { h, clear } from "../lib/dom.js";

let current = null;

export function openContextMenu(x, y, items) {
    closeContextMenu();
    const menu = h("div", {
        class: "sheet",
        style: `position: fixed; width: auto; min-width: 180px; left: ${x}px; top: ${y}px; padding: var(--s2) 0; z-index: 60`,
    });
    for (const item of items) {
        if (item.separator) {
            menu.appendChild(h("div", { style: "height: 1px; margin: var(--s2) 0; background: var(--muxy-border)" }));
            continue;
        }
        menu.appendChild(h("button", {
            class: "tree-row w-full text-left",
            onclick: () => {
                closeContextMenu();
                item.onClick();
            },
        }, item.label));
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)
        menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight)
        menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    current = menu;
    setTimeout(() => {
        window.addEventListener("mousedown", onOutside, { once: true });
        window.addEventListener("scroll", closeContextMenu, { once: true, capture: true });
    }, 0);
}

function onOutside(event) {
    if (current && !current.contains(event.target))
        closeContextMenu();
}

export function closeContextMenu() {
    if (current) {
        clear(current);
        current.remove();
        current = null;
    }
}
