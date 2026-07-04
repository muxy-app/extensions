import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { loadTables, loadColumns, tableInfo } from "./state.js";

const SessionContext = createContext(null);

export function useSession() {
    return useContext(SessionContext);
}

export function SessionProvider({ session, queryHooksRef, pendingQueryActionRef, setViewRef, children }) {
    const [view, setView] = useState(session.view || "data");
    const [ref, setRef] = useState(session.ref || null);
    const [tables, setTables] = useState(session.tables || []);
    const [columnsMap, setColumnsMap] = useState(session.columnsMap || {});
    const [status, setStatus] = useState("Ready");
    const [schemaEpoch, bumpEpoch] = useReducer((n) => n + 1, 0);

    const refreshSchema = useCallback(async () => {
        session.infoCache.clear();
        await loadTables(session);
        await loadColumns(session);
        setTables(session.tables);
        setColumnsMap(session.columnsMap || {});
        bumpEpoch();
    }, [session]);

    const selectTable = useCallback(
        (next) => {
            session.ref = next;
            setRef(next);
            setView((prev) => (prev === "query" ? "data" : prev));
            tableInfo(session, next).catch(() => undefined);
        },
        [session],
    );

    const changeScope = useCallback(
        async (scope) => {
            if (scope.database !== undefined) {
                session.ctx.database = scope.database;
                session.ctx.schema = session.conn.engine === "postgres" ? "public" : "";
            }
            if (scope.schema !== undefined)
                session.ctx.schema = scope.schema;
            session.ref = null;
            setRef(null);
            session.infoCache.clear();
            session.gridState.clear();
            await refreshSchema();
        },
        [session, refreshSchema],
    );

    const changeView = useCallback(
        (next) => {
            session.view = next;
            setView(next);
        },
        [session],
    );

    useEffect(() => {
        if (!setViewRef)
            return;
        setViewRef.current = changeView;
        return () => { setViewRef.current = null; };
    }, [setViewRef, changeView]);

    const value = useMemo(
        () => ({
            session,
            view,
            setView: changeView,
            ref,
            selectTable,
            tables,
            columnsMap,
            status,
            setStatus,
            refreshSchema,
            changeScope,
            schemaEpoch,
            queryHooksRef,
            pendingQueryActionRef,
        }),
        [session, view, changeView, ref, selectTable, tables, columnsMap, status, refreshSchema, changeScope, schemaEpoch],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
