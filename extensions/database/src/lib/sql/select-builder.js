import { quoteIdent, quoteLiteral, qualifiedName } from "./quote.js";

export const FILTER_OPS = [
    { id: "eq", label: "=", sql: (c, v) => `${c} = ${v}` },
    { id: "neq", label: "≠", sql: (c, v) => `${c} <> ${v}` },
    { id: "gt", label: ">", sql: (c, v) => `${c} > ${v}` },
    { id: "gte", label: "≥", sql: (c, v) => `${c} >= ${v}` },
    { id: "lt", label: "<", sql: (c, v) => `${c} < ${v}` },
    { id: "lte", label: "≤", sql: (c, v) => `${c} <= ${v}` },
    { id: "like", label: "LIKE", sql: (c, v) => `${c} LIKE ${v}` },
    { id: "nlike", label: "NOT LIKE", sql: (c, v) => `${c} NOT LIKE ${v}` },
    { id: "null", label: "IS NULL", sql: (c) => `${c} IS NULL`, unary: true },
    { id: "nnull", label: "IS NOT NULL", sql: (c) => `${c} IS NOT NULL`, unary: true },
];

export function buildWhere(engine, filters, rawWhere) {
    const clauses = [];
    for (const filter of filters || []) {
        if (!filter.column)
            continue;
        const op = FILTER_OPS.find((o) => o.id === filter.op);
        if (!op)
            continue;
        if (!op.unary && (filter.value === "" || filter.value === undefined))
            continue;
        const column = quoteIdent(engine, filter.column);
        clauses.push(op.unary ? op.sql(column) : op.sql(column, quoteLiteral(engine, filter.value)));
    }
    if (rawWhere && rawWhere.trim())
        clauses.push(`(${rawWhere.trim()})`);
    return clauses.length ? clauses.join(" AND ") : "";
}

export function buildSelect(engine, ref, opts = {}) {
    const columns = opts.rowid ? `rowid AS __rowid, *` : "*";
    let sql = `SELECT ${columns} FROM ${qualifiedName(engine, ref)}`;
    const where = buildWhere(engine, opts.filters, opts.rawWhere);
    if (where)
        sql += ` WHERE ${where}`;
    if (opts.sort && opts.sort.column)
        sql += ` ORDER BY ${quoteIdent(engine, opts.sort.column)} ${opts.sort.dir === "desc" ? "DESC" : "ASC"}`;
    sql += ` LIMIT ${Number(opts.limit) || 100} OFFSET ${Number(opts.offset) || 0}`;
    return sql;
}

export function buildCount(engine, ref, opts = {}) {
    let sql = `SELECT COUNT(*) AS count FROM ${qualifiedName(engine, ref)}`;
    const where = buildWhere(engine, opts.filters, opts.rawWhere);
    if (where)
        sql += ` WHERE ${where}`;
    return sql;
}
