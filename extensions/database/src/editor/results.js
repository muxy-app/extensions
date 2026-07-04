import { h, clear, formatNumber } from "../lib/dom.js";
import { renderGrid } from "../grid/grid.js";

export function renderResults(container, { results, error }) {
    clear(container);
    if (error) {
        container.appendChild(h("div", { class: "p-[var(--s5)]" }, h("div", { class: "error-box" }, error)));
        return;
    }
    if (!results || !results.length) {
        container.appendChild(h("div", { class: "flex h-full items-center justify-center text-muted-foreground" }, "Run a query to see results"));
        return;
    }
    const stack = h("div", { class: "flex h-full flex-col gap-[var(--s4)] overflow-y-auto p-[var(--s4)]" });
    container.appendChild(stack);
    results.forEach((result, index) => {
        const block = h("div", { class: "flex min-h-0 flex-col rounded-[var(--radius-card)] border", style: "border-color: var(--muxy-border); max-height: 100%" });
        const meta = [];
        if (result.columns.length)
            meta.push(`${formatNumber(result.rows.length)} row${result.rows.length === 1 ? "" : "s"}`);
        if (result.affectedRows != null && !result.columns.length)
            meta.push(`${formatNumber(result.affectedRows)} affected`);
        if (result.commandTag)
            meta.push(result.commandTag);
        meta.push(`${result.durationMs}ms`);
        block.appendChild(h("div", {
            class: "flex items-center gap-[var(--s4)] border-b px-[var(--s4)] py-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground",
            style: "border-color: var(--muxy-border)",
        }, results.length > 1 ? `#${index + 1}` : "Result", h("div", { class: "flex-1" }), meta.join(" · ")));
        if (result.columns.length) {
            const gridHost = h("div", { class: "flex min-h-0 flex-col", style: "max-height: 320px" });
            renderGrid(gridHost, result);
            block.appendChild(gridHost);
        }
        else {
            block.appendChild(h("div", { class: "px-[var(--s4)] py-[var(--s3)] text-muted-foreground" },
                result.affectedRows != null ? `OK — ${formatNumber(result.affectedRows)} row${result.affectedRows === 1 ? "" : "s"} affected` : "OK"));
        }
        stack.appendChild(block);
    });
}
