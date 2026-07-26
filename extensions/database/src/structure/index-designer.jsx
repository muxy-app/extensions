import { useState } from "react";
import { Modal } from "../ui/modal.jsx";
import { toast } from "../ui/toast.js";
import { quoteIdent, qualifiedName } from "../lib/sql/quote.js";

export function IndexDesignerModal({ session, tableRef, info, onDone, onClose }) {
    const engine = session.conn.engine;
    const [name, setName] = useState("");
    const [unique, setUnique] = useState(false);
    const [selected, setSelected] = useState(() => new Set());

    const effectiveName = name || `idx_${tableRef.table}`;
    const cols = info.columns.filter((c) => selected.has(c.name)).map((c) => quoteIdent(engine, c.name));
    const sql = cols.length
        ? `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteIdent(engine, effectiveName)} ON ${qualifiedName(engine, tableRef)} (${cols.join(", ")});`
        : "Select at least one column";

    const toggle = (columnName) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(columnName))
                next.delete(columnName);
            else
                next.add(columnName);
            return next;
        });

    const create = async () => {
        if (!cols.length)
            return;
        try {
            await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
            toast("Index created", "success");
            onClose();
            onDone();
        } catch (error) {
            toast(error.message, "warning");
        }
    };

    return (
        <Modal
            icon="bolt"
            title="New index"
            onClose={onClose}
            footer={
                <>
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={create}>
                        Create
                    </button>
                </>
            }
        >
            <div className="sheet-body">
                <div className="field">
                    <label>Index name</label>
                    <input type="text" autoFocus placeholder={`idx_${tableRef.table}`} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <label className="flex items-center gap-[var(--s3)]">
                    <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
                    Unique
                </label>
                <div className="field">
                    <label>Columns</label>
                    <div className="flex flex-col gap-[var(--s2)]">
                        {info.columns.map((c) => (
                            <label key={c.name} className="flex items-center gap-[var(--s3)]">
                                <input type="checkbox" checked={selected.has(c.name)} onChange={() => toggle(c.name)} />
                                {c.name}
                            </label>
                        ))}
                    </div>
                </div>
                <div className="field">
                    <label>SQL</label>
                    <pre className="mono error-box" style={{ color: "var(--muxy-foreground)", borderColor: "var(--muxy-border)" }}>
                        {sql}
                    </pre>
                </div>
            </div>
        </Modal>
    );
}
