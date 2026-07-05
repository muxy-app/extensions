import { Icon } from "../ui/icon.jsx";
import { ENGINES } from "../lib/connections.js";
import { useSession } from "./session-context.jsx";
import { ScopeSelects } from "./scope-selects.jsx";

const VIEWS = [
    { id: "data", label: "Data", icon: "grid" },
    { id: "structure", label: "Structure", icon: "columns" },
    { id: "query", label: "Query", icon: "code" },
];

export function Topbar() {
    const { session, view, setView, changeScope, refreshSchema, schemaEpoch } = useSession();
    const conn = session.conn;

    return (
        <div className="topbar">
            <div className="conn-dot ml-[var(--s2)]" style={{ background: conn.color }} />
            <div className="truncate text-[var(--font-emphasis)] font-semibold">{conn.name}</div>
            <div className="truncate text-[var(--font-footnote)] text-muted-foreground">
                {`${ENGINES[conn.engine].label}${session.serverVersion ? " " + session.serverVersion : ""}`}
            </div>
            <ScopeSelects key={schemaEpoch} session={session} onScopeChange={changeScope} />
            <div className="flex-1" />
            <div className="seg">
                {VIEWS.map((v) => (
                    <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => setView(v.id)}>
                        <Icon name={v.icon} />
                        {v.label}
                    </button>
                ))}
            </div>
            <button className="icon-btn" title="Refresh schema" onClick={refreshSchema}>
                <Icon name="refresh" />
            </button>
        </div>
    );
}
