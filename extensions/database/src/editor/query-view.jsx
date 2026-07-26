import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { appendHistory } from "../lib/storage.js";
import { statementAt } from "../lib/sql/statement-split.js";
import { selectedSql, insertSql } from "./sql-editor.js";
import { exportResult } from "../transfer/transfer.js";
import { SqlEditorView } from "./sql-editor-view.jsx";
import { Results } from "./results.jsx";
import { HistoryPanel } from "./history-panel.jsx";
import { SavedPanel } from "./saved-panel.jsx";
import { QueryTabs } from "./query-tabs.jsx";
import { useQueryTabs } from "./use-query-tabs.js";

export function schemaForCompletion(session) {
    const schema = {};
    for (const table of session.tables)
        schema[table.name] = session.columnsMap?.[table.name] || [];
    return schema;
}

export function QueryView({ session, setStatus, queryHooksRef, pendingQueryActionRef }) {
    const { state, update } = useQueryTabs(session);
    const editorRef = useRef(null);
    const [panel, setPanel] = useState(null);
    const [running, setRunning] = useState(false);
    const [historyToken, setHistoryToken] = useState(0);

    if (!state)
        return null;

    const activeTab = state.tabs.find((t) => t.id === state.activeId) || state.tabs[0];

    const setTabResults = (id, results) =>
        update((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === id ? { ...t, results } : t)) }));

    const setTabSql = (id, sql) =>
        update((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === id ? { ...t, sql } : t)) }), { persistDrafts: true });

    const switchTab = (id) => update((prev) => ({ ...prev, activeId: id }), { persistDrafts: true });

    const addTab = useCallback(() => {
        update(
            (prev) => {
                const id = prev.counter + 1;
                return { ...prev, counter: id, activeId: id, tabs: [...prev.tabs, { id, title: `Query ${id}`, sql: "", results: null }] };
            },
            { persistDrafts: true },
        );
    }, [update]);

    const closeTab = (id) =>
        update(
            (prev) => {
                const index = prev.tabs.findIndex((t) => t.id === id);
                const tabs = prev.tabs.filter((t) => t.id !== id);
                const activeId = prev.activeId === id ? (tabs[index] || tabs[index - 1] || tabs[0]).id : prev.activeId;
                return { ...prev, tabs, activeId };
            },
            { persistDrafts: true },
        );

    const currentStatement = () => {
        const selection = selectedSql(editorRef.current);
        if (selection)
            return selection.trim();
        const offset = editorRef.current.state.selection.main.head;
        return statementAt(editorRef.current.state.doc.toString(), offset, session.conn.engine)?.sql || "";
    };

    const execute = useCallback(
        async (sql, runner, isExplain = false) => {
            setRunning(true);
            setStatus(isExplain ? "Explaining…" : "Running…");
            const started = Date.now();
            try {
                const results = await runner(sql);
                setTabResults(state.activeId, { results });
                const rows = results.reduce((sum, r) => sum + r.rows.length, 0);
                const duration = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
                setStatus(`Done · ${rows} rows · ${duration}ms`);
                if (!isExplain)
                    await appendHistory(session.conn.id, { id: String(started), sql: sql.slice(0, 4096), startedAt: started, durationMs: duration, ok: true, rows });
            } catch (error) {
                setTabResults(state.activeId, { error: error.message });
                setStatus("Error");
                if (!isExplain)
                    await appendHistory(session.conn.id, { id: String(started), sql: sql.slice(0, 4096), startedAt: started, durationMs: Date.now() - started, ok: false });
            } finally {
                setRunning(false);
                setHistoryToken((n) => n + 1);
            }
        },
        [session, setStatus, state.activeId],
    );

    const run = useCallback(
        async (mode) => {
            const sql = mode === "all" ? editorRef.current.state.doc.toString().trim() : currentStatement();
            if (!sql)
                return;
            await execute(sql, (s) => session.driver.runQuery(session.ctx, s, { timeoutMs: session.timeoutMs }));
        },
        [execute, session],
    );

    const runRef = useRef(run);
    runRef.current = run;

    const runExplain = async () => {
        const sql = currentStatement();
        if (!sql)
            return;
        await execute(sql, (s) => session.driver.explain(session.ctx, s, { timeoutMs: session.timeoutMs }), true);
    };

    useEffect(() => {
        queryHooksRef.current = { newTab: () => addTab(), run: () => runRef.current("cursor") };
        if (pendingQueryActionRef.current === "new") {
            pendingQueryActionRef.current = null;
            addTab();
        }
        return () => { queryHooksRef.current = null; };
    }, [queryHooksRef, pendingQueryActionRef, addTab]);

    const exportResults = async () => {
        const results = activeTab.results?.results;
        const withRows = results?.find((r) => r.columns.length);
        if (!withRows) {
            toast("No result rows to export", "warning");
            return;
        }
        await exportResult(session.conn.engine, session.ref, withRows, "csv");
    };

    const togglePanel = (kind) => setPanel((prev) => (prev === kind ? null : kind));

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
                <QueryTabs tabs={state.tabs} activeId={state.activeId} onSwitch={switchTab} onClose={closeTab} onAdd={addTab} />
                <div className="toolbar border-b" style={{ borderColor: "var(--muxy-border)" }}>
                    <button className="btn btn-compact btn-primary" disabled={running} onClick={() => run("cursor")}>
                        <Icon name="play" />
                        Run
                    </button>
                    <button className="btn btn-compact" title="Run every statement in this tab" onClick={() => run("all")}>
                        Run All
                    </button>
                    <button className="btn btn-compact" title="Explain the statement at the cursor" onClick={runExplain}>
                        Explain
                    </button>
                    <span className="text-[var(--font-footnote)] text-muted-foreground">⌘⏎ statement · ⇧⌘⏎ all</span>
                    <div className="flex-1" />
                    <button className="icon-btn" title="Export results as CSV" onClick={exportResults}>
                        <Icon name="download" />
                    </button>
                    <button className="icon-btn" title="Query history" onClick={() => togglePanel("history")}>
                        <Icon name="clock" />
                    </button>
                    <button className="icon-btn" title="Saved queries" onClick={() => togglePanel("saved")}>
                        <Icon name="star" />
                    </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SqlEditorView
                        key={activeTab.id}
                        engine={session.conn.engine}
                        schema={schemaForCompletion(session)}
                        initialDoc={activeTab.sql}
                        viewRef={editorRef}
                        onDocChange={(doc) => setTabSql(activeTab.id, doc)}
                        onRun={() => runRef.current("cursor")}
                        onRunAll={() => runRef.current("all")}
                    />
                </div>
                <div className="min-h-0 border-t" style={{ borderColor: "var(--muxy-border)", flex: "0 0 45%" }}>
                    <Results results={activeTab.results?.results} error={activeTab.results?.error} />
                </div>
            </div>
            {panel === "history" ? (
                <HistoryPanel session={session} refreshToken={historyToken} onPick={(sql) => insertSql(editorRef.current, sql)} />
            ) : null}
            {panel === "saved" ? (
                <div className="w-[var(--side-panel-width)] flex-shrink-0 border-l" style={{ borderColor: "var(--muxy-border)" }}>
                    <SavedPanel
                        session={session}
                        onPick={(sql) => insertSql(editorRef.current, sql)}
                        getCurrentSql={() => selectedSql(editorRef.current) ?? editorRef.current.state.doc.toString()}
                    />
                </div>
            ) : null}
        </div>
    );
}
