export function quoteIdent(engine, name) {
    if (engine === "mysql" || engine === "mariadb")
        return "`" + String(name).replace(/`/g, "``") + "`";
    return '"' + String(name).replace(/"/g, '""') + '"';
}

export function quoteLiteral(engine, value) {
    if (value === null || value === undefined)
        return "NULL";
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    if (typeof value === "boolean") {
        if (engine === "postgres")
            return value ? "TRUE" : "FALSE";
        return value ? "1" : "0";
    }
    let text = String(value).replace(/'/g, "''");
    if ((engine === "mysql" || engine === "mariadb") && text.includes("\\"))
        text = text.replace(/\\/g, "\\\\");
    return "'" + text + "'";
}

export function qualifiedName(engine, ref) {
    const parts = [];
    if (ref.database && (engine === "mysql" || engine === "mariadb"))
        parts.push(quoteIdent(engine, ref.database));
    if (ref.schema && engine === "postgres")
        parts.push(quoteIdent(engine, ref.schema));
    parts.push(quoteIdent(engine, ref.table));
    return parts.join(".");
}
