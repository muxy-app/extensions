import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";

export function renderSidebar(session, { onSelect, onNewTable, onTransfer }) {
    const filter = h("input", { type: "text", placeholder: "Filter tables", class: "flex-1", oninput: () => renderRows() });
    const list = h("div", { class: "flex-1 overflow-y-auto py-[var(--s2)]" });
    const footer = h("div", { class: "border-t px-[var(--s5)] py-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground", style: "border-color: var(--muxy-border)" });

    const canCreate = session.conn.engine !== "sqlite" ? true : true;
    const toolbar = h("div", { class: "flex items-center gap-[var(--s3)] p-[var(--s4)]" },
        filter,
        onNewTable ? h("button", { class: "icon-btn", title: "New table", onclick: onNewTable }, icon("plus")) : null,
        onTransfer ? h("button", { class: "icon-btn", title: "Import / Export", onclick: onTransfer }, icon("download")) : null);

    const sidebar = h("div", { class: "flex w-56 flex-shrink-0 flex-col border-r", style: "border-color: var(--muxy-border)" },
        toolbar,
        list,
        footer);

    function renderRows() {
        clear(list);
        const term = filter.value.trim().toLowerCase();
        const tables = session.tables.filter((t) => !term || t.name.toLowerCase().includes(term));
        for (const table of tables) {
            const active = session.ref && session.ref.table === table.name;
            const row = h("div", {
                class: `tree-row ${active ? "active" : ""}`,
                onclick: () => onSelect({ table: table.name, kind: table.kind, database: session.ctx.database, schema: session.ctx.schema }),
            },
                icon(table.kind === "view" ? "eye" : "table", 12),
                h("span", { class: "truncate" }, table.name));
            list.appendChild(row);
        }
        const tableCount = session.tables.filter((t) => t.kind === "table").length;
        const viewCount = session.tables.length - tableCount;
        footer.textContent = `${tableCount} tables${viewCount ? ` · ${viewCount} views` : ""}`;
        if (!tables.length)
            list.appendChild(h("div", { class: "px-[var(--s5)] py-[var(--s4)] text-muted-foreground" }, term ? "No matches" : "No tables"));
    }

    sidebar.refresh = renderRows;
    renderRows();
    return sidebar;
}
