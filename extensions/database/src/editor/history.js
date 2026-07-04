import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { getHistory, clearHistory } from "../lib/storage.js";

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60)
        return "just now";
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400)
        return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export function renderHistoryPanel(session, { onPick }) {
    const list = h("div", { class: "flex-1 overflow-y-auto" });
    const panel = h("div", { class: "flex w-72 flex-shrink-0 flex-col border-l", style: "border-color: var(--muxy-border)" },
        h("div", { class: "flex items-center gap-[var(--s3)] border-b px-[var(--s5)] py-[var(--s3)]", style: "border-color: var(--muxy-border)" },
            icon("clock", 12),
            h("span", { class: "section-label" }, "History"),
            h("div", { class: "flex-1" }),
            h("button", {
                class: "icon-btn",
                title: "Clear history",
                onclick: async () => {
                    await clearHistory(session.conn.id);
                    panel.refresh();
                },
            }, icon("trash", 12))),
        list);

    panel.refresh = async () => {
        clear(list);
        const entries = await getHistory(session.conn.id);
        if (!entries.length) {
            list.appendChild(h("div", { class: "px-[var(--s5)] py-[var(--s5)] text-muted-foreground" }, "No queries yet"));
            return;
        }
        for (const entry of entries) {
            list.appendChild(h("div", { class: "tree-row", style: "height: auto; padding-top: var(--s2); padding-bottom: var(--s2)", onclick: () => onPick(entry.sql) },
                h("div", { class: "min-w-0 flex-1" },
                    h("div", { class: "mono truncate", title: entry.sql.slice(0, 500) }, entry.sql.replace(/\s+/g, " ").slice(0, 80)),
                    h("div", { class: "flex items-center gap-[var(--s3)] text-[var(--font-caption)] text-muted-foreground" },
                        h("span", { style: `color: var(${entry.ok ? "--muxy-diff-add" : "--muxy-diff-remove"})` }, entry.ok ? "✓" : "✕"),
                        timeAgo(entry.startedAt),
                        entry.durationMs != null ? `${entry.durationMs}ms` : null))));
        }
    };
    panel.refresh();
    return panel;
}
