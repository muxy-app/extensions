import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { appendHistory, getDrafts, setDrafts } from "../lib/storage.js";
import { statementAt } from "../lib/sql/statement-split.js";
import { createSqlEditor, selectedSql, insertSql } from "./sql-editor.js";
import { renderResults } from "./results.js";
import { renderHistoryPanel } from "./history.js";
import { renderSavedPanel } from "./saved-queries.js";

export function schemaForCompletion(session) {
    const schema = {};
    for (const table of session.tables)
        schema[table.name] = session.columnsMap?.[table.name] || [];
    return schema;
}

async function initQueryState(session) {
    if (session.queryState)
        return session.queryState;
    const drafts = await getDrafts(session.conn.id);
    const tabs = (drafts?.tabs || []).map((t) => ({ ...t, results: null }));
    if (!tabs.length)
        tabs.push({ id: 1, title: "Query 1", sql: "", results: null });
    session.queryState = {
        tabs,
        activeId: drafts?.activeId && tabs.some((t) => t.id === drafts.activeId) ? drafts.activeId : tabs[0].id,
        counter: Math.max(...tabs.map((t) => t.id)),
        panel: null,
        persistTimer: null,
    };
    return session.queryState;
}

function persistDrafts(session) {
    const qs = session.queryState;
    clearTimeout(qs.persistTimer);
    qs.persistTimer = setTimeout(() => {
        setDrafts(session.conn.id, {
            tabs: qs.tabs.map((t) => ({ id: t.id, title: t.title, sql: t.sql })),
            activeId: qs.activeId,
        }).catch(() => undefined);
    }, 400);
}

export async function renderQueryView(container, session, { setStatus }) {
    clear(container);
    const qs = await initQueryState(session);
    const activeTab = () => qs.tabs.find((t) => t.id === qs.activeId) || qs.tabs[0];

    const tabsBar = h("div", { class: "flex items-center gap-[var(--s1)] border-b px-[var(--s3)] pt-[var(--s2)]", style: "border-color: var(--muxy-border)" });
    const toolbar = h("div", { class: "flex items-center gap-[var(--s3)] border-b px-[var(--s4)] py-[var(--s2)]", style: "border-color: var(--muxy-border)" });
    const editorHost = h("div", { class: "min-h-0 flex-1 overflow-hidden" });
    const resultsArea = h("div", { class: "min-h-0 border-t", style: "border-color: var(--muxy-border); flex: 0 0 45%" });
    const sideWrap = h("div", { class: "w-72 flex-shrink-0 border-l", style: "display: none; border-color: var(--muxy-border)" });

    const editorColumn = h("div", { class: "flex min-w-0 flex-1 flex-col" }, tabsBar, toolbar, editorHost, resultsArea);
    container.appendChild(h("div", { class: "flex min-h-0 flex-1" }, editorColumn, sideWrap));

    let editor = null;

    function renderTabs() {
        clear(tabsBar);
        for (const tab of qs.tabs) {
            const active = tab.id === qs.activeId;
            tabsBar.appendChild(h("div", {
                class: `flex items-center gap-[var(--s2)] rounded-t-[4px] border px-[var(--s4)] py-[var(--s1)] text-[var(--font-body)] ${active ? "font-semibold" : ""}`,
                style: `border-color: var(--muxy-border); border-bottom-color: ${active ? "var(--muxy-background)" : "var(--muxy-border)"}; background: ${active ? "var(--muxy-background)" : "var(--muxy-surface)"}; margin-bottom: -1px; color: ${active ? "var(--muxy-foreground)" : "var(--muxy-foreground-muted)"}`,
                onclick: () => switchTab(tab.id),
            },
                tab.title,
                qs.tabs.length > 1
                    ? h("button", {
                        class: "icon-btn",
                        style: "width: 14px; height: 14px",
                        onclick: (e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                        },
                    }, icon("x", 9))
                    : null));
        }
        tabsBar.appendChild(h("button", { class: "icon-btn", title: "New query tab", onclick: () => addTab() }, icon("plus", 12)));
    }

    function switchTab(id) {
        syncDoc();
        qs.activeId = id;
        persistDrafts(session);
        renderTabs();
        mountEditor();
        renderResults(resultsArea, activeTab().results || {});
    }

    function addTab() {
        syncDoc();
        const id = ++qs.counter;
        qs.tabs.push({ id, title: `Query ${id}`, sql: "", results: null });
        switchTab(id);
    }

    function closeTab(id) {
        const index = qs.tabs.findIndex((t) => t.id === id);
        qs.tabs.splice(index, 1);
        if (qs.activeId === id)
            qs.activeId = (qs.tabs[index] || qs.tabs[index - 1] || qs.tabs[0]).id;
        persistDrafts(session);
        renderTabs();
        mountEditor();
        renderResults(resultsArea, activeTab().results || {});
    }

    function syncDoc() {
        if (editor)
            activeTab().sql = editor.state.doc.toString();
    }

    function mountEditor() {
        clear(editorHost);
        editor = createSqlEditor(editorHost, {
            engine: session.conn.engine,
            doc: activeTab().sql,
            schema: schemaForCompletion(session),
            onRun: () => run("cursor"),
            onRunAll: () => run("all"),
            onDocChange: (doc) => {
                activeTab().sql = doc;
                persistDrafts(session);
            },
        });
        editor.focus();
    }

    function currentStatement() {
        const selection = selectedSql(editor);
        if (selection)
            return selection.trim();
        const offset = editor.state.selection.main.head;
        return statementAt(editor.state.doc.toString(), offset, session.conn.engine)?.sql || "";
    }

    async function run(mode) {
        syncDoc();
        const sql = mode === "all" ? activeTab().sql.trim() : currentStatement();
        if (!sql)
            return;
        await execute(sql, (s) => session.driver.runQuery(session.ctx, s, { timeoutMs: session.timeoutMs }));
    }

    async function runExplain() {
        syncDoc();
        const sql = currentStatement();
        if (!sql)
            return;
        await execute(sql, (s) => session.driver.explain(session.ctx, s, { timeoutMs: session.timeoutMs }), true);
    }

    async function execute(sql, runner, isExplain = false) {
        runBtn.setAttribute("disabled", "");
        setStatus(isExplain ? "Explaining…" : "Running…");
        const started = Date.now();
        try {
            const results = await runner(sql);
            activeTab().results = { results };
            renderResults(resultsArea, { results });
            const rows = results.reduce((sum, r) => sum + r.rows.length, 0);
            const duration = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
            setStatus(`Done · ${rows} rows · ${duration}ms`);
            if (!isExplain)
                await appendHistory(session.conn.id, { id: String(started), sql: sql.slice(0, 4096), startedAt: started, durationMs: duration, ok: true, rows });
        }
        catch (error) {
            activeTab().results = { error: error.message };
            renderResults(resultsArea, { error: error.message });
            setStatus("Error");
            if (!isExplain)
                await appendHistory(session.conn.id, { id: String(started), sql: sql.slice(0, 4096), startedAt: started, durationMs: Date.now() - started, ok: false });
        }
        finally {
            runBtn.removeAttribute("disabled");
            historyPanel?.refresh();
        }
    }

    const runBtn = h("button", { class: "btn btn-primary", onclick: () => run("cursor") }, icon("play", 12), "Run");
    let historyPanel = null;
    let savedPanel = null;

    function togglePanel(kind) {
        qs.panel = qs.panel === kind ? null : kind;
        clear(sideWrap);
        if (!qs.panel) {
            sideWrap.style.display = "none";
            return;
        }
        sideWrap.style.display = "";
        if (qs.panel === "history") {
            historyPanel = renderHistoryPanel(session, { onPick: (sql) => insertSql(editor, sql) });
            sideWrap.appendChild(historyPanel);
        }
        else {
            savedPanel = renderSavedPanel(session, {
                onPick: (sql) => insertSql(editor, sql),
                getCurrentSql: () => (selectedSql(editor) ?? editor.state.doc.toString()),
            });
            sideWrap.appendChild(savedPanel);
        }
    }

    async function exportResults() {
        const results = activeTab().results?.results;
        const withRows = results?.find((r) => r.columns.length);
        if (!withRows) {
            toast("No result rows to export", "warning");
            return;
        }
        const { exportResult } = await import("../transfer/transfer.js");
        await exportResult(session.conn.engine, session.ref, withRows, "csv");
    }

    toolbar.append(
        runBtn,
        h("button", { class: "btn", title: "Run every statement in this tab", onclick: () => run("all") }, "Run All"),
        h("button", { class: "btn", title: "Explain the statement at the cursor", onclick: () => runExplain() }, "Explain"),
        h("span", { class: "text-[var(--font-footnote)] text-muted-foreground" }, "⌘⏎ statement · ⇧⌘⏎ all"),
        h("div", { class: "flex-1" }),
        h("button", { class: "icon-btn", title: "Export results as CSV", onclick: () => exportResults() }, icon("download")),
        h("button", { class: "icon-btn", title: "Query history", onclick: () => togglePanel("history") }, icon("clock")),
        h("button", { class: "icon-btn", title: "Saved queries", onclick: () => togglePanel("saved") }, icon("star")));

    session.queryHooks = {
        newTab: () => addTab(),
        run: () => run("cursor"),
    };

    renderTabs();
    mountEditor();
    renderResults(resultsArea, activeTab().results || {});
    const panelKind = qs.panel;
    qs.panel = null;
    if (panelKind)
        togglePanel(panelKind);
}
