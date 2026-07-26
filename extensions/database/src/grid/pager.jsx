import { Icon } from "../ui/icon.jsx";
import { formatNumber } from "../lib/format.js";

export function Pager({ page, pageSize, rowsOnPage, total, onPage, onCount, children }) {
    const from = page * pageSize + 1;
    const to = page * pageSize + rowsOnPage;
    const label = rowsOnPage
        ? `${formatNumber(from)}–${formatNumber(to)}${total != null ? ` of ${formatNumber(total)}` : ""}`
        : "No rows";
    const lastPage = total != null ? Math.max(0, Math.ceil(total / pageSize) - 1) : null;
    const nextDisabled = (rowsOnPage < pageSize && total == null) || (lastPage != null && page >= lastPage);

    return (
        <>
            <button className="icon-btn" disabled={page === 0} onClick={() => onPage(page - 1)} title="Previous page">
                <Icon name="left" />
            </button>
            <span className="mono text-[var(--font-footnote)] text-muted-foreground">{label}</span>
            <button className="icon-btn" disabled={nextDisabled} onClick={() => onPage(page + 1)} title="Next page">
                <Icon name="right" />
            </button>
            {total == null ? (
                <button className="btn btn-compact" onClick={onCount}>
                    Count rows
                </button>
            ) : null}
            {children}
        </>
    );
}
