import { Grid } from "../grid/grid.jsx";
import { formatNumber } from "../lib/format.js";

function metaLine(result) {
    const meta = [];
    if (result.columns.length)
        meta.push(`${formatNumber(result.rows.length)} row${result.rows.length === 1 ? "" : "s"}`);
    if (result.affectedRows != null && !result.columns.length)
        meta.push(`${formatNumber(result.affectedRows)} affected`);
    if (result.commandTag)
        meta.push(result.commandTag);
    meta.push(`${result.durationMs}ms`);
    return meta.join(" · ");
}

function ResultBlock({ result, index, count }) {
    return (
        <div className="result-block flex min-h-0 flex-col rounded-[var(--radius-card)] border" style={{ borderColor: "var(--muxy-border)" }}>
            <div
                className="flex items-center gap-[var(--s4)] border-b px-[var(--s4)] py-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground"
                style={{ borderColor: "var(--muxy-border)" }}
            >
                {count > 1 ? `#${index + 1}` : "Result"}
                <div className="flex-1" />
                {metaLine(result)}
            </div>
            {result.columns.length ? (
                <div className="result-grid flex min-h-0 flex-col">
                    <Grid columns={result.columns} rows={result.rows} />
                </div>
            ) : (
                <div className="px-[var(--s4)] py-[var(--s3)] text-muted-foreground">
                    {result.affectedRows != null
                        ? `OK — ${formatNumber(result.affectedRows)} row${result.affectedRows === 1 ? "" : "s"} affected`
                        : "OK"}
                </div>
            )}
        </div>
    );
}

export function Results({ results, error }) {
    if (error)
        return (
            <div className="p-[var(--s5)]">
                <div className="error-box">{error}</div>
            </div>
        );
    if (!results || !results.length)
        return <div className="flex h-full items-center justify-center text-muted-foreground">Run a query to see results</div>;
    return (
        <div className="flex h-full flex-col gap-[var(--s4)] overflow-y-auto p-[var(--s4)]">
            {results.map((result, index) => (
                <ResultBlock key={index} result={result} index={index} count={results.length} />
            ))}
        </div>
    );
}
