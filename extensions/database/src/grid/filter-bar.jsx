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
        <div className="flex flex-col">
            <div className="search-bar" style={{ borderColor: "var(--muxy-border)" }}>
                <button className="icon-btn" title="Add filter" onClick={addRow}>
                    <Icon name="plus" />
                </button>
                <input
                    type="text"
                    className="mono search-bar-input"
                    placeholder="raw WHERE (optional)"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
                />
                <button className="btn btn-compact btn-primary" onClick={apply}>
                    <Icon name="filter" />
                    Apply
                </button>
            </div>
            {rows.length ? (
                <div className="flex flex-wrap items-center gap-[var(--s3)] px-[var(--s3)] py-[var(--s2)]">
                    {rows.map((row, index) => (
                        <div key={index} className="flex items-center gap-[var(--s2)]">
                            <select value={row.column} onChange={(e) => patchRow(index, { column: e.target.value })}>
                                <option value="">column</option>
                                {columns.map((c) => (
                                    <option key={c.name} value={c.name}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                            <select value={row.op} onChange={(e) => patchRow(index, { op: e.target.value })}>
                                {FILTER_OPS.map((op) => (
                                    <option key={op.id} value={op.id}>
                                        {op.label}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="text"
                                placeholder="value"
                                value={row.value ?? ""}
                                style={{ width: "120px", display: isUnary(row.op) ? "none" : "" }}
                                onChange={(e) => patchRow(index, { value: e.target.value })}
                            />
                            <button className="icon-btn" title="Remove filter" onClick={() => removeRow(index)}>
                                <Icon name="x" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
