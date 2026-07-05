import { useEffect, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { tableInfo } from "../workbench/state.js";
import { qualifiedName } from "../lib/sql/quote.js";
import { getPref } from "../lib/storage.js";
import { InfoTable, Section } from "./info-table.jsx";
import { IndexDesignerModal } from "./index-designer.jsx";

export function StructureView({ session, tableRef, setStatus, reloadTables }) {
    const [state, setState] = useState({ loading: true });
    const [reloadTick, setReloadTick] = useState(0);
    const [designerOpen, setDesignerOpen] = useState(false);
    const [confirmDestructive, setConfirmDestructive] = useState(true);

    useEffect(() => {
        getPref("confirmDestructive").then((v) => setConfirmDestructive(v !== false));
    }, []);

    useEffect(() => {
        if (!tableRef)
            return;
        let stale = false;
        setState({ loading: true });
        (async () => {
            try {
                const info = await tableInfo(session, tableRef, true);
                const ddl = await session.driver.ddl(session.ctx, tableRef).catch(() => "");
                if (!stale)
                    setState({ loading: false, info, ddl });
            } catch (error) {
                if (!stale)
                    setState({ loading: false, error: error.message });
            }
        })();
        return () => { stale = true; };
    }, [session, tableRef, reloadTick]);

    if (!tableRef)
        return <EmptyState icon="columns" description="Select a table to inspect its structure" />;

    const scroll = "flex-1 overflow-y-auto p-[var(--s7)]";
    if (state.loading)
        return <div className={scroll}><div className="text-muted-foreground">Loading…</div></div>;
    if (state.error)
        return <div className={scroll}><div className="error-box">{state.error}</div></div>;

    const { info, ddl } = state;
    const engine = session.conn.engine;

    const reloadStructure = () => {
        session.infoCache.delete(`${tableRef.database || ""}.${tableRef.schema || ""}.${tableRef.table}`);
        setReloadTick((n) => n + 1);
    };

    const runDestructive = async (sql, label) => {
        if (confirmDestructive) {
            const choice = await muxy.dialog.confirm({
                title: label,
                message: `Run:\n\n${sql}`,
                buttons: [label, "Cancel"],
                cancel: "Cancel",
                style: "warning",
            });
            if (choice !== label)
                return false;
        }
        try {
            await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
            toast(`${label} succeeded`, "success");
            return true;
        } catch (error) {
            toast(error.message, "warning");
            return false;
        }
    };

    const truncate = () => {
        const sql = engine === "sqlite" ? `DELETE FROM ${qualifiedName(engine, tableRef)}` : `TRUNCATE TABLE ${qualifiedName(engine, tableRef)}`;
        runDestructive(sql, "Truncate");
    };

    const drop = async () => {
        const ok = await runDestructive(`DROP ${tableRef.kind === "view" ? "VIEW" : "TABLE"} ${qualifiedName(engine, tableRef)}`, "Drop");
        if (ok)
            await reloadTables();
    };

    return (
        <div className={scroll}>
            <div className="mb-[var(--s6)] flex items-center gap-[var(--s4)]">
                <div className="text-[var(--font-title)] font-semibold">{tableRef.table}</div>
                <span className="text-[var(--font-footnote)] text-muted-foreground">{tableRef.kind === "view" ? "view" : "table"}</span>
                <div className="flex-1" />
                {tableRef.kind !== "view" ? (
                    <div className="flex items-center gap-[var(--s3)]">
                        <button className="btn" onClick={() => setDesignerOpen(true)}>
                            <Icon name="plus" />
                            Index
                        </button>
                        <button className="btn btn-danger" onClick={truncate}>
                            Truncate
                        </button>
                        <button className="btn btn-danger" onClick={drop}>
                            <Icon name="trash" />
                            Drop
                        </button>
                    </div>
                ) : null}
            </div>
            <div className="flex flex-col gap-[var(--s7)]">
                <Section title="Columns">
                    <InfoTable
                        headers={["Name", "Type", "Nullable", "Default", "Key"]}
                        rows={info.columns.map((c) => [c.name, c.type, c.nullable ? "YES" : "NO", c.default, c.isPk ? "PRIMARY" : c.autoIncrement ? "AUTO" : ""])}
                    />
                </Section>
                <Section title="Indexes">
                    <InfoTable
                        headers={["Name", "Unique", "Columns"]}
                        rows={info.indexes.map((i) => [i.name, i.unique ? "YES" : "NO", (i.columns || []).join(", ")])}
                    />
                </Section>
                <Section title="Foreign keys">
                    <InfoTable
                        headers={["Column", "References", "On delete"]}
                        rows={info.foreignKeys.map((f) => [f.column, `${f.refTable}(${f.refColumn})`, f.onDelete || ""])}
                    />
                </Section>
                {info.triggers?.length ? (
                    <Section title="Triggers">
                        <InfoTable headers={["Name", "Definition"]} rows={info.triggers.map((t) => [t.name, t.definition || ""])} />
                    </Section>
                ) : null}
                {ddl ? (
                    <Section title="DDL">
                        <pre
                            className="mono error-box ddl-block"
                            style={{ color: "var(--muxy-foreground)", borderColor: "var(--muxy-border)" }}
                        >
                            {ddl}
                        </pre>
                    </Section>
                ) : null}
            </div>
            {designerOpen ? (
                <IndexDesignerModal
                    session={session}
                    tableRef={tableRef}
                    info={info}
                    onDone={reloadStructure}
                    onClose={() => setDesignerOpen(false)}
                />
            ) : null}
        </div>
    );
}
