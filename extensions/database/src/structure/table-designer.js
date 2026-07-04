import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { quoteIdent } from "../lib/sql/quote.js";

const TYPE_SUGGESTIONS = {
    sqlite: ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"],
    postgres: ["integer", "bigint", "serial", "text", "varchar(255)", "boolean", "timestamptz", "numeric", "jsonb"],
    mysql: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATETIME", "DECIMAL(10,2)", "JSON"],
    mariadb: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATETIME", "DECIMAL(10,2)", "JSON"],
};

export function openTableDesigner(session, { onDone }) {
    const engine = session.conn.engine;
    const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
    const nameInput = h("input", { type: "text", placeholder: "table_name" });
    const columns = [newColumn()];
    const columnHost = h("div", { class: "flex flex-col gap-[var(--s3)]" });
    const preview = h("pre", { class: "mono error-box", style: "color: var(--muxy-foreground); border-color: var(--muxy-border); white-space: pre-wrap" });

    function newColumn() {
        return { name: "", type: TYPE_SUGGESTIONS[engine][0], pk: false, notNull: false };
    }

    function buildSql() {
        const tableName = nameInput.value.trim();
        if (!tableName)
            return "-- enter a table name";
        const defs = columns.filter((c) => c.name.trim()).map((c) => {
            let line = `  ${quoteIdent(engine, c.name.trim())} ${c.type || "TEXT"}`;
            if (c.pk && engine === "sqlite" && /int/i.test(c.type))
                line += " PRIMARY KEY";
            else if (c.pk)
                line += " PRIMARY KEY";
            if (c.notNull && !c.pk)
                line += " NOT NULL";
            return line;
        });
        if (!defs.length)
            return "-- add at least one column";
        return `CREATE TABLE ${quoteIdent(engine, tableName)} (\n${defs.join(",\n")}\n);`;
    }

    function update() {
        preview.textContent = buildSql();
    }

    function renderColumns() {
        clear(columnHost);
        columns.forEach((col, index) => {
            const name = h("input", { type: "text", placeholder: "column", value: col.name, style: "flex: 1", oninput: () => { col.name = name.value; update(); } });
            const type = h("input", { type: "text", list: "db-types", value: col.type, style: "width: 130px", oninput: () => { col.type = type.value; update(); } });
            const pk = h("input", { type: "checkbox", checked: col.pk, onchange: () => { col.pk = pk.checked; update(); } });
            const nn = h("input", { type: "checkbox", checked: col.notNull, onchange: () => { col.notNull = nn.checked; update(); } });
            const remove = h("button", { class: "icon-btn", title: "Remove column", onclick: () => { columns.splice(index, 1); if (!columns.length) columns.push(newColumn()); renderColumns(); update(); } }, icon("x", 12));
            columnHost.appendChild(h("div", { class: "flex items-center gap-[var(--s3)]" },
                name, type,
                h("label", { class: "flex items-center gap-[var(--s2)] text-[var(--font-footnote)]" }, pk, "PK"),
                h("label", { class: "flex items-center gap-[var(--s2)] text-[var(--font-footnote)]" }, nn, "NN"),
                remove));
        });
    }

    nameInput.addEventListener("input", update);
    renderColumns();
    update();

    const datalist = h("datalist", { id: "db-types" }, TYPE_SUGGESTIONS[engine].map((t) => h("option", { value: t })));

    const sheet = h("div", { class: "sheet", style: "width: 560px" },
        h("div", { class: "flex items-center gap-[var(--s4)] border-b px-[var(--s7)] py-[var(--s5)] text-[var(--font-title)] font-semibold", style: "border-color: var(--muxy-border)" },
            icon("table", 16), "New table", h("div", { class: "flex-1" }), h("button", { class: "icon-btn", onclick: () => backdrop.remove() }, icon("x"))),
        h("div", { class: "sheet-body" },
            datalist,
            h("div", { class: "field" }, h("label", null, "Table name"), nameInput),
            h("div", { class: "field" },
                h("div", { class: "flex items-center" }, h("label", { class: "flex-1" }, "Columns"), h("button", { class: "btn", style: "height: 22px", onclick: () => { columns.push(newColumn()); renderColumns(); update(); } }, icon("plus", 10), "Column")),
                columnHost),
            h("div", { class: "field" }, h("label", null, "SQL"), preview)),
        h("div", { class: "sheet-footer" },
            h("button", { class: "btn", onclick: () => backdrop.remove() }, "Cancel"),
            h("button", {
                class: "btn btn-primary",
                onclick: async () => {
                    const sql = buildSql();
                    if (sql.startsWith("--"))
                        return;
                    try {
                        await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
                        toast("Table created", "success");
                        backdrop.remove();
                        onDone();
                    }
                    catch (error) {
                        toast(error.message, "warning");
                    }
                },
            }, "Create table")));
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    setTimeout(() => nameInput.focus(), 0);
}
