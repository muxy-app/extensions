import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { ENGINES, listConnections } from "../lib/connections.js";
import { connectionTarget, quickConnect, engineAvailability } from "./actions.js";
import { ConnectionCard } from "./connection-card.jsx";
import { ImportRow } from "./import-row.jsx";
import { ConnectionFormModal } from "./connection-form.jsx";

function groupConnections(connections) {
    const groups = new Map();
    for (const conn of connections) {
        const key = conn.group || "";
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(conn);
    }
    const sorted = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    return sorted.map((group) => [group, groups.get(group).sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name))]);
}

function EngineHints() {
    const [availability, setAvailability] = useState(null);
    useEffect(() => {
        engineAvailability().then(setAvailability);
    }, []);
    if (!availability)
        return null;
    return (
        <div className="mt-[var(--s6)] flex flex-col gap-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground">
            {Object.entries(ENGINES).map(([engine, def]) => {
                const info = availability[engine];
                return (
                    <div key={engine} className="flex items-center gap-[var(--s3)]">
                        <span style={{ color: `var(${info.available ? "--muxy-diff-add" : "--muxy-diff-remove"})` }}>{info.available ? "✓" : "✕"}</span>
                        <span className="font-semibold">{def.label}</span>
                        <span className="mono truncate">{info.available ? "installed" : "not found"}</span>
                    </div>
                );
            })}
        </div>
    );
}

export function ConnectionsScreen({ variant = "tab", onOpen }) {
    const panel = variant === "panel";
    const [connections, setConnections] = useState([]);
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState(undefined);

    const load = useCallback(() => {
        listConnections().then(setConnections);
    }, []);

    useEffect(() => { load(); }, [load]);

    const term = query.trim().toLowerCase();
    const filtered = connections.filter(
        (c) => !term || c.name.toLowerCase().includes(term) || connectionTarget(c).toLowerCase().includes(term) || (c.group || "").toLowerCase().includes(term),
    );
    const hasSsh = connections.some((c) => c.ssh?.enabled);

    const closeAllTunnels = async () => {
        const { sweepTunnels } = await import("../lib/tunnel.js");
        await sweepTunnels();
        toast("Closed idle tunnels", "success");
    };

    const header = panel ? (
        <div className="search-bar search-bar-compact" style={{ borderColor: "var(--muxy-border)" }}>
            <input type="text" placeholder="Search" className="search-bar-input" value={query} onChange={(e) => setQuery(e.target.value)} />
            {hasSsh ? (
                <button className="icon-btn" title="Close all SSH tunnels" onClick={closeAllTunnels}>
                    <Icon name="link" />
                </button>
            ) : null}
            <button className="icon-btn" title="New connection" onClick={() => setEditing(null)}>
                <Icon name="plus" />
            </button>
        </div>
    ) : (
        <div className="topbar">
            <div className="flex items-center gap-[var(--s3)] text-[var(--font-emphasis)] font-semibold">
                <Icon name="database" />
                Connections
            </div>
            <div className="flex-1" />
            <input type="text" placeholder="Search" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} />
            {connections.length > 1 ? (
                <button className="btn btn-compact" title="Quick connect" onClick={() => quickConnect(onOpen)}>
                    <Icon name="bolt" />
                    Quick connect
                </button>
            ) : null}
            {hasSsh ? (
                <button className="btn btn-compact" title="Close all SSH tunnels" onClick={closeAllTunnels}>
                    <Icon name="link" />
                    Close tunnels
                </button>
            ) : null}
            <button className="btn btn-compact btn-primary" onClick={() => setEditing(null)}>
                <Icon name="plus" />
                New Connection
            </button>
        </div>
    );

    return (
        <div className="flex h-full flex-col">
            {header}
            <div className={`flex-1 overflow-y-auto ${panel ? "" : "px-[var(--s7)] py-[var(--s6)]"}`}>
                {connections.length === 0 ? (
                    <EmptyState
                        icon="database"
                        title="No connections yet"
                        description="Add a connection to browse and query your databases."
                    >
                        <button className="btn btn-primary" onClick={() => setEditing(null)}>
                            <Icon name="plus" />
                            New Connection
                        </button>
                        {panel ? null : <ImportRow onImported={load} />}
                        <EngineHints />
                    </EmptyState>
                ) : filtered.length === 0 ? (
                    <div className="py-[var(--s8)] text-center text-muted-foreground">No connections match your search</div>
                ) : (
                    <>
                        {groupConnections(filtered).map(([group, conns]) => (
                            <div key={group || "__none"}>
                                {group ? <div className={`section-label mb-[var(--s3)] mt-[var(--s5)] ${panel ? "px-[var(--s5)]" : ""}`}>{group}</div> : null}
                                <div className={`flex flex-col ${panel ? "" : "gap-[var(--s3)]"}`}>
                                    {conns.map((conn) => (
                                        <ConnectionCard key={conn.id} conn={conn} panel={panel} onOpen={onOpen} onEdit={setEditing} onChanged={load} />
                                    ))}
                                </div>
                            </div>
                        ))}
                        {panel ? null : <ImportRow onImported={load} />}
                    </>
                )}
            </div>
            {editing !== undefined ? (
                <ConnectionFormModal existing={editing} onSaved={load} onClose={() => setEditing(undefined)} />
            ) : null}
        </div>
    );
}
