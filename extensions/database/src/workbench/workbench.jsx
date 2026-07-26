import { useEffect, useState } from "react";
import { useSession } from "./session-context.jsx";
import { Topbar } from "./topbar.jsx";
import { Sidebar } from "./sidebar.jsx";
import { Statusbar } from "./statusbar.jsx";
import { EmptyState } from "../ui/empty-state.jsx";
import { closeTunnel } from "../lib/tunnel.js";
import { clearCredFiles } from "../lib/cred-file.js";
import { DataView } from "../grid/data-view.jsx";
import { QueryView } from "../editor/query-view.jsx";
import { StructureView } from "../structure/structure-view.jsx";
import { TableDesignerModal } from "../structure/table-designer.jsx";
import { TransferMenuModal } from "../transfer/transfer-menu.jsx";

export function Workbench() {
    const { session, view, ref, setStatus, refreshSchema, schemaEpoch, queryHooksRef, pendingQueryActionRef } = useSession();
    const [designerOpen, setDesignerOpen] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false);

    useEffect(() => {
        const conn = session.conn;
        const onHide = () => {
            clearCredFiles(conn.id).catch(() => undefined);
            if (conn.ssh?.enabled)
                closeTunnel(conn).catch(() => undefined);
        };
        window.addEventListener("pagehide", onHide, { once: true });
        return () => window.removeEventListener("pagehide", onHide);
    }, [session]);

    const main = () => {
        if (view === "query")
            return <QueryView session={session} setStatus={setStatus} queryHooksRef={queryHooksRef} pendingQueryActionRef={pendingQueryActionRef} />;
        if (!ref) {
            if (view === "structure")
                return <EmptyState icon="columns" description="Select a table to inspect its structure" />;
            return <EmptyState icon="table" description="Select a table to browse its data" />;
        }
        if (view === "structure")
            return <StructureView key={`${schemaEpoch}:${ref.table}`} session={session} tableRef={ref} setStatus={setStatus} reloadTables={refreshSchema} />;
        return <DataView key={`${schemaEpoch}:${ref.database || ""}.${ref.schema || ""}.${ref.table}`} session={session} tableRef={ref} setStatus={setStatus} />;
    };

    return (
        <div className="flex h-full flex-col">
            <Topbar />
            <div className="flex min-h-0 flex-1">
                <Sidebar onNewTable={() => setDesignerOpen(true)} onTransfer={() => setTransferOpen(true)} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main()}</div>
            </div>
            <Statusbar />
            {designerOpen ? (
                <TableDesignerModal session={session} onDone={refreshSchema} onClose={() => setDesignerOpen(false)} />
            ) : null}
            {transferOpen ? (
                <TransferMenuModal session={session} tableRef={ref} onClose={() => setTransferOpen(false)} />
            ) : null}
        </div>
    );
}
