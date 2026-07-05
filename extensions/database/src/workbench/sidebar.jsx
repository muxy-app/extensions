import { useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { useSession } from "./session-context.jsx";

export function Sidebar({ onNewTable, onTransfer }) {
    const { session, tables, ref, selectTable } = useSession();
    const [filter, setFilter] = useState("");

    const term = filter.trim().toLowerCase();
    const visible = tables.filter((t) => !term || t.name.toLowerCase().includes(term));
    const tableCount = tables.filter((t) => t.kind === "table").length;
    const viewCount = tables.length - tableCount;

    return (
        <div className="flex w-56 flex-shrink-0 flex-col border-r" style={{ borderColor: "var(--muxy-border)" }}>
            <div className="pane-header-row">
                <input type="text" placeholder="Filter tables" className="flex-1" value={filter} onChange={(e) => setFilter(e.target.value)} />
                {onNewTable ? (
                    <button className="icon-btn icon-btn-bordered" title="New table" onClick={onNewTable}>
                        <Icon name="plus" />
                    </button>
                ) : null}
                {onTransfer ? (
                    <button className="icon-btn icon-btn-bordered" title="Import / Export" onClick={onTransfer}>
                        <Icon name="download" />
                    </button>
                ) : null}
            </div>
            <div className="flex-1 overflow-y-auto py-[var(--s2)]">
                {visible.length === 0 ? (
                    <div className="px-[var(--s5)] py-[var(--s4)] text-muted-foreground">{term ? "No matches" : "No tables"}</div>
                ) : (
                    visible.map((table) => {
                        const active = ref && ref.table === table.name;
                        return (
                            <div
                                key={table.name}
                                className={`tree-row ${active ? "active" : ""}`}
                                onClick={() =>
                                    selectTable({ table: table.name, kind: table.kind, database: session.ctx.database, schema: session.ctx.schema })
                                }
                            >
                                <Icon name={table.kind === "view" ? "eye" : "table"} size={12} />
                                <span className="truncate">{table.name}</span>
                            </div>
                        );
                    })
                )}
            </div>
            <div className="pane-footer-row text-[var(--font-footnote)] text-muted-foreground" style={{ borderColor: "var(--muxy-border)" }}>
                {`${tableCount} tables${viewCount ? ` · ${viewCount} views` : ""}`}
            </div>
        </div>
    );
}
