export function InfoTable({ headers, rows }) {
    return (
        <div className="grid-wrap grid-wrap-inline">
            <table className="grid-table grid-table-structure">
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
                                {row.map((cell, c) => {
                                    const text = cell === null ? "" : String(cell);
                                    return (
                                        <td key={c} title={text.length > 60 ? text : undefined}>
                                            {cell === null ? <span className="null-badge">—</span> : text}
                                        </td>
                                    );
                                })}
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
        </div>
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
