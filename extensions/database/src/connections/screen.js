import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { ENGINES, listConnections, deleteConnection, duplicateConnection, parseConnectionUrl, saveConnection } from "../lib/connections.js";
import { deletePassword, setSessionPassword, storePassword, hasKeychain } from "../lib/credentials.js";
import { detect } from "../lib/cli-detect.js";
import { openConnectionForm } from "./form.js";

export async function renderLauncher(root, { onOpen, variant = "tab" }) {
    clear(root);
    const container = h("div", { class: "flex h-full flex-col" });
    root.appendChild(container);
    await renderContent(container, { onOpen, variant });
}

function connectionTarget(conn) {
    if (conn.engine === "sqlite")
        return conn.sqlite.path || "no file selected";
    const net = conn.net;
    return `${net.user ? net.user + "@" : ""}${net.host}:${net.port}${net.database ? "/" + net.database : ""}${conn.ssh?.enabled ? " via SSH" : ""}`;
}

async function renderContent(container, opts) {
    clear(container);
    const connections = await listConnections();
    const refresh = () => renderContent(container, opts);
    const panel = opts.variant === "panel";

    const search = h("input", {
        type: "text",
        placeholder: "Search",
        class: `${panel ? "flex-1" : "w-56"} h-[22px]`,
        oninput: () => renderList(list, connections, search.value, opts, refresh),
    });

    const hasSsh = connections.some((c) => c.ssh?.enabled);
    const header = panel
        ? h("div", { class: "flex items-center gap-[var(--s3)] border-b px-[var(--s4)] py-[var(--s3)]", style: "border-color: var(--muxy-border)" },
            search,
            hasSsh ? h("button", { class: "icon-btn", title: "Close all SSH tunnels", onclick: () => closeAllTunnels() }, icon("link")) : null,
            h("button", { class: "icon-btn", title: "New connection", onclick: () => openNew(opts, refresh) }, icon("plus")))
        : h("div", { class: "topbar" },
            h("div", { class: "flex items-center gap-[var(--s3)] text-[var(--font-emphasis)] font-semibold" }, icon("database", 14), "Connections"),
            h("div", { class: "flex-1" }),
            search,
            connections.length > 1
                ? h("button", { class: "btn btn-sm", title: "Quick connect", onclick: () => quickConnect(opts.onOpen) }, icon("bolt", 12), "Quick connect")
                : null,
            hasSsh ? h("button", { class: "btn btn-sm", title: "Close all SSH tunnels", onclick: () => closeAllTunnels() }, icon("link", 12), "Close tunnels") : null,
            h("button", { class: "btn btn-sm btn-primary", onclick: () => openNew(opts, refresh) }, icon("plus", 12), "New Connection"));

    const list = h("div", { class: `flex-1 overflow-y-auto ${panel ? "px-[var(--s3)] py-[var(--s3)]" : "px-[var(--s7)] py-[var(--s6)]"}` });
    container.append(header, list);
    renderList(list, connections, "", opts, refresh);
}

function openNew(opts, refresh) {
    openConnectionForm(null, { onSaved: refresh });
}

function renderList(list, connections, query, opts, refresh) {
    clear(list);
    const term = query.trim().toLowerCase();
    const filtered = connections.filter((c) =>
        !term || c.name.toLowerCase().includes(term) || connectionTarget(c).toLowerCase().includes(term) || (c.group || "").toLowerCase().includes(term));

    if (!connections.length) {
        list.appendChild(renderEmpty(opts, refresh));
        return;
    }
    if (!filtered.length) {
        list.appendChild(h("div", { class: "py-[var(--s8)] text-center text-muted-foreground" }, "No connections match your search"));
        return;
    }

    const groups = new Map();
    for (const conn of filtered) {
        const key = conn.group || "";
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(conn);
    }
    const sorted = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    for (const group of sorted) {
        if (group)
            list.appendChild(h("div", { class: "section-label mb-[var(--s3)] mt-[var(--s5)]" }, group));
        const wrap = h("div", { class: `flex flex-col ${opts.variant === "panel" ? "gap-[var(--s2)]" : "gap-[var(--s3)]"}` });
        for (const conn of groups.get(group).sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name)))
            wrap.appendChild(renderCard(conn, opts, refresh));
        list.appendChild(wrap);
    }
    if (opts.variant !== "panel")
        list.appendChild(renderImportRow(refresh));
}

function renderCard(conn, opts, refresh) {
    const panel = opts.variant === "panel";
    const actions = h("div", { class: "hidden items-center gap-[var(--s1)] group-hover:flex" },
        actionBtn("pencil", "Edit", (e) => {
            e.stopPropagation();
            openConnectionForm(conn, { onSaved: refresh });
        }),
        actionBtn("copy", "Duplicate", async (e) => {
            e.stopPropagation();
            await duplicateConnection(conn.id);
            refresh();
        }),
        actionBtn("trash", "Delete", async (e) => {
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
            refresh();
        }));

    return h("div", { class: `card group flex cursor-default items-center gap-[var(--s4)] ${panel ? "!p-[var(--s3)]" : ""}`, onclick: () => opts.onOpen(conn) },
        h("div", { class: "h-2.5 w-2.5 flex-shrink-0 rounded-full", style: `background: ${conn.color}` }),
        h("div", { class: "min-w-0 flex-1" },
            h("div", { class: "truncate text-[var(--font-body)] font-semibold" }, conn.name || "Untitled"),
            h("div", { class: "mono truncate text-[var(--font-caption)] text-muted-foreground" }, `${ENGINES[conn.engine].label} · ${connectionTarget(conn)}`)),
        actions);
}

function actionBtn(name, title, onclick) {
    return h("button", { class: "icon-btn", title, onclick }, icon(name));
}

function renderEmpty(opts, refresh) {
    const panel = opts.variant === "panel";
    const hints = h("div", { class: "mt-[var(--s6)] flex flex-col gap-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground" });
    engineAvailability().then((availability) => {
        for (const [engine, def] of Object.entries(ENGINES)) {
            const info = availability[engine];
            hints.appendChild(h("div", { class: "flex items-center gap-[var(--s3)]" },
                h("span", { style: `color: var(${info.available ? "--muxy-diff-add" : "--muxy-diff-remove"})` }, info.available ? "✓" : "✕"),
                h("span", { class: "font-semibold" }, def.label),
                h("span", { class: "mono truncate" }, info.available ? "installed" : "not found")));
        }
    });
    return h("div", { class: "flex h-full flex-col items-center justify-center gap-[var(--s5)] px-[var(--s5)] py-[var(--s8)] text-center" },
        icon("database", panel ? 24 : 32),
        h("div", { class: "text-[var(--font-emphasis)] font-semibold" }, "No connections yet"),
        h("div", { class: `${panel ? "text-[var(--font-footnote)]" : "max-w-80"} text-muted-foreground` }, "Add a connection to browse and query your databases."),
        h("button", { class: "btn btn-sm btn-primary", onclick: () => openNew(opts, refresh) }, icon("plus", 12), "New Connection"),
        panel ? null : renderImportRow(refresh),
        hints);
}

function renderImportRow(refresh) {
    const input = h("input", { type: "text", placeholder: "Paste a connection URL or SQLite path", class: "mono w-96" });
    const importIt = async () => {
        const parsed = parseConnectionUrl(input.value);
        if (!parsed) {
            toast("Could not parse that URL", "warning");
            return;
        }
        const { conn, password } = parsed;
        if (password) {
            if (await hasKeychain()) {
                await storePassword(conn.id, password);
                conn.keychain = true;
            }
            else {
                setSessionPassword(conn.id, password);
            }
        }
        await saveConnection(conn);
        toast("Connection imported", "success");
        refresh();
    };
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter")
            importIt();
    });
    return h("div", { class: "mt-[var(--s7)] flex items-center gap-[var(--s4)]" },
        input,
        h("button", { class: "btn", onclick: importIt }, icon("link", 12), "Import"));
}

async function closeAllTunnels() {
    const { sweepTunnels } = await import("../lib/tunnel.js");
    await sweepTunnels();
    toast("Closed idle tunnels", "success");
}

export async function quickConnect(onOpen) {
    const connections = await listConnections();
    if (!connections.length)
        return false;
    return new Promise((resolve) => {
        muxy.modal.open({
            placeholder: "Connect to database…",
            items: connections
                .slice()
                .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                .map((c) => ({ id: c.id, title: c.name || "Untitled", subtitle: `${ENGINES[c.engine].label} · ${connectionTarget(c)}` })),
            onSelect: (choice) => {
                if (choice) {
                    const conn = connections.find((c) => c.id === choice.id);
                    if (conn)
                        onOpen(conn);
                }
                resolve(!!choice);
            },
        });
    });
}

export async function engineAvailability() {
    const out = {};
    for (const [engine, def] of Object.entries(ENGINES))
        out[engine] = await detect(def.binaries[0]);
    return out;
}
