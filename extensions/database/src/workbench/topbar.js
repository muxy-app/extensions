import { h } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { ENGINES } from "../lib/connections.js";

const VIEWS = [
    { id: "data", label: "Data", icon: "grid" },
    { id: "structure", label: "Structure", icon: "columns" },
    { id: "query", label: "Query", icon: "code" },
];

export function renderTopbar(session, { onViewChange, onRefresh, onScopeChange }) {
    const seg = h("div", { class: "seg" });
    const buttons = new Map();
    for (const view of VIEWS) {
        const btn = h("button", {
            class: session.view === view.id ? "active" : "",
            onclick: () => onViewChange(view.id),
        }, icon(view.icon, 12), view.label);
        buttons.set(view.id, btn);
        seg.appendChild(btn);
    }

    const scope = h("div", { class: "flex items-center gap-[var(--s3)]" });
    populateScope(scope, session, onScopeChange);

    const bar = h("div", { class: "topbar" },
        h("div", { class: "ml-[var(--s2)] h-3 w-3 flex-shrink-0 rounded-full", style: `background: ${session.conn.color}` }),
        h("div", { class: "truncate text-[var(--font-emphasis)] font-semibold" }, session.conn.name),
        h("div", { class: "truncate text-[var(--font-footnote)] text-muted-foreground" },
            `${ENGINES[session.conn.engine].label}${session.serverVersion ? " " + session.serverVersion : ""}`),
        scope,
        h("div", { class: "flex-1" }),
        seg,
        h("button", { class: "icon-btn", title: "Refresh schema", onclick: onRefresh }, icon("refresh")));

    bar.setView = (id) => {
        for (const [viewId, btn] of buttons)
            btn.className = viewId === id ? "active" : "";
    };
    return bar;
}

async function populateScope(scope, session, onScopeChange) {
    const caps = session.driver.capabilities;
    try {
        if (caps.databases) {
            const databases = await session.driver.listDatabases(session.ctx);
            const current = session.ctx.database || session.conn.net?.database || "";
            if (current && !databases.includes(current))
                databases.unshift(current);
            const select = h("select", {
                title: "Database",
                onchange: () => onScopeChange({ database: select.value }),
            }, databases.map((name) => h("option", { value: name, selected: name === current }, name)));
            if (!current)
                select.prepend(h("option", { value: "", selected: true, disabled: true }, "database…"));
            scope.appendChild(select);
        }
        if (caps.schemas) {
            const schemas = await session.driver.listSchemas(session.ctx);
            const current = session.ctx.schema || "public";
            if (!schemas.includes(current))
                schemas.unshift(current);
            const select = h("select", {
                title: "Schema",
                onchange: () => onScopeChange({ schema: select.value }),
            }, schemas.map((name) => h("option", { value: name, selected: name === current }, name)));
            scope.appendChild(select);
        }
    }
    catch {
    }
}
