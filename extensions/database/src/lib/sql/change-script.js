import { quoteIdent, quoteLiteral, qualifiedName } from "./quote.js";

function keyClause(engine, keyColumns, keyValues) {
    return keyColumns
        .map((column, index) => {
            const name = column === "__rowid" ? "rowid" : quoteIdent(engine, column);
            const value = keyValues[index];
            return value === null ? `${name} IS NULL` : `${name} = ${quoteLiteral(engine, value)}`;
        })
        .join(" AND ");
}

export function buildChangeScript(changes) {
    const { engine, ref, keyColumns } = changes;
    const target = qualifiedName(engine, ref);
    const statements = [];

    for (const keyValues of changes.deletes.values())
        statements.push(`DELETE FROM ${target} WHERE ${keyClause(engine, keyColumns, keyValues)};`);

    for (const [key, entry] of changes.edits) {
        if (changes.deletes.has(key))
            continue;
        const sets = [...entry.cells.entries()]
            .map(([column, value]) => `${quoteIdent(engine, column)} = ${quoteLiteral(engine, value)}`)
            .join(", ");
        statements.push(`UPDATE ${target} SET ${sets} WHERE ${keyClause(engine, keyColumns, entry.keyValues)};`);
    }

    for (const insert of changes.inserts) {
        const columns = [...insert.cells.keys()];
        if (!columns.length)
            continue;
        const names = columns.map((column) => quoteIdent(engine, column)).join(", ");
        const values = columns.map((column) => quoteLiteral(engine, insert.cells.get(column))).join(", ");
        statements.push(`INSERT INTO ${target} (${names}) VALUES (${values});`);
    }

    return statements;
}
