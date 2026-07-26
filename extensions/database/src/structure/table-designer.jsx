import { useState } from "react";
import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { quoteIdent } from "../lib/sql/quote.js";

const TYPE_SUGGESTIONS = {
    sqlite: ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"],
    postgres: ["integer", "bigint", "serial", "text", "varchar(255)", "boolean", "timestamptz", "numeric", "jsonb"],
    mysql: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATETIME", "DECIMAL(10,2)", "JSON"],
    mariadb: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATETIME", "DECIMAL(10,2)", "JSON"],
};

function buildSql(engine, tableName, columns) {
    const name = tableName.trim();
    if (!name)
        return "-- enter a table name";
    const defs = columns
        .filter((c) => c.name.trim())
        .map((c) => {
            let line = `  ${quoteIdent(engine, c.name.trim())} ${c.type || "TEXT"}`;
            if (c.pk)
                line += " PRIMARY KEY";
            if (c.notNull && !c.pk)
                line += " NOT NULL";
            return line;
        });
    if (!defs.length)
        return "-- add at least one column";
    return `CREATE TABLE ${quoteIdent(engine, name)} (\n${defs.join(",\n")}\n);`;
}

export function TableDesignerModal({ session, onDone, onClose }) {
    const engine = session.conn.engine;
    const newColumn = () => ({ name: "", type: TYPE_SUGGESTIONS[engine][0], pk: false, notNull: false });
    const [tableName, setTableName] = useState("");
    const [columns, setColumns] = useState(() => [newColumn()]);

    const patch = (index, p) => setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...p } : c)));
    const addColumn = () => setColumns((prev) => [...prev, newColumn()]);
    const removeColumn = (index) =>
        setColumns((prev) => {
            const next = prev.filter((_, i) => i !== index);
            return next.length ? next : [newColumn()];
        });

    const sql = buildSql(engine, tableName, columns);

    const create = async () => {
        if (sql.startsWith("--"))
            return;
        try {
            await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
            toast("Table created", "success");
            onClose();
            onDone();
        } catch (error) {
            toast(error.message, "warning");
        }
    };

    return (
        <Modal
            icon="table"
            title="New table"
            size="lg"
            onClose={onClose}
            footer={
                <>
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={create}>
                        Create table
                    </button>
                </>
            }
        >
            <div className="sheet-body">
                <datalist id="db-types">
                    {TYPE_SUGGESTIONS[engine].map((t) => (
                        <option key={t} value={t} />
                    ))}
                </datalist>
                <div className="field">
                    <label>Table name</label>
                    <input type="text" autoFocus placeholder="table_name" value={tableName} onChange={(e) => setTableName(e.target.value)} />
                </div>
                <div className="field">
                    <div className="flex items-center">
                        <label className="flex-1">Columns</label>
                        <button className="btn btn-compact" onClick={addColumn}>
                            <Icon name="plus" />
                            Column
                        </button>
                    </div>
                    <div className="column-designer-grid">
                        {columns.map((col, index) => (
                            <div key={index} className="column-designer-row">
                                <input
                                    type="text"
                                    placeholder="column"
                                    value={col.name}
                                    onChange={(e) => patch(index, { name: e.target.value })}
                                />
                                <input
                                    type="text"
                                    list="db-types"
                                    value={col.type}
                                    onChange={(e) => patch(index, { type: e.target.value })}
                                />
                                <label className="column-designer-check text-[var(--font-footnote)]">
                                    <input type="checkbox" checked={col.pk} onChange={(e) => patch(index, { pk: e.target.checked })} />
                                    PK
                                </label>
                                <label className="column-designer-check text-[var(--font-footnote)]">
                                    <input type="checkbox" checked={col.notNull} onChange={(e) => patch(index, { notNull: e.target.checked })} />
                                    NN
                                </label>
                                <button className="icon-btn" title="Remove column" onClick={() => removeColumn(index)}>
                                    <Icon name="x" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="field">
                    <label>SQL</label>
                    <pre
                        className="mono error-box"
                        style={{ color: "var(--muxy-foreground)", borderColor: "var(--muxy-border)", whiteSpace: "pre-wrap" }}
                    >
                        {sql}
                    </pre>
                </div>
            </div>
        </Modal>
    );
}
