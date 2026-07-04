import { clear, h } from "./lib/dom.js";
import { icon } from "./ui/icons.js";
import { getConnection, touchConnection } from "./lib/connections.js";
import { renderWorkbench } from "./workbench/workbench.js";
import { pendingChangeCount } from "./grid/data-view.js";

let root;
let activeSession = null;

export function start(rootEl) {
    root = rootEl;
    const muxy = window.muxy;
    route(muxy?.data);
    if (!muxy)
        return;
    muxy.onDataChange?.((data) => route(data));
    muxy.events?.subscribe?.("command.new-query", () => {
        if (muxy.focused === false || !activeSession)
            return;
        activeSession.requestQueryView?.("new");
    });
    muxy.events?.subscribe?.("command.run-query", () => {
        if (muxy.focused === false || !activeSession)
            return;
        if (activeSession.queryHooks)
            activeSession.queryHooks.run();
        else
            activeSession.requestQueryView?.();
    });
    muxy.lifecycle?.onBeforeClose?.(async () => {
        if (!activeSession)
            return false;
        const count = pendingChangeCount(activeSession);
        if (!count)
            return false;
        const choice = await muxy.dialog.confirm({
            title: "Discard pending changes?",
            message: `${count} unapplied change${count === 1 ? "" : "s"} will be lost.`,
            buttons: ["Discard & Close", "Cancel"],
            cancel: "Cancel",
            style: "warning",
        });
        return choice !== "Discard & Close";
    });
}

async function route(data) {
    if (!window.muxy) {
        clear(root);
        root.appendChild(h("div", { class: "flex h-full items-center justify-center text-muted-foreground" }, "This page must run inside Muxy"));
        return;
    }
    const connectionId = data?.connectionId;
    if (connectionId) {
        const conn = await getConnection(connectionId);
        if (conn) {
            touchConnection(conn.id);
            openWorkbench(conn);
            return;
        }
    }
    renderMissing();
}

function renderMissing() {
    activeSession = null;
    clear(root);
    root.appendChild(h("div", { class: "flex h-full flex-col items-center justify-center gap-[var(--s4)] text-muted-foreground" },
        icon("database", 24),
        "Open a database from the Databases panel"));
}

function openWorkbench(conn) {
    renderWorkbench(root, conn, {
        onClose: () => muxy.lifecycle?.close?.(),
        onSession: (session) => (activeSession = session),
    });
}
