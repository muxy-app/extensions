import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { ENGINES, COLORS, newConnection, saveConnection, listConnections } from "../lib/connections.js";
import { storePassword, setSessionPassword, hasKeychain, deletePassword } from "../lib/credentials.js";
import { getDriver } from "../lib/drivers/index.js";
import { buildContext } from "../workbench/state.js";

const SSL_MODES = {
    postgres: ["", "disable", "require", "verify-ca", "verify-full"],
    mysql: ["", "DISABLED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"],
    mariadb: ["", "DISABLED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"],
};

export function openConnectionForm(existing, { onSaved }) {
    const conn = existing ? JSON.parse(JSON.stringify(existing)) : newConnection("sqlite");
    const state = { conn, password: "", isNew: !existing };
    const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) close(); } });
    const sheet = h("div", { class: "sheet" });
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    render(sheet, state, close, onSaved);
}

function render(sheet, state, close, onSaved) {
    clear(sheet);
    const { conn } = state;
    const body = h("div", { class: "sheet-body" });
    const status = h("div", { class: "hidden" });

    const title = h("div", { class: "flex items-center gap-[var(--s4)] border-b px-[var(--s7)] py-[var(--s5)] text-[var(--font-title)] font-semibold", style: "border-color: var(--muxy-border)" },
        icon("database", 16),
        state.isNew ? "New Connection" : `Edit ${conn.name || "Connection"}`,
        h("div", { class: "flex-1" }),
        h("button", { class: "icon-btn", onclick: close }, icon("x")));

    if (state.isNew) {
        const seg = h("div", { class: "seg" });
        for (const [engine, def] of Object.entries(ENGINES)) {
            seg.appendChild(h("button", {
                class: conn.engine === engine ? "active" : "",
                onclick: () => {
                    const fresh = newConnection(engine);
                    fresh.id = conn.id;
                    fresh.name = conn.name;
                    fresh.group = conn.group;
                    fresh.color = conn.color;
                    state.conn = fresh;
                    render(sheet, state, close, onSaved);
                },
            }, def.label));
        }
        body.appendChild(h("div", { class: "field" }, h("label", null, "Engine"), seg));
    }

    const nameInput = field(body, "Name", conn.name, (v) => (conn.name = v));
    const groupInput = field(body, "Group (optional)", conn.group, (v) => (conn.group = v));
    listConnections().then((all) => {
        const groups = [...new Set(all.map((c) => c.group).filter(Boolean))];
        if (groups.length) {
            const dl = h("datalist", { id: "db-groups" });
            for (const g of groups)
                dl.appendChild(h("option", { value: g }));
            body.appendChild(dl);
            groupInput.setAttribute("list", "db-groups");
        }
    });

    const swatches = h("div", { class: "flex items-center gap-[var(--s3)]" });
    for (const color of COLORS) {
        const swatch = h("button", {
            class: "h-5 w-5 rounded-full",
            style: `background: ${color}; outline: ${conn.color === color ? "2px solid var(--muxy-accent)" : "none"}; outline-offset: 2px`,
            onclick: () => {
                conn.color = color;
                render(sheet, state, close, onSaved);
            },
        });
        swatches.appendChild(swatch);
    }
    body.appendChild(h("div", { class: "field" }, h("label", null, "Color"), swatches));

    if (conn.engine === "sqlite")
        renderSqliteFields(body, conn);
    else
        renderNetFields(body, conn, state);

    renderSshSection(body, conn);

    const footer = h("div", { class: "sheet-footer" },
        h("button", { class: "btn", onclick: () => testConnection(state, status) }, icon("bolt", 12), "Test"),
        h("div", { class: "flex-1" }),
        h("button", { class: "btn", onclick: close }, "Cancel"),
        h("button", { class: "btn btn-primary", onclick: () => save(state, close, onSaved) }, icon("check", 12), "Save"));

    status.className = "mx-[var(--s7)] mb-[var(--s5)] hidden";
    sheet.append(title, body, status, footer);
    setTimeout(() => nameInput.focus(), 0);
}

function field(parent, label, value, onInput, type = "text") {
    const input = h("input", { type, value: value ?? "", oninput: () => onInput(input.value) });
    parent.appendChild(h("div", { class: "field" }, h("label", null, label), input));
    return input;
}

function renderSqliteFields(body, conn) {
    const pathInput = h("input", { type: "text", class: "mono flex-1", value: conn.sqlite.path, placeholder: "/path/to/database.sqlite", oninput: () => (conn.sqlite.path = pathInput.value) });
    const pick = h("button", {
        class: "btn",
        onclick: async () => {
            const folder = await muxy.dialog.pickFolder({ title: "Choose database folder" });
            if (folder) {
                const name = conn.sqlite.path.split("/").pop() || "database.sqlite";
                conn.sqlite.path = `${folder}/${name}`;
                pathInput.value = conn.sqlite.path;
            }
        },
    }, icon("folder", 12));
    body.appendChild(h("div", { class: "field" },
        h("label", null, "Database file"),
        h("div", { class: "flex items-center gap-[var(--s3)]" }, pathInput, pick)));
}

function renderNetFields(body, conn, state) {
    const row = h("div", { class: "flex gap-[var(--s4)]" });
    const hostWrap = h("div", { class: "field flex-1" }, h("label", null, "Host"));
    const hostInput = h("input", { type: "text", value: conn.net.host, oninput: () => (conn.net.host = hostInput.value) });
    hostWrap.appendChild(hostInput);
    const portWrap = h("div", { class: "field w-24" }, h("label", null, "Port"));
    const portInput = h("input", { type: "number", value: conn.net.port ?? "", oninput: () => (conn.net.port = Number(portInput.value) || ENGINES[conn.engine].defaultPort) });
    portWrap.appendChild(portInput);
    row.append(hostWrap, portWrap);
    body.appendChild(row);

    field(body, "User", conn.net.user, (v) => (conn.net.user = v));

    const pwInput = h("input", {
        type: "password",
        placeholder: conn.keychain ? "Saved in Keychain — leave empty to keep" : "Password",
        oninput: () => (state.password = pwInput.value),
    });
    body.appendChild(h("div", { class: "field" }, h("label", null, "Password"), pwInput));

    field(body, "Database", conn.net.database, (v) => (conn.net.database = v));

    const sslSelect = h("select", { onchange: () => (conn.net.sslMode = sslSelect.value) });
    for (const mode of SSL_MODES[conn.engine] || [""])
        sslSelect.appendChild(h("option", { value: mode, selected: conn.net.sslMode === mode }, mode || "default"));
    body.appendChild(h("div", { class: "field" }, h("label", null, "SSL mode"), sslSelect));
}

function renderSshSection(body, conn) {
    if (conn.engine === "sqlite")
        return;
    const enabled = h("input", {
        type: "checkbox",
        checked: conn.ssh?.enabled || false,
        onchange: () => {
            if (enabled.checked)
                conn.ssh = conn.ssh || { enabled: true, host: "", port: 22, user: "", keyPath: "" };
            conn.ssh.enabled = enabled.checked;
            fields.style.display = enabled.checked ? "" : "none";
        },
    });
    const fields = h("div", { class: "flex flex-col gap-[var(--s5)]", style: conn.ssh?.enabled ? "" : "display: none" });
    const ssh = () => {
        conn.ssh = conn.ssh || { enabled: true, host: "", port: 22, user: "", keyPath: "" };
        return conn.ssh;
    };
    const row = h("div", { class: "flex gap-[var(--s4)]" });
    const hostWrap = h("div", { class: "field flex-1" }, h("label", null, "SSH host"));
    const hostInput = h("input", { type: "text", value: conn.ssh?.host || "", oninput: () => (ssh().host = hostInput.value) });
    hostWrap.appendChild(hostInput);
    const portWrap = h("div", { class: "field w-24" }, h("label", null, "SSH port"));
    const portInput = h("input", { type: "number", value: conn.ssh?.port || 22, oninput: () => (ssh().port = Number(portInput.value) || 22) });
    portWrap.appendChild(portInput);
    row.append(hostWrap, portWrap);

    const userInput = h("input", { type: "text", value: conn.ssh?.user || "", oninput: () => (ssh().user = userInput.value) });
    const keyInput = h("input", { type: "text", class: "mono", value: conn.ssh?.keyPath || "", placeholder: "Leave empty to use ssh-agent", oninput: () => (ssh().keyPath = keyInput.value) });
    fields.append(
        row,
        h("div", { class: "field" }, h("label", null, "SSH user"), userInput),
        h("div", { class: "field" }, h("label", null, "Private key path (optional)"), keyInput),
        h("div", { class: "text-[var(--font-footnote)] text-muted-foreground" }, "Authentication uses your ssh-agent or the key file. Password prompts are disabled."));

    body.appendChild(h("div", { class: "field" },
        h("label", { class: "flex items-center gap-[var(--s3)]" }, enabled, "Connect over SSH tunnel"),
        fields));
}

function validate(conn) {
    if (!conn.name.trim())
        return "Name is required";
    if (conn.engine === "sqlite" && !conn.sqlite.path.trim())
        return "Database file path is required";
    if (conn.engine !== "sqlite") {
        if (!conn.net.host.trim())
            return "Host is required";
        if (!conn.net.user.trim())
            return "User is required";
    }
    if (conn.ssh?.enabled && (!conn.ssh.host.trim() || !conn.ssh.user.trim()))
        return "SSH host and user are required for tunneling";
    return null;
}

function showStatus(status, message, ok) {
    status.className = `mx-[var(--s7)] mb-[var(--s5)] rounded-[var(--radius-card)] border px-[var(--s5)] py-[var(--s4)] text-[var(--font-body)]`;
    status.style.borderColor = ok ? "var(--muxy-diff-add)" : "var(--muxy-diff-remove)";
    status.style.color = ok ? "var(--muxy-diff-add)" : "var(--muxy-diff-remove)";
    status.textContent = message;
}

async function applyPassword(state) {
    if (!state.password)
        return;
    if (await hasKeychain()) {
        await storePassword(state.conn.id, state.password);
        state.conn.keychain = true;
    }
    else {
        setSessionPassword(state.conn.id, state.password);
        state.conn.keychain = false;
    }
}

async function testConnection(state, status) {
    const problem = validate(state.conn);
    if (problem) {
        showStatus(status, problem, false);
        return;
    }
    showStatus(status, "Testing…", true);
    try {
        const driver = getDriver(state.conn.engine);
        const detection = await driver.detect();
        if (!detection.available)
            throw new Error(`Client not found. Install: ${detection.installHint}`);
        if (state.password)
            setSessionPassword(state.conn.id, state.password);
        const ctx = await buildContext(state.conn);
        const { serverVersion } = await driver.test(ctx);
        showStatus(status, `Connected — ${serverVersion || "OK"}`, true);
    }
    catch (error) {
        showStatus(status, error.message, false);
    }
}

async function save(state, close, onSaved) {
    const problem = validate(state.conn);
    if (problem) {
        toast(problem, "warning");
        return;
    }
    try {
        await applyPassword(state);
        await saveConnection(state.conn);
        toast("Connection saved", "success");
        close();
        onSaved();
    }
    catch (error) {
        toast(error.message, "warning");
    }
}
