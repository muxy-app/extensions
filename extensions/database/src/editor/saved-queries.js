import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { getSavedQueries, setSavedQueries } from "../lib/storage.js";

export function renderSavedPanel(session, { onPick, getCurrentSql }) {
    const list = h("div", { class: "flex-1 overflow-y-auto" });
    const panel = h("div", { class: "flex h-full flex-col" },
        h("div", { class: "flex items-center gap-[var(--s3)] border-b px-[var(--s5)] py-[var(--s3)]", style: "border-color: var(--muxy-border)" },
            icon("star", 12),
            h("span", { class: "section-label" }, "Saved"),
            h("div", { class: "flex-1" }),
            h("button", {
                class: "icon-btn",
                title: "Save current query",
                onclick: async () => {
                    const sql = getCurrentSql().trim();
                    if (!sql) {
                        toast("Nothing to save", "warning");
                        return;
                    }
                    const name = await muxy.dialog.prompt({ title: "Save query", message: "Name for this query", placeholder: "e.g. Active users" });
                    if (!name)
                        return;
                    const all = await getSavedQueries();
                    all.push({ id: `q-${Date.now().toString(36)}`, name, connId: session.conn.id, sql, createdAt: Date.now(), updatedAt: Date.now() });
                    await setSavedQueries(all);
                    panel.refresh();
                },
            }, icon("plus", 12))),
        list);

    panel.refresh = async () => {
        clear(list);
        const all = await getSavedQueries();
        const mine = all.filter((q) => !q.connId || q.connId === session.conn.id);
        if (!mine.length) {
            list.appendChild(h("div", { class: "px-[var(--s5)] py-[var(--s5)] text-muted-foreground" }, "No saved queries"));
            return;
        }
        for (const entry of mine) {
            list.appendChild(h("div", { class: "tree-row group", style: "height: auto; padding-top: var(--s2); padding-bottom: var(--s2)", onclick: () => onPick(entry.sql) },
                h("div", { class: "min-w-0 flex-1" },
                    h("div", { class: "truncate text-[var(--font-body)] font-semibold" }, entry.name),
                    h("div", { class: "mono truncate text-[var(--font-caption)] text-muted-foreground" }, entry.sql.replace(/\s+/g, " ").slice(0, 80))),
                h("button", {
                    class: "icon-btn hidden group-hover:flex",
                    title: "Delete saved query",
                    onclick: async (e) => {
                        e.stopPropagation();
                        const all2 = await getSavedQueries();
                        await setSavedQueries(all2.filter((q) => q.id !== entry.id));
                        panel.refresh();
                    },
                }, icon("trash", 12))));
        }
    };
    panel.refresh();
    return panel;
}
