import { CellEditor } from "./cell-editor.jsx";

function InsertCell({ insert, column, editing, onOpenEditor, onCommit, onCancel }) {
    if (editing)
        return (
            <td className="mono editing">
                <CellEditor
                    type={column.type}
                    value={insert.cells.has(column.name) ? insert.cells.get(column.name) : null}
                    nullable
                    onCommit={onCommit}
                    onCancel={onCancel}
                />
            </td>
        );
    return (
        <td className="mono" onDoubleClick={onOpenEditor}>
            {insert.cells.has(column.name) ? insert.cells.get(column.name) : <span className="null-badge">default</span>}
        </td>
    );
}

export function InsertRows({ inserts, columns, editing, onEdit, onCommit, onRemove }) {
    return inserts.map((insert) => (
        <tr key={insert.id} className="row-insert">
            <td className="gutter" title="Remove this new row" onClick={() => onRemove(insert.id)}>
                +
            </td>
            {columns.map((column) => (
                <InsertCell
                    key={column.name}
                    insert={insert}
                    column={column}
                    editing={editing && editing.kind === "insert" && editing.insertId === insert.id && editing.column === column.name}
                    onOpenEditor={() => onEdit({ kind: "insert", insertId: insert.id, column: column.name })}
                    onCommit={(next) => onCommit(insert, column, next)}
                    onCancel={() => onEdit(null)}
                />
            ))}
        </tr>
    ));
}
