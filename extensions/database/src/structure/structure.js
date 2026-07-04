import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { tableInfo } from "../workbench/state.js";
import { quoteIdent, qualifiedName } from "../lib/sql/quote.js";
import { getPref } from "../lib/storage.js";

function table(headers, rows) {
    return h("table", { class: "grid-table", style: "font-family: inherit" },
        h("thead", null, h("tr", null, headers.map((head) => h("th", null, head)))),
        h("tbody", null, rows.length
            ? rows.map((row) => h("tr", null, row.map((cell) => h("td", { style: "max-width: none; white-space: normal" }, cell === null ? h("span", { class: "null-badge" }, "—") : String(cell)))))
            : h("tr", null, h("td", { colspan: headers.length, class: "text-muted-foreground" }, "None"))));
}

function section(title, node) {
    return h("div", { class: "flex flex-col gap-[var(--s3)]" },
        h("div", { class: "section-label" }, title),
        node);
}

export async function renderStructureView(container, session, { setStatus, reloadTables }) {
    clear(container);
    if (!session.ref) {
        container.appendChild(h("div", { class: "flex h-full flex-col items-center justify-center gap-[var(--s4)] text-muted-foreground" },
            icon("columns", 24),
            "Select a table to inspect its structure"));
        return;
    }
    const ref = session.ref;
    const scroll = h("div", { class: "flex-1 overflow-y-auto p-[var(--s7)]" });
    container.appendChild(scroll);
    scroll.appendChild(h("div", { class: "text-muted-foreground" }, "Loading…"));

    try {
        const info = await tableInfo(session, ref, true);
        const ddl = await session.driver.ddl(session.ctx, ref).catch(() => "");
        clear(scroll);

        const confirmDestructive = await getPref("confirmDestructive");
        const engine = session.conn.engine;
        const actions = h("div", { class: "flex items-center gap-[var(--s3)]" });
        if (ref.kind !== "view") {
            actions.append(
                h("button", { class: "btn", onclick: () => openIndexDesigner(session, ref, info, reloadStructure) }, icon("plus", 12), "Index"),
                h("button", { class: "btn btn-danger", onclick: () => truncate() }, "Truncate"),
                h("button", { class: "btn btn-danger", onclick: () => drop() }, icon("trash", 12), "Drop"));
        }

        scroll.append(
            h("div", { class: "mb-[var(--s6)] flex items-center gap-[var(--s4)]" },
                h("div", { class: "text-[var(--font-title)] font-semibold" }, ref.table),
                h("span", { class: "text-[var(--font-footnote)] text-muted-foreground" }, ref.kind === "view" ? "view" : "table"),
                h("div", { class: "flex-1" }),
                actions),
            h("div", { class: "flex flex-col gap-[var(--s7)]" },
                section("Columns", table(
                    ["Name", "Type", "Nullable", "Default", "Key"],
                    info.columns.map((c) => [c.name, c.type, c.nullable ? "YES" : "NO", c.default, c.isPk ? "PRIMARY" : (c.autoIncrement ? "AUTO" : "")]))),
                section("Indexes", table(
                    ["Name", "Unique", "Columns"],
                    info.indexes.map((i) => [i.name, i.unique ? "YES" : "NO", (i.columns || []).join(", ")]))),
                section("Foreign keys", table(
                    ["Column", "References", "On delete"],
                    info.foreignKeys.map((f) => [f.column, `${f.refTable}(${f.refColumn})`, f.onDelete || ""]))),
                info.triggers?.length
                    ? section("Triggers", table(["Name", "Definition"], info.triggers.map((t) => [t.name, t.definition || ""])))
                    : null,
                ddl ? section("DDL", h("pre", { class: "mono error-box", style: "color: var(--muxy-foreground); border-color: var(--muxy-border); max-height: 260px; overflow: auto" }, ddl)) : null));

        function reloadStructure() {
            session.infoCache.delete(`${ref.database || ""}.${ref.schema || ""}.${ref.table}`);
            renderStructureView(container, session, { setStatus, reloadTables });
        }

        async function runDestructive(sql, label) {
            if (confirmDestructive) {
                const choice = await muxy.dialog.confirm({
                    title: label,
                    message: `Run:\n\n${sql}`,
                    buttons: [label, "Cancel"],
                    cancel: "Cancel",
                    style: "warning",
                });
                if (choice !== label)
                    return;
            }
            try {
                await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
                toast(`${label} succeeded`, "success");
                return true;
            }
            catch (error) {
                toast(error.message, "warning");
                return false;
            }
        }

        async function truncate() {
            const sql = engine === "sqlite" ? `DELETE FROM ${qualifiedName(engine, ref)}` : `TRUNCATE TABLE ${qualifiedName(engine, ref)}`;
            await runDestructive(sql, "Truncate");
        }

        async function drop() {
            const ok = await runDestructive(`DROP ${ref.kind === "view" ? "VIEW" : "TABLE"} ${qualifiedName(engine, ref)}`, "Drop");
            if (ok) {
                session.ref = null;
                await reloadTables();
            }
        }
    }
    catch (error) {
        clear(scroll);
        scroll.appendChild(h("div", { class: "error-box" }, error.message));
    }
}

function openIndexDesigner(session, ref, info, onDone) {
    const engine = session.conn.engine;
    const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
    const nameInput = h("input", { type: "text", placeholder: `idx_${ref.table}` });
    const unique = h("input", { type: "checkbox" });
    const columnBoxes = info.columns.map((c) => {
        const cb = h("input", { type: "checkbox", value: c.name });
        return { cb, name: c.name, node: h("label", { class: "flex items-center gap-[var(--s3)]" }, cb, c.name) };
    });
    const preview = h("pre", { class: "mono error-box", style: "color: var(--muxy-foreground); border-color: var(--muxy-border)" });
    const update = () => {
        const cols = columnBoxes.filter((b) => b.cb.checked).map((b) => quoteIdent(engine, b.name));
        const name = nameInput.value || `idx_${ref.table}`;
        preview.textContent = cols.length
            ? `CREATE ${unique.checked ? "UNIQUE " : ""}INDEX ${quoteIdent(engine, name)} ON ${qualifiedName(engine, ref)} (${cols.join(", ")});`
            : "Select at least one column";
    };
    for (const b of columnBoxes)
        b.cb.addEventListener("change", update);
    nameInput.addEventListener("input", update);
    unique.addEventListener("change", update);
    update();

    const sheet = h("div", { class: "sheet" },
        h("div", { class: "flex items-center gap-[var(--s4)] border-b px-[var(--s7)] py-[var(--s5)] text-[var(--font-title)] font-semibold", style: "border-color: var(--muxy-border)" },
            icon("bolt", 16), "New index", h("div", { class: "flex-1" }), h("button", { class: "icon-btn", onclick: () => backdrop.remove() }, icon("x"))),
        h("div", { class: "sheet-body" },
            h("div", { class: "field" }, h("label", null, "Index name"), nameInput),
            h("label", { class: "flex items-center gap-[var(--s3)]" }, unique, "Unique"),
            h("div", { class: "field" }, h("label", null, "Columns"), h("div", { class: "flex flex-col gap-[var(--s2)]" }, columnBoxes.map((b) => b.node))),
            h("div", { class: "field" }, h("label", null, "SQL"), preview)),
        h("div", { class: "sheet-footer" },
            h("button", { class: "btn", onclick: () => backdrop.remove() }, "Cancel"),
            h("button", {
                class: "btn btn-primary",
                onclick: async () => {
                    const cols = columnBoxes.filter((b) => b.cb.checked);
                    if (!cols.length)
                        return;
                    try {
                        await session.driver.runQuery(session.ctx, preview.textContent, { timeoutMs: session.timeoutMs });
                        toast("Index created", "success");
                        backdrop.remove();
                        onDone();
                    }
                    catch (error) {
                        toast(error.message, "warning");
                    }
                },
            }, "Create")));
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    setTimeout(() => nameInput.focus(), 0);
}
