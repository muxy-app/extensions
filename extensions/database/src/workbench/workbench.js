import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { ENGINES } from "../lib/connections.js";
import { openSession, loadTables, loadColumns } from "./state.js";
import { closeTunnel } from "../lib/tunnel.js";
import { clearCredFiles } from "../lib/cred-file.js";
import { renderTopbar } from "./topbar.js";
import { renderSidebar } from "./sidebar.js";
import { renderDataView } from "../grid/data-view.js";
import { renderQueryView } from "../editor/query-view.js";
import { renderStructureView } from "../structure/structure.js";
import { openTableDesigner } from "../structure/table-designer.js";
import { openTransferMenu } from "../transfer/transfer.js";
import { tableInfo } from "./state.js";

const ENGINE_ICONS = { sqlite: "database", postgres: "database", mysql: "database", mariadb: "database" };

export async function renderWorkbench(root, conn, { onClose, onSession }) {
    clear(root);
    root.appendChild(h("div", { class: "flex h-full flex-col items-center justify-center gap-[var(--s4)] text-muted-foreground" },
        icon("database", 24),
        `Connecting to ${conn.name}…`));

    let session;
    try {
        session = await openSession(conn);
        await loadTables(session);
    }
    catch (error) {
        renderError(root, conn, error, onClose);
        return;
    }

    onSession?.(session);
    muxy.tabs?.setTitle?.(conn.name).catch?.(() => undefined);
    muxy.tabs?.setIcon?.({ symbol: "cylinder.split.1x2" }).catch?.(() => undefined);
    window.addEventListener("pagehide", () => {
        clearCredFiles(conn.id).catch(() => undefined);
        if (conn.ssh?.enabled)
            closeTunnel(conn).catch(() => undefined);
    }, { once: true });
    clear(root);

    const main = h("div", { class: "flex min-h-0 min-w-0 flex-1 flex-col" });
    const statusLeft = h("span", { class: "truncate" }, "Ready");
    const setStatus = (text) => (statusLeft.textContent = text);

    const topbar = renderTopbar(session, {
        onViewChange: (view) => {
            session.view = view;
            topbar.setView(view);
            renderMain();
        },
        onRefresh: async () => {
            session.infoCache.clear();
            await loadTables(session);
            loadColumns(session);
            sidebar.refresh();
            renderMain();
        },
        onScopeChange: async (scope) => {
            if (scope.database !== undefined) {
                session.ctx.database = scope.database;
                session.ctx.schema = conn.engine === "postgres" ? "public" : "";
            }
            if (scope.schema !== undefined)
                session.ctx.schema = scope.schema;
            session.ref = null;
            session.infoCache.clear();
            session.gridState.clear();
            await loadTables(session);
            loadColumns(session);
            sidebar.refresh();
            renderMain();
        },
    });

    const reloadTables = async () => {
        session.infoCache.clear();
        await loadTables(session);
        loadColumns(session);
        sidebar.refresh();
        renderMain();
    };

    const sidebar = renderSidebar(session, {
        onSelect: async (ref) => {
            session.ref = ref;
            sidebar.refresh();
            if (session.view === "query")
                session.view = "data";
            topbar.setView(session.view);
            renderMain();
            tableInfo(session, ref).catch(() => undefined);
        },
        onNewTable: () => openTableDesigner(session, { onDone: reloadTables }),
        onTransfer: () => openTransferMenu(session, session.ref),
    });

    const statusbar = h("div", { class: "statusbar" },
        statusLeft,
        h("div", { class: "flex-1" }),
        h("span", null, `${ENGINES[conn.engine].label}${session.serverVersion ? " " + session.serverVersion : ""}`),
        conn.ssh?.enabled ? h("span", { class: "flex items-center gap-[var(--s2)]" }, icon("link", 10), "SSH") : null);

    const body = h("div", { class: "flex min-h-0 flex-1" }, sidebar, main);
    root.appendChild(h("div", { class: "flex h-full flex-col" }, topbar, body, statusbar));

    async function renderMain() {
        clear(main);
        if (session.view === "query") {
            await renderQueryView(main, session, { setStatus });
            return;
        }
        if (session.view === "structure") {
            await renderStructureView(main, session, { setStatus, reloadTables });
            return;
        }
        await renderDataView(main, session, { setStatus });
    }

    session.requestQueryView = async (action) => {
        if (session.view !== "query") {
            session.view = "query";
            topbar.setView("query");
            await renderMain();
        }
        if (action === "new")
            session.queryHooks?.newTab();
    };

    loadColumns(session);
    renderMain();
}

function renderError(root, conn, error, onClose) {
    clear(root);
    root.appendChild(h("div", { class: "flex h-full flex-col items-center justify-center gap-[var(--s5)] p-[var(--s8)]" },
        icon("warning", 28),
        h("div", { class: "text-[var(--font-title)] font-semibold" }, `Could not connect to ${conn.name}`),
        h("div", { class: "error-box", style: "max-width: 560px" }, error.message),
        h("button", { class: "btn", onclick: () => onClose?.() }, icon("x", 12), "Close")));
}
