import { Icon } from "../ui/icon.jsx";
import { ENGINES } from "../lib/connections.js";
import { useSession } from "./session-context.jsx";

export function Statusbar() {
    const { session, status } = useSession();
    const conn = session.conn;
    return (
        <div className="statusbar">
            <span className="truncate">{status}</span>
            <div className="flex-1" />
            <span>{`${ENGINES[conn.engine].label}${session.serverVersion ? " " + session.serverVersion : ""}`}</span>
            {conn.ssh?.enabled ? (
                <span className="flex items-center gap-[var(--s2)]">
                    <Icon name="link" size={12} />
                    SSH
                </span>
            ) : null}
        </div>
    );
}
