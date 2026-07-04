import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { buildSelect, buildCount } from "../lib/sql/select-builder.js";
import { buildChangeScript } from "../lib/sql/change-script.js";
import { tableInfo } from "../workbench/state.js";
import { renderGrid, renderCell } from "./grid.js";
import { renderPager } from "./pagination.js";
import { createChanges, isEditable, setEdit, getEdit, toggleDelete, isDeleted, addInsert, removeInsert, changeCount, clearChanges } from "./pending-changes.js";
import { openCellEditor } from "./cell-editor.js";
import { openCellViewer } from "./cell-viewer.js";
import { openContextMenu } from "./context-menu.js";
import { copyResult, exportResult } from "../transfer/transfer.js";
import { renderFilterBar } from "./filters.js";

function refKey(ref) {
    return `${ref.database || ""}.${ref.schema || ""}.${ref.table}`;
}

export function gridStateFor(session, ref) {
    const key = refKey(ref);
    if (!session.gridState.has(key))
        session.gridState.set(key, { page: 0, sort: null, filters: [], rawWhere: "", total: null });
    return session.gridState.get(key);
}

function changesFor(session, ref, info) {
    session.changes = session.changes || new Map();
    const key = refKey(ref);
    if (!session.changes.has(key))
        session.changes.set(key, createChanges(session.conn.engine, ref, info));
    return session.changes.get(key);
}

export function pendingChangeCount(session) {
    let total = 0;
    for (const changes of session.changes?.values() || [])
        total += changeCount(changes);
    return total;
}

export async function renderDataView(container, session, { setStatus }) {
    clear(container);
    if (!session.ref) {
        container.appendChild(h("div", { class: "flex h-full flex-col items-center justify-center gap-[var(--s4)] text-muted-foreground" },
            icon("table", 24),
            "Select a table to browse its data"));
        return;
    }
    const ref = session.ref;
    const state = gridStateFor(session, ref);
    const filterBar = h("div", { class: "flex flex-col gap-[var(--s2)] border-b px-[var(--s4)] py-[var(--s2)]", style: "border-color: var(--muxy-border)" });
    const banner = h("div");
    const gridArea = h("div", { class: "flex min-h-0 flex-1 flex-col" });
    const pendingBar = h("div");
    const pagerArea = h("div", { class: "flex items-center gap-[var(--s3)] border-t px-[var(--s4)] py-[var(--s2)]", style: "border-color: var(--muxy-border)" });
    container.append(filterBar, banner, gridArea, pendingBar, pagerArea);

    const reload = () => renderDataView(container, session, { setStatus });

    gridArea.appendChild(h("div", { class: "flex h-full items-center justify-center text-muted-foreground" }, "Loading…"));
    try {
        const info = await tableInfo(session, ref);
        const changes = changesFor(session, ref, info);
        const editable = ref.kind !== "view" && isEditable(changes);
        const useRowid = changes.keyColumns?.[0] === "__rowid";

        const sql = buildSelect(session.conn.engine, ref, {
            filters: state.filters,
            rawWhere: state.rawWhere,
            sort: state.sort,
            limit: session.pageSize,
            offset: state.page * session.pageSize,
            rowid: useRowid,
        });
        const started = performance.now();
        const results = await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
        const raw = results[0];

        const hiddenIndex = raw.columns.findIndex((c) => c.name === "__rowid");
        const displayColumns = raw.columns.filter((_, i) => i !== hiddenIndex);
        const typeByName = new Map(info.columns.map((c) => [c.name, c.type]));
        for (const col of displayColumns)
            col.type = typeByName.get(col.name) || "";
        const displayRows = raw.rows.map((row) => row.filter((_, i) => i !== hiddenIndex));

        renderFilterBar(filterBar, { columns: info.columns, state, onApply: reload });

        const keyIndexes = editable
            ? changes.keyColumns.map((kc) => (kc === "__rowid" ? hiddenIndex : raw.columns.findIndex((c) => c.name === kc)))
            : [];
        const keyValuesFor = (r) => keyIndexes.map((i) => raw.rows[r][i]);

        clear(banner);
        if (!editable && ref.kind !== "view")
            banner.appendChild(h("div", {
                class: "flex items-center gap-[var(--s3)] border-b px-[var(--s5)] py-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground",
                style: "border-color: var(--muxy-border)",
            }, icon("info", 12), "Read-only: this table has no primary key"));

        const rendered = renderGrid(gridArea, { columns: displayColumns, rows: displayRows }, {
            sort: state.sort,
            onSort: (column) => {
                if (!state.sort || state.sort.column !== column)
                    state.sort = { column, dir: "asc" };
                else if (state.sort.dir === "asc")
                    state.sort = { column, dir: "desc" };
                else
                    state.sort = null;
                state.page = 0;
                reload();
            },
            gutter: true,
            onGutter: editable
                ? (r, tr) => {
                    toggleDelete(changes, keyValuesFor(r));
                    tr.classList.toggle("row-deleted", isDeleted(changes, keyValuesFor(r)));
                    refreshPendingBar();
                }
                : null,
            onCell: (td, r, c) => {
                const column = displayColumns[c];
                const keyValues = editable ? keyValuesFor(r) : null;
                if (editable) {
                    const edit = getEdit(changes, keyValues, column.name);
                    if (edit.edited)
                        repaintCell(td, changes, keyValues, column.name, displayRows[r][c]);
                    td.addEventListener("dblclick", () => {
                        const current = getEdit(changes, keyValues, column.name);
                        const original = displayRows[r][c];
                        openCellEditor(td, {
                            type: column.type,
                            value: current.edited ? current.value : original,
                            nullable: true,
                            onCommit: (next) => {
                                if (next !== undefined)
                                    setEdit(changes, keyValues, column.name, normalizeInput(next), original);
                                repaintCell(td, changes, keyValues, column.name, original);
                                refreshPendingBar();
                            },
                        });
                    });
                }
                else {
                    td.addEventListener("dblclick", () => openCellViewer(displayRows[r][c]));
                }
                td.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    const value = displayRows[r][c];
                    const items = [
                        { label: "View cell", onClick: () => openCellViewer(value) },
                        { label: "Copy cell", onClick: () => copyText(value === null ? "" : String(value)) },
                        { label: "Copy row as JSON", onClick: () => copyResult(session.conn.engine, ref, { columns: displayColumns, rows: [displayRows[r]] }, "json") },
                        { label: "Copy row as INSERT", onClick: () => copyResult(session.conn.engine, ref, { columns: displayColumns, rows: [displayRows[r]] }, "sql") },
                    ];
                    if (editable) {
                        items.push({ separator: true });
                        items.push({
                            label: "Set NULL",
                            onClick: () => {
                                setEdit(changes, keyValuesFor(r), column.name, null, displayRows[r][c]);
                                repaintCell(td, changes, keyValuesFor(r), column.name, displayRows[r][c]);
                                refreshPendingBar();
                            },
                        });
                        items.push({
                            label: isDeleted(changes, keyValuesFor(r)) ? "Undelete row" : "Delete row",
                            onClick: () => {
                                toggleDelete(changes, keyValuesFor(r));
                                td.parentElement.classList.toggle("row-deleted", isDeleted(changes, keyValuesFor(r)));
                                refreshPendingBar();
                            },
                        });
                    }
                    openContextMenu(e.clientX, e.clientY, items);
                });
            },
            decorateRow: editable
                ? (tr, r) => {
                    if (isDeleted(changes, keyValuesFor(r)))
                        tr.classList.add("row-deleted");
                }
                : null,
        });

        if (editable && rendered)
            renderInsertRows(rendered.tbody, displayColumns, changes, refreshPendingBar);

        renderPager(pagerArea, { page: state.page, pageSize: session.pageSize, rowsOnPage: displayRows.length, total: state.total }, {
            onPage: (page) => {
                state.page = Math.max(0, page);
                reload();
            },
            onCount: async () => {
                const countResults = await session.driver.runQuery(session.ctx, buildCount(session.conn.engine, ref, state), { timeoutMs: session.timeoutMs });
                state.total = Number(countResults[0]?.rows?.[0]?.[0] ?? 0);
                reload();
            },
        });
        if (editable)
            pagerArea.appendChild(h("button", {
                class: "btn",
                style: "height: 22px; font-size: var(--font-footnote)",
                onclick: () => {
                    addInsert(changes);
                    renderInsertRows(rendered.tbody, displayColumns, changes, refreshPendingBar, true);
                    refreshPendingBar();
                },
            }, icon("plus", 10), "Row"));

        setStatus(`${ref.table} · ${displayRows.length} rows · ${Math.round(performance.now() - started)}ms`);

        function refreshPendingBar() {
            clear(pendingBar);
            const count = changeCount(changes);
            if (!count)
                return;
            pendingBar.appendChild(h("div", {
                class: "flex items-center gap-[var(--s4)] border-t px-[var(--s5)] py-[var(--s3)]",
                style: "border-color: var(--muxy-border); background: var(--muxy-accent-soft)",
            },
                h("span", { class: "text-[var(--font-emphasis)] font-semibold" }, `${count} pending change${count === 1 ? "" : "s"}`),
                h("div", { class: "flex-1" }),
                h("button", { class: "btn", onclick: () => openReview(false) }, "Review"),
                h("button", { class: "btn", onclick: () => discard() }, "Discard"),
                h("button", { class: "btn btn-primary", onclick: () => openReview(true) }, "Apply")));
        }

        function discard() {
            clearChanges(changes);
            reload();
        }

        function openReview(applyDirectly) {
            const statements = buildChangeScript(changes);
            if (!statements.length) {
                clearChanges(changes);
                refreshPendingBar();
                return;
            }
            if (applyDirectly)
                return apply(statements);
            const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
            const sheet = h("div", { class: "sheet", style: "width: 640px" },
                h("div", { class: "flex items-center gap-[var(--s4)] border-b px-[var(--s7)] py-[var(--s5)] text-[var(--font-title)] font-semibold", style: "border-color: var(--muxy-border)" },
                    icon("code", 16), "Review changes",
                    h("div", { class: "flex-1" }),
                    h("button", { class: "icon-btn", onclick: () => backdrop.remove() }, icon("x"))),
                h("pre", { class: "mono sheet-body", style: "font-size: var(--font-body); white-space: pre-wrap; overflow-wrap: anywhere" }, statements.join("\n")),
                h("div", { class: "sheet-footer" },
                    h("button", { class: "btn", onclick: () => backdrop.remove() }, "Cancel"),
                    h("button", { class: "btn btn-primary", onclick: () => { backdrop.remove(); apply(statements); } }, icon("check", 12), `Apply ${statements.length} statement${statements.length === 1 ? "" : "s"}`)));
            backdrop.appendChild(sheet);
            document.body.appendChild(backdrop);
        }

        async function apply(statements) {
            setStatus("Applying changes…");
            try {
                await session.driver.runScript(session.ctx, statements.join("\n"), { timeoutMs: session.timeoutMs });
                clearChanges(changes);
                state.total = null;
                toast(`Applied ${statements.length} statement${statements.length === 1 ? "" : "s"}`, "success");
                reload();
            }
            catch (error) {
                setStatus("Apply failed");
                clear(banner);
                banner.appendChild(h("div", { class: "p-[var(--s4)]" }, h("div", { class: "error-box" }, error.message)));
            }
        }

        refreshPendingBar();
    }
    catch (error) {
        clear(gridArea);
        gridArea.appendChild(h("div", { class: "p-[var(--s6)]" }, h("div", { class: "error-box" }, error.message)));
        setStatus("Error");
    }
}

async function copyText(text) {
    const { copyToClipboard } = await import("../lib/clipboard.js");
    await copyToClipboard(text);
    toast("Copied");
}

function normalizeInput(value) {
    if (value === null)
        return null;
    if (typeof value === "boolean")
        return value ? "1" : "0";
    return String(value);
}

function repaintCell(td, changes, keyValues, columnName, original) {
    const edit = getEdit(changes, keyValues, columnName);
    const value = edit.edited ? edit.value : original;
    const fresh = renderCell(value);
    clear(td);
    td.append(...fresh.childNodes);
    td.title = fresh.title || "";
    td.classList.toggle("cell-edited", edit.edited);
}

function renderInsertRows(tbody, displayColumns, changes, refreshPendingBar, focusLast = false) {
    for (const existing of tbody.querySelectorAll("tr.row-insert"))
        existing.remove();
    changes.inserts.forEach((insert, index) => {
        const tr = h("tr", { class: "row-insert" });
        const gutter = h("td", {
            class: "gutter",
            title: "Remove this new row",
            onclick: () => {
                removeInsert(changes, insert.id);
                tr.remove();
                refreshPendingBar();
            },
        }, "+");
        tr.appendChild(gutter);
        for (const column of displayColumns) {
            const td = h("td", { class: "mono" });
            paintInsertCell(td, insert, column);
            td.addEventListener("dblclick", () => {
                openCellEditor(td, {
                    type: column.type,
                    value: insert.cells.has(column.name) ? insert.cells.get(column.name) : null,
                    nullable: true,
                    onCommit: (next) => {
                        if (next !== undefined) {
                            if (next === null || next === "")
                                insert.cells.delete(column.name);
                            else
                                insert.cells.set(column.name, normalizeInput(next));
                        }
                        paintInsertCell(td, insert, column);
                        refreshPendingBar();
                    },
                });
            });
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
        if (focusLast && index === changes.inserts.length - 1) {
            const firstCell = tr.children[1];
            if (firstCell)
                firstCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        }
    });
}

function paintInsertCell(td, insert, column) {
    clear(td);
    if (insert.cells.has(column.name))
        td.textContent = insert.cells.get(column.name);
    else
        td.appendChild(h("span", { class: "null-badge" }, "default"));
}
