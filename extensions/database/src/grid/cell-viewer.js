import { h } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { toast } from "../ui/toast.js";

function prettify(value) {
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object")
            return { text: JSON.stringify(parsed, null, 2), kind: "JSON" };
    }
    catch {
    }
    return { text: value, kind: "Text" };
}

export function openCellViewer(value) {
    if (value === null)
        value = "";
    const { text, kind } = prettify(String(value));
    const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
    const sheet = h("div", { class: "sheet", style: "width: 560px" },
        h("div", { class: "flex items-center gap-[var(--s4)] border-b px-[var(--s7)] py-[var(--s5)] text-[var(--font-title)] font-semibold", style: "border-color: var(--muxy-border)" },
            icon("eye", 16), `Cell (${kind}, ${String(value).length} chars)`,
            h("div", { class: "flex-1" }),
            h("button", {
                class: "icon-btn",
                title: "Copy",
                onclick: () => {
                    copyToClipboard(String(value));
                    toast("Copied");
                },
            }, icon("copy", 12)),
            h("button", { class: "icon-btn", onclick: () => backdrop.remove() }, icon("x"))),
        h("pre", { class: "mono sheet-body", style: "white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-body)" }, text));
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
}
