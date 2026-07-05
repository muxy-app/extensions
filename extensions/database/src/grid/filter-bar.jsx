import { useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { FILTER_OPS } from "../lib/sql/select-builder.js";

function isUnary(opId) {
    const op = FILTER_OPS.find((o) => o.id === opId);
    return Boolean(op && op.unary);
}

export function FilterBar({ columns, filters, rawWhere, onApply }) {
    const [rows, setRows] = useState(() => filters.map((f) => ({ ...f })));
    const [raw, setRaw] = useState(rawWhere || "");

    const patchRow = (index, patch) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    const removeRow = (index) => setRows((prev) => prev.filter((_, i) => i !== index));
    const addRow = () => setRows((prev) => [...prev, { column: "", op: FILTER_OPS[0].id, value: "" }]);

    const apply = () =>
        onApply({
            filters: rows.filter((r) => r.column).map((r) => (isUnary(r.op) ? { ...r, value: "" } : r)),
            rawWhere: raw,
        });

    return (
        <>
            <div className="flex flex-wrap items-center gap-[var(--s3)]">
                {rows.map((row, index) => (
                    <div key={index} className="flex items-center gap-[var(--s2)]">
                        <select className="select-compact" value={row.column} onChange={(e) => patchRow(index, { column: e.target.value })}>
                            <option value="">column</option>
                            {columns.map((c) => (
                                <option key={c.name} value={c.name}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        <select className="select-compact" value={row.op} onChange={(e) => patchRow(index, { op: e.target.value })}>
                            {FILTER_OPS.map((op) => (
                                <option key={op.id} value={op.id}>
                                    {op.label}
                                </option>
                            ))}
                        </select>
                        <input
                            type="text"
                            className="control-compact"
                            placeholder="value"
                            value={row.value ?? ""}
                            style={{ width: "120px", display: isUnary(row.op) ? "none" : "" }}
                            onChange={(e) => patchRow(index, { value: e.target.value })}
                        />
                        <button className="icon-btn icon-btn-compact" title="Remove filter" onClick={() => removeRow(index)}>
                            <Icon name="x" size={12} />
                        </button>
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-[var(--s3)]">
                <button className="icon-btn icon-btn-compact" title="Add filter" onClick={addRow}>
                    <Icon name="plus" size={12} />
                </button>
                <input
                    type="text"
                    className="mono control-compact"
                    placeholder="raw WHERE (optional)"
                    value={raw}
                    style={{ flex: 1, minWidth: "160px" }}
                    onChange={(e) => setRaw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
                />
                <button className="btn control-compact" onClick={apply}>
                    <Icon name="filter" size={12} />
                    Apply
                </button>
            </div>
        </>
    );
}
