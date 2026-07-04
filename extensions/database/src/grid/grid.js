import { h, clear } from "../lib/dom.js";

const MAX_CELL_CHARS = 400;

export function renderGrid(container, result, opts = {}) {
    clear(container);
    if (!result.columns.length) {
        container.appendChild(h("div", { class: "flex h-full items-center justify-center text-muted-foreground" }, "No rows returned"));
        return;
    }
    const headerCells = result.columns.map((col) => {
        const sorted = opts.sort && opts.sort.column === col.name;
        const marker = sorted ? (opts.sort.dir === "desc" ? " ▾" : " ▴") : "";
        return h("th", {
            onclick: opts.onSort ? () => opts.onSort(col.name) : null,
            title: col.type || col.name,
        }, `${col.name}${marker}`, col.type ? h("span", { class: "ml-[var(--s2)] font-normal text-muted-foreground" }, col.type.toLowerCase()) : null);
    });
    if (opts.gutter)
        headerCells.unshift(h("th", { class: "gutter" }, ""));
    const thead = h("thead", null, h("tr", null, headerCells));

    const tbody = h("tbody");
    for (let r = 0; r < result.rows.length; r++) {
        const tr = h("tr", opts.onRowClick ? { onclick: () => opts.onRowClick(r) } : null);
        if (opts.gutter) {
            tr.appendChild(h("td", {
                class: "gutter",
                title: opts.onGutter ? "Click to mark for deletion" : null,
                onclick: opts.onGutter ? () => opts.onGutter(r, tr) : null,
            }, String(r + 1)));
        }
        for (let c = 0; c < result.columns.length; c++) {
            const td = renderCell(result.rows[r][c]);
            if (opts.onCell)
                opts.onCell(td, r, c);
            tr.appendChild(td);
        }
        if (opts.decorateRow)
            opts.decorateRow(tr, r);
        tbody.appendChild(tr);
    }

    const table = h("table", { class: "grid-table" }, thead, tbody);
    const wrap = h("div", { class: "grid-wrap" }, table);
    container.appendChild(wrap);
    return { table, tbody };
}

export function renderCell(value) {
    if (value === null)
        return h("td", null, h("span", { class: "null-badge" }, "NULL"));
    const text = String(value);
    const display = text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) + "…" : text;
    return h("td", { title: text.length > 60 ? text.slice(0, 1000) : null }, display);
}
