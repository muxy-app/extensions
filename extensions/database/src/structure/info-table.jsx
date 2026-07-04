export function InfoTable({ headers, rows }) {
    return (
        <table className="grid-table" style={{ fontFamily: "inherit" }}>
            <thead>
                <tr>
                    {headers.map((head) => (
                        <th key={head}>{head}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.length ? (
                    rows.map((row, r) => (
                        <tr key={r}>
                            {row.map((cell, c) => (
                                <td key={c} style={{ maxWidth: "none", whiteSpace: "normal" }}>
                                    {cell === null ? <span className="null-badge">—</span> : String(cell)}
                                </td>
                            ))}
                        </tr>
                    ))
                ) : (
                    <tr>
                        <td colSpan={headers.length} className="text-muted-foreground">
                            None
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}

export function Section({ title, children }) {
    return (
        <div className="flex flex-col gap-[var(--s3)]">
            <div className="section-label">{title}</div>
            {children}
        </div>
    );
}
