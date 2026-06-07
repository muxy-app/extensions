import { append, cls, formatNumber, h, middleTruncate } from "@/lib/dom";
import { icon } from "@/lib/icons";
const BADGE_COLOR = {
    A: "text-diff-add",
    D: "text-diff-remove",
    M: "text-primary",
    R: "text-primary",
    U: "text-diff-add",
    "?": "text-diff-add",
};
const BADGE_TITLE = {
    M: "Modified",
    A: "Added",
    D: "Deleted",
    R: "Renamed",
    C: "Copied",
    T: "Type changed",
    U: "Conflicted",
    "?": "Untracked",
};
const FILE_COLOR = {
    A: "text-diff-add",
    D: "text-diff-remove",
    M: "text-primary",
    R: "text-primary",
    U: "text-diff-add",
};
export function iconButton(title, iconName, onClick, extra = "", disabled = false, tone = "default") {
    return h("button", {
        type: "button",
        title,
        disabled,
        class: cls("flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40", tone === "danger" ? "hover:text-diff-remove" : "hover:text-foreground", extra),
        onclick: (event) => onClick(event),
    }, icon(iconName, 13, "", 2));
}
export function smallIconButton(title, iconName, onClick, extra = "", disabled = false) {
    return h("button", {
        type: "button",
        title,
        disabled,
        class: cls("flex size-[18px] shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40", extra),
        onclick: (event) => onClick(event),
    }, icon(iconName, 12, "", 2.2));
}
export function button(label, opts) {
    const variant = opts.variant ?? "default";
    const height = opts.size === "md" ? "h-8" : "h-7";
    const variants = {
        default: "bg-primary text-primary-foreground hover:opacity-95",
        secondary: "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
        outline: "border border-border bg-muted text-foreground hover:border-primary hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
    };
    return h("button", {
        type: "button",
        disabled: opts.disabled,
        class: cls(`flex ${height} items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50`, variants[variant], opts.className),
        onclick: (event) => opts.onClick(event),
    }, opts.loading
        ? icon("loader", 11, "animate-spin", 2.4)
        : opts.iconName
            ? icon(opts.iconName, 11, "", 2.5)
            : null, label);
}
export function input(value, placeholder, onInput, className = "", focusKey = null) {
    return h("input", {
        value,
        placeholder,
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
        "data-focus-key": focusKey,
        class: cls("flex h-8 w-full rounded-md border border-input bg-secondary px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary", className),
        oninput: (event) => onInput(event.target.value),
    });
}
export function textarea(value, placeholder, rows, onInput, className = "", focusKey = null) {
    return h("textarea", {
        rows,
        placeholder,
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
        "data-focus-key": focusKey,
        class: cls("flex w-full resize-none rounded-md border border-input bg-secondary px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary", className),
        oninput: (event) => onInput(event.target.value),
    }, value);
}
export function emptyState(...children) {
    return h("div", { class: "flex flex-col items-center gap-3 px-4 py-7 text-center text-muted-foreground" }, children);
}
export function centered(...children) {
    return h("div", { class: "flex h-full flex-col items-center justify-center gap-2 p-4 text-[11px] text-muted-foreground" }, children);
}
export function loadingOverlay(label = "Loading...") {
    return h("div", { class: "absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[1px]" }, h("span", { class: "flex items-center gap-2 text-[12px] text-muted-foreground" }, icon("loader", 16, "animate-spin", 2), label));
}
export function statusBadge(label) {
    return h("span", {
        title: BADGE_TITLE[label] ?? label,
        class: cls("w-3.5 shrink-0 text-center font-mono text-[11px] font-bold leading-none", BADGE_COLOR[label] ?? "text-muted-foreground"),
    }, label === "?" ? "U" : label);
}
export function diffStat(added, removed) {
    if (added === null && removed === null)
        return null;
    return h("span", { class: "flex shrink-0 items-center gap-2 font-mono text-[12px] font-semibold tabular-nums" }, added !== null ? h("span", { class: "text-diff-add" }, `+${formatNumber(added)}`) : null, removed !== null ? h("span", { class: "text-diff-remove" }, `-${formatNumber(removed)}`) : null);
}
export function fileRow(entry, opts) {
    const row = h("li", {
        class: cls("group flex h-[34px] cursor-pointer items-center gap-2 pl-2.5 pr-2.5 hover:bg-accent", opts.active && "bg-accent"),
        onclick: () => opts.onOpen(entry.path),
    }, statusBadge(entry.label), icon("file", 11, cls("shrink-0", FILE_COLOR[entry.label] ?? "text-muted-foreground"), 1.5), h("span", {
        class: "min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foreground",
        title: entry.path,
    }, middleTruncate(entry.path)));
    if (opts.onDiscard) {
        append(row, [
            smallIconButton("Discard changes", "undo", (event) => {
                event.stopPropagation();
                opts.onDiscard?.(entry.path);
            }, "hidden group-hover:flex"),
        ]);
    }
    if (opts.onAction) {
        append(row, [
            smallIconButton(opts.staged ? "Unstage" : "Stage", opts.staged ? "minus" : "plus", (event) => {
                event.stopPropagation();
                opts.onAction?.(entry.path);
            }, "hidden group-hover:flex"),
        ]);
    }
    const stat = diffStat(entry.added, entry.removed);
    if (stat)
        append(row, [stat]);
    return row;
}
export function openFloating(anchor, content, opts = {}) {
    if (activeFloating?.anchor === anchor) {
        activeFloating.close();
        return () => undefined;
    }
    closeFloating();
    const frame = h("div", { class: "floating-menu" }, content);
    document.body.appendChild(frame);
    const rect = anchor.getBoundingClientRect();
    const width = opts.width ?? Math.max(rect.width, 176);
    const left = opts.align === "end"
        ? Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width))
        : Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
    const top = Math.min(window.innerHeight - 8, rect.bottom + 4);
    frame.style.width = `${width}px`;
    frame.style.left = `${left}px`;
    frame.style.top = `${top}px`;
    const close = () => {
        frame.remove();
        document.removeEventListener("pointerdown", onPointer);
        window.removeEventListener("keydown", onKey);
        if (activeFloating?.close === close)
            activeFloating = null;
    };
    const onPointer = (event) => {
        if (!frame.contains(event.target) && !anchor.contains(event.target))
            close();
    };
    const onKey = (event) => {
        if (event.key === "Escape")
            close();
    };
    activeFloating = { anchor, close };
    setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    window.addEventListener("keydown", onKey);
    return close;
}
let activeFloating = null;
export function closeFloating() {
    activeFloating?.close();
    activeFloating = null;
}
export function menuItem(label, iconName, onClick, opts = {}) {
    return h("button", {
        type: "button",
        disabled: opts.disabled,
        class: cls("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground outline-none hover:bg-accent disabled:pointer-events-none disabled:opacity-40", opts.danger && "hover:text-diff-remove"),
        onclick: () => onClick(),
    }, opts.loading
        ? icon("loader", 13, "animate-spin text-muted-foreground", 2)
        : iconName
            ? icon(iconName, 13, "text-muted-foreground", 2)
            : null, h("span", { class: "min-w-0 flex-1 truncate" }, label), opts.active ? icon("check", 13, "text-primary", 2.5) : null);
}
