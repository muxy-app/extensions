const MAX_CELL_CHARS = 400;

export function cellDisplay(value) {
    if (value === null)
        return { null: true };
    const text = String(value);
    return {
        null: false,
        text: text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) + "…" : text,
        title: text.length > 60 ? text.slice(0, 1000) : undefined,
    };
}

export function CellValue({ value }) {
    const info = cellDisplay(value);
    if (info.null)
        return <span className="null-badge">NULL</span>;
    return <>{info.text}</>;
}

export function Grid({ columns, rows, sort, onSort }) {
    if (!columns.length)
        return <div className="flex h-full items-center justify-center text-muted-foreground">No rows returned</div>;
    return (
        <div className="grid-wrap">
            <table className="grid-table">
                <thead>
                    <tr>
                        {columns.map((col) => {
                            const sorted = sort && sort.column === col.name;
                            const marker = sorted ? (sort.dir === "desc" ? " ▾" : " ▴") : "";
                            return (
                                <th key={col.name} title={col.type || col.name} onClick={onSort ? () => onSort(col.name) : undefined}>
                                    {`${col.name}${marker}`}
                                    {col.type ? (
                                        <span className="ml-[var(--s2)] font-normal text-muted-foreground">{col.type.toLowerCase()}</span>
                                    ) : null}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, r) => (
                        <tr key={r}>
                            {row.map((value, c) => {
                                const info = cellDisplay(value);
                                return (
                                    <td key={c} title={info.title}>
                                        {info.null ? <span className="null-badge">NULL</span> : info.text}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
