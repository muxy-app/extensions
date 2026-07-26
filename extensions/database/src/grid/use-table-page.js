import { useEffect, useState } from "react";
import { buildSelect } from "../lib/sql/select-builder.js";
import { tableInfo } from "../workbench/state.js";
import { createChanges, isEditable } from "./pending-changes.js";

function refKey(ref) {
    return `${ref.database || ""}.${ref.schema || ""}.${ref.table}`;
}

function changesFor(session, ref, info) {
    session.changes = session.changes || new Map();
    const key = refKey(ref);
    if (!session.changes.has(key))
        session.changes.set(key, createChanges(session.conn.engine, ref, info));
    return session.changes.get(key);
}

export function useTablePage(session, tableRef, gridState, reloadTick) {
    const [result, setResult] = useState({ loading: true });

    useEffect(() => {
        let stale = false;
        setResult({ loading: true });
        (async () => {
            try {
                const info = await tableInfo(session, tableRef);
                const changes = changesFor(session, tableRef, info);
                const editable = tableRef.kind !== "view" && isEditable(changes);
                const useRowid = changes.keyColumns?.[0] === "__rowid";
                const sql = buildSelect(session.conn.engine, tableRef, {
                    filters: gridState.filters,
                    rawWhere: gridState.rawWhere,
                    sort: gridState.sort,
                    limit: session.pageSize,
                    offset: gridState.page * session.pageSize,
                    rowid: useRowid,
                });
                const started = performance.now();
                const results = await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
                const raw = results[0];
                const hiddenIndex = raw.columns.findIndex((c) => c.name === "__rowid");
                const displayColumns = raw.columns.filter((_, i) => i !== hiddenIndex);
                const typeByName = new Map(info.columns.map((c) => [c.name, c.type]));
                for (const col of displayColumns)
                    col.type = typeByName.get(col.name) || "";
                const displayRows = raw.rows.map((row) => row.filter((_, i) => i !== hiddenIndex));
                const keyIndexes = editable
                    ? changes.keyColumns.map((kc) => (kc === "__rowid" ? hiddenIndex : raw.columns.findIndex((c) => c.name === kc)))
                    : [];
                const keyValuesFor = (r) => keyIndexes.map((i) => raw.rows[r][i]);
                if (!stale)
                    setResult({
                        loading: false,
                        info,
                        changes,
                        editable,
                        displayColumns,
                        displayRows,
                        keyValuesFor,
                        elapsed: Math.round(performance.now() - started),
                    });
            } catch (error) {
                if (!stale)
                    setResult({ loading: false, error: error.message });
            }
        })();
        return () => { stale = true; };
    }, [session, tableRef, gridState, reloadTick]);

    return result;
}
