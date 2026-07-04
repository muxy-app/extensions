import { h, clear } from "../lib/dom.js";
import { icon } from "../ui/icons.js";
import { FILTER_OPS } from "../lib/sql/select-builder.js";

export function renderFilterBar(container, { columns, state, onApply }) {
    clear(container);
    const rows = h("div", { class: "flex flex-wrap items-center gap-[var(--s3)]" });

    function addRow(filter) {
        const columnSelect = h("select", { style: "height: 24px" },
            h("option", { value: "" }, "column"),
            columns.map((c) => h("option", { value: c.name, selected: filter.column === c.name }, c.name)));
        const opSelect = h("select", { style: "height: 24px" },
            FILTER_OPS.map((op) => h("option", { value: op.id, selected: filter.op === op.id }, op.label)));
        const valueInput = h("input", { type: "text", placeholder: "value", value: filter.value ?? "", style: "height: 24px; width: 120px" });
        const syncValueVisibility = () => {
            const op = FILTER_OPS.find((o) => o.id === opSelect.value);
            valueInput.style.display = op && op.unary ? "none" : "";
        };
        opSelect.addEventListener("change", syncValueVisibility);
        syncValueVisibility();
        const remove = h("button", { class: "icon-btn", title: "Remove filter", onclick: () => { row.remove(); } }, icon("x", 12));
        const row = h("div", { class: "flex items-center gap-[var(--s2)]" }, columnSelect, opSelect, valueInput, remove);
        row._read = () => ({ column: columnSelect.value, op: opSelect.value, value: valueInput.value });
        rows.appendChild(row);
        return row;
    }

    for (const filter of state.filters.length ? state.filters : [])
        addRow(filter);

    const rawInput = h("input", { type: "text", class: "mono", placeholder: "raw WHERE (optional)", value: state.rawWhere || "", style: "height: 24px; flex: 1; min-width: 160px" });

    const apply = () => {
        state.filters = [...rows.children].map((r) => r._read()).filter((f) => f.column);
        state.rawWhere = rawInput.value;
        state.page = 0;
        onApply();
    };

    rawInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter")
            apply();
    });

    container.append(
        rows,
        h("div", { class: "flex items-center gap-[var(--s3)]" },
            h("button", { class: "icon-btn", title: "Add filter", onclick: () => addRow({}) }, icon("plus", 12)),
            rawInput,
            h("button", { class: "btn", style: "height: 24px", onclick: apply }, icon("filter", 12), "Apply")));
}
