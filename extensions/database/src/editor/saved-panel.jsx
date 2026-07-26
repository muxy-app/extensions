import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { getSavedQueries, setSavedQueries } from "../lib/storage.js";

export function SavedPanel({ session, onPick, getCurrentSql }) {
    const [entries, setEntries] = useState([]);
    const load = useCallback(async () => {
        const all = await getSavedQueries();
        setEntries(all.filter((q) => !q.connId || q.connId === session.conn.id));
    }, [session]);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        const sql = getCurrentSql().trim();
        if (!sql) {
            toast("Nothing to save", "warning");
            return;
        }
        const name = await muxy.dialog.prompt({ title: "Save query", message: "Name for this query", placeholder: "e.g. Active users" });
        if (!name)
            return;
        const all = await getSavedQueries();
        all.push({ id: `q-${Date.now().toString(36)}`, name, connId: session.conn.id, sql, createdAt: Date.now(), updatedAt: Date.now() });
        await setSavedQueries(all);
        load();
    };

    const remove = async (id) => {
        const all = await getSavedQueries();
        await setSavedQueries(all.filter((q) => q.id !== id));
        load();
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-[var(--s3)] border-b px-[var(--s5)] py-[var(--s3)]" style={{ borderColor: "var(--muxy-border)" }}>
                <Icon name="star" size={12} />
                <span className="section-label">Saved</span>
                <div className="flex-1" />
                <button className="icon-btn" title="Save current query" onClick={save}>
                    <Icon name="plus" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {entries.length === 0 ? (
                    <div className="px-[var(--s5)] py-[var(--s5)] text-muted-foreground">No saved queries</div>
                ) : (
                    entries.map((entry) => (
                        <div
                            key={entry.id}
                            className="tree-row tree-row-stacked group"
                            onClick={() => onPick(entry.sql)}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[var(--font-body)] font-semibold">{entry.name}</div>
                                <div className="mono truncate text-[var(--font-footnote)] text-muted-foreground">
                                    {entry.sql.replace(/\s+/g, " ").slice(0, 80)}
                                </div>
                            </div>
                            <button
                                className="icon-btn hidden group-hover:flex"
                                title="Delete saved query"
                                onClick={(e) => { e.stopPropagation(); remove(entry.id); }}
                            >
                                <Icon name="trash" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
