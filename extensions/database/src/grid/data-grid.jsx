import { useState } from "react";
import { cellDisplay } from "./grid.jsx";
import { CellEditor } from "./cell-editor.jsx";
import { ContextMenu } from "../ui/context-menu.jsx";
import { InsertRows } from "./insert-rows.jsx";
import { getEdit, isDeleted } from "./pending-changes.js";

function normalizeInput(value) {
    if (value === null)
        return null;
    if (typeof value === "boolean")
        return value ? "1" : "0";
    return String(value);
}

export function DataGrid({ page, changes, editable, sort, onSort, onChange, editing, setEditing, onContextItems, onViewCell }) {
    const { displayColumns, displayRows, keyValuesFor } = page;
    const [menu, setMenu] = useState(null);

    const commitRowEdit = (r, column, original, next) => {
        if (next !== undefined)
            changes.setEdit(keyValuesFor(r), column.name, normalizeInput(next), original);
        onChange();
        setEditing(null);
    };

    const commitInsertEdit = (insert, column, next) => {
        if (next !== undefined) {
            if (next === null || next === "")
                insert.cells.delete(column.name);
            else
                insert.cells.set(column.name, normalizeInput(next));
        }
        onChange();
        setEditing(null);
    };

    const rowContextItems = (r, c) => {
        const column = displayColumns[c];
        const value = displayRows[r][c];
        const items = onContextItems(value, r, column);
        if (editable) {
            items.push({ separator: true });
            items.push({
                label: "Set NULL",
                onClick: () => { changes.setEdit(keyValuesFor(r), column.name, null, value); onChange(); },
            });
            items.push({
                label: isDeleted(changes.model, keyValuesFor(r)) ? "Undelete row" : "Delete row",
                onClick: () => { changes.toggleDelete(keyValuesFor(r)); onChange(); },
            });
        }
        return items;
    };

    return (
        <div className="grid-wrap">
            <table className="grid-table">
                <thead>
                    <tr>
                        {editable ? <th className="gutter" /> : null}
                        {displayColumns.map((col) => {
                            const sorted = sort && sort.column === col.name;
                            const marker = sorted ? (sort.dir === "desc" ? " ▾" : " ▴") : "";
                            return (
                                <th key={col.name} title={col.type || col.name} onClick={() => onSort(col.name)}>
                                    {`${col.name}${marker}`}
                                    {col.type ? (
                                        <span className="ml-[var(--s2)] font-normal text-muted-foreground">{col.type.toLowerCase()}</span>
                                    ) : null}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {displayRows.map((row, r) => {
                        const deleted = editable && isDeleted(changes.model, keyValuesFor(r));
                        return (
                            <tr key={r} className={deleted ? "row-deleted" : undefined}>
                                {editable ? (
                                    <td className="gutter" title="Click to mark for deletion" onClick={() => { changes.toggleDelete(keyValuesFor(r)); onChange(); }}>
                                        {r + 1}
                                    </td>
                                ) : null}
                                {row.map((value, c) => {
                                    const column = displayColumns[c];
                                    const edit = editable ? getEdit(changes.model, keyValuesFor(r), column.name) : { edited: false };
                                    const isEditing = editing && editing.kind === "row" && editing.row === r && editing.column === column.name;
                                    if (isEditing)
                                        return (
                                            <td key={c} className="editing">
                                                <CellEditor
                                                    type={column.type}
                                                    value={edit.edited ? edit.value : value}
                                                    nullable
                                                    onCommit={(next) => commitRowEdit(r, column, value, next)}
                                                    onCancel={() => setEditing(null)}
                                                />
                                            </td>
                                        );
                                    const info = cellDisplay(edit.edited ? edit.value : value);
                                    return (
                                        <td
                                            key={c}
                                            className={edit.edited ? "cell-edited" : undefined}
                                            title={info.title}
                                            onDoubleClick={editable ? () => setEditing({ kind: "row", row: r, column: column.name }) : () => onViewCell(value)}
                                            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: rowContextItems(r, c) }); }}
                                        >
                                            {info.null ? <span className="null-badge">NULL</span> : info.text}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    {editable ? (
                        <InsertRows
                            inserts={changes.model.inserts}
                            columns={displayColumns}
                            editing={editing}
                            onEdit={setEditing}
                            onCommit={commitInsertEdit}
                            onRemove={(id) => { changes.removeInsert(id); onChange(); }}
                        />
                    ) : null}
                </tbody>
            </table>
            {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
        </div>
    );
}
