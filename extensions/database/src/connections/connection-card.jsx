import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { ENGINES, deleteConnection, duplicateConnection } from "../lib/connections.js";
import { deletePassword } from "../lib/credentials.js";
import { connectionTarget } from "./actions.js";

function ActionButton({ icon, title, onClick }) {
    return (
        <button className="icon-btn" title={title} onClick={onClick}>
            <Icon name={icon} />
        </button>
    );
}

export function ConnectionCard({ conn, panel, onOpen, onEdit, onChanged }) {
    const remove = async (e) => {
        e.stopPropagation();
        const choice = await muxy.dialog.confirm({
            title: "Delete connection",
            message: `Delete "${conn.name}"? Its saved password will also be removed.`,
            buttons: ["Delete", "Cancel"],
            cancel: "Cancel",
            style: "warning",
        });
        if (choice !== "Delete")
            return;
        await deletePassword(conn.id);
        await deleteConnection(conn.id);
        toast("Connection deleted");
        onChanged();
    };

    const duplicate = async (e) => {
        e.stopPropagation();
        await duplicateConnection(conn.id);
        onChanged();
    };

    return (
        <div className={`connection-card flex cursor-default items-center gap-[var(--s4)] ${panel ? "connection-row" : "card"}`} onClick={() => onOpen(conn)}>
            <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: conn.color }} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--font-body)] font-semibold">{conn.name || "Untitled"}</div>
                <div className="mono truncate text-[var(--font-footnote)] text-muted-foreground">
                    {`${ENGINES[conn.engine].label} · ${connectionTarget(conn)}`}
                </div>
            </div>
            <div className="connection-actions">
                <ActionButton icon="pencil" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(conn); }} />
                <ActionButton icon="copy" title="Duplicate" onClick={duplicate} />
                <ActionButton icon="trash" title="Delete" onClick={remove} />
            </div>
        </div>
    );
}
