import { h, clear, formatNumber } from "../lib/dom.js";
import { icon } from "../ui/icons.js";

export function renderPager(container, state, { onPage, onCount }) {
    clear(container);
    const { page, pageSize, rowsOnPage, total } = state;
    const from = page * pageSize + 1;
    const to = page * pageSize + rowsOnPage;
    const label = rowsOnPage
        ? `${formatNumber(from)}–${formatNumber(to)}${total != null ? ` of ${formatNumber(total)}` : ""}`
        : "No rows";
    const lastPage = total != null ? Math.max(0, Math.ceil(total / pageSize) - 1) : null;

    container.append(
        h("button", { class: "icon-btn", disabled: page === 0, onclick: () => onPage(page - 1), title: "Previous page" }, icon("left", 12)),
        h("span", { class: "mono text-[var(--font-footnote)] text-muted-foreground" }, label),
        h("button", {
            class: "icon-btn",
            disabled: rowsOnPage < pageSize && total == null || (lastPage != null && page >= lastPage),
            onclick: () => onPage(page + 1),
            title: "Next page",
        }, icon("right", 12)),
        total == null
            ? h("button", { class: "btn", style: "height: 22px; font-size: var(--font-footnote)", onclick: onCount }, "Count rows")
            : null);
}
