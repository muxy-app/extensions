import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { getHistory, clearHistory } from "../lib/storage.js";

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60)
        return "just now";
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400)
        return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export function HistoryPanel({ session, refreshToken, onPick }) {
    const [entries, setEntries] = useState([]);
    const load = useCallback(() => {
        getHistory(session.conn.id).then(setEntries);
    }, [session]);

    useEffect(() => { load(); }, [load, refreshToken]);

    return (
        <div className="flex w-[var(--side-panel-width)] flex-shrink-0 flex-col border-l" style={{ borderColor: "var(--muxy-border)" }}>
            <div className="flex items-center gap-[var(--s3)] border-b px-[var(--s5)] py-[var(--s3)]" style={{ borderColor: "var(--muxy-border)" }}>
                <Icon name="clock" size={12} />
                <span className="section-label">History</span>
                <div className="flex-1" />
                <button className="icon-btn" title="Clear history" onClick={async () => { await clearHistory(session.conn.id); load(); }}>
                    <Icon name="trash" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {entries.length === 0 ? (
                    <div className="px-[var(--s5)] py-[var(--s5)] text-muted-foreground">No queries yet</div>
                ) : (
                    entries.map((entry) => (
                        <div
                            key={entry.id}
                            className="tree-row tree-row-stacked"
                            onClick={() => onPick(entry.sql)}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="mono truncate" title={entry.sql.slice(0, 500)}>
                                    {entry.sql.replace(/\s+/g, " ").slice(0, 80)}
                                </div>
                                <div className="flex items-center gap-[var(--s3)] text-[var(--font-footnote)] text-muted-foreground">
                                    <span style={{ color: `var(${entry.ok ? "--muxy-diff-add" : "--muxy-diff-remove"})` }}>
                                        {entry.ok ? "✓" : "✕"}
                                    </span>
                                    {timeAgo(entry.startedAt)}
                                    {entry.durationMs != null ? `${entry.durationMs}ms` : null}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
