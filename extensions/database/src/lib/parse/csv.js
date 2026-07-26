export function parseCsv(text, opts = {}) {
    const bareEmpty = "bareEmpty" in opts ? opts.bareEmpty : null;
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    let wasQuoted = false;
    let i = 0;
    const push = () => {
        row.push(wasQuoted ? value : value === "" ? bareEmpty : value);
        value = "";
        wasQuoted = false;
    };
    const endRow = () => {
        push();
        rows.push(row);
        row = [];
    };
    while (i < text.length) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    value += '"';
                    i += 2;
                    continue;
                }
                quoted = false;
                i++;
                continue;
            }
            value += ch;
            i++;
            continue;
        }
        if (ch === '"' && value === "") {
            quoted = true;
            wasQuoted = true;
            i++;
            continue;
        }
        if (ch === ",") {
            push();
            i++;
            continue;
        }
        if (ch === "\r") {
            i++;
            continue;
        }
        if (ch === "\n") {
            endRow();
            i++;
            continue;
        }
        value += ch;
        i++;
    }
    if (value !== "" || wasQuoted || row.length)
        endRow();
    return rows;
}

export function csvToResult(text) {
    const rows = parseCsv(text);
    if (!rows.length)
        return null;
    const header = rows[0].map((name) => ({ name: name ?? "" }));
    return { columns: header, rows: rows.slice(1) };
}

export function serializeCsv(columns, rows, { nullAs = "" } = {}) {
    const escape = (value) => {
        if (value === null || value === undefined)
            return nullAs;
        const text = String(value);
        if (/[",\n\r]/.test(text) || text === "")
            return '"' + text.replace(/"/g, '""') + '"';
        return text;
    };
    const lines = [columns.map((c) => escape(c.name)).join(",")];
    for (const row of rows)
        lines.push(row.map(escape).join(","));
    return lines.join("\n") + "\n";
}
