export function splitStatements(sql, opts = {}) {
    const { backslashEscapes = false, dollarQuotes = false, backticks = false } = opts;
    const statements = [];
    let start = 0;
    let i = 0;
    const length = sql.length;
    const push = (end) => {
        const text = sql.slice(start, end).trim();
        if (text)
            statements.push({ sql: text, from: start, to: end });
        start = end + 1;
    };
    while (i < length) {
        const ch = sql[i];
        const next = sql[i + 1];
        if (ch === "-" && next === "-") {
            while (i < length && sql[i] !== "\n")
                i++;
            continue;
        }
        if (ch === "#" && backticks) {
            while (i < length && sql[i] !== "\n")
                i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            let depth = 1;
            i += 2;
            while (i < length && depth > 0) {
                if (sql[i] === "/" && sql[i + 1] === "*") {
                    depth++;
                    i += 2;
                }
                else if (sql[i] === "*" && sql[i + 1] === "/") {
                    depth--;
                    i += 2;
                }
                else
                    i++;
            }
            continue;
        }
        if (ch === "'" || ch === '"' || (ch === "`" && backticks)) {
            i++;
            while (i < length) {
                if (backslashEscapes && sql[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (sql[i] === ch) {
                    if (sql[i + 1] === ch) {
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (ch === "$" && dollarQuotes) {
            const match = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
            if (match) {
                const tag = match[0];
                const close = sql.indexOf(tag, i + tag.length);
                i = close === -1 ? length : close + tag.length;
                continue;
            }
        }
        if (ch === ";") {
            push(i);
            i++;
            start = i;
            continue;
        }
        i++;
    }
    push(length);
    return statements;
}

export function splitForEngine(sql, engine) {
    if (engine === "postgres")
        return splitStatements(sql, { dollarQuotes: true });
    if (engine === "mysql" || engine === "mariadb")
        return splitStatements(sql, { backslashEscapes: true, backticks: true });
    return splitStatements(sql);
}

export function statementKind(sql) {
    const head = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/g, "").match(/^[A-Za-z]+/);
    const keyword = (head?.[0] || "").toUpperCase();
    if (["SELECT", "VALUES", "WITH", "TABLE", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "PRAGMA"].includes(keyword))
        return "rows";
    return "command";
}

export function statementAt(sql, offset, engine) {
    const statements = splitForEngine(sql, engine);
    for (const statement of statements) {
        if (offset <= statement.to + 1)
            return statement;
    }
    return statements[statements.length - 1] || null;
}
