import { run } from "../exec.js";
import { detect as detectBinary } from "../cli-detect.js";
import { quoteIdent, quoteLiteral } from "../sql/quote.js";
import { makeResult, fromObjects, parseJsonStream } from "../parse/result.js";

const BIN = "sqlite3";

function argv(ctx, sql, flags = ["-json"]) {
    return [BIN, "-batch", "-bail", ...flags, ctx.conn.sqlite.path, sql];
}

async function query(ctx, sql, opts = {}) {
    const stdout = await run(argv(ctx, sql), opts);
    return parseJsonStream(stdout);
}

export const sqlite = {
    engine: "sqlite",
    capabilities: { databases: false, schemas: false, routines: false, sequences: false, triggers: true, importCsv: true, explain: true, rowid: true },
    dialect: { explainPrefix: "EXPLAIN QUERY PLAN", cmDialect: "SQLite" },

    detect: () => detectBinary(BIN),

    async test(ctx) {
        const sets = await query(ctx, "SELECT sqlite_version() AS version");
        return { ok: true, serverVersion: sets[0]?.[0]?.version || "" };
    },

    async listDatabases() {
        return [];
    },

    async listSchemas() {
        return [];
    },

    async listTables(ctx) {
        const sets = await query(ctx, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
        return (sets[0] || []).map((row) => ({ name: row.name, kind: row.type === "view" ? "view" : "table" }));
    },

    async tableInfo(ctx, ref) {
        const table = ref.table;
        const [columnsSet, indexListSet, fkSet, masterSet, triggersSet] = await Promise.all([
            query(ctx, `PRAGMA table_info(${quoteIdent("sqlite", table)})`),
            query(ctx, `PRAGMA index_list(${quoteIdent("sqlite", table)})`),
            query(ctx, `PRAGMA foreign_key_list(${quoteIdent("sqlite", table)})`),
            query(ctx, `SELECT sql FROM sqlite_master WHERE name = ${quoteLiteral("sqlite", table)}`),
            query(ctx, `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ${quoteLiteral("sqlite", table)}`),
        ]);
        const columns = (columnsSet[0] || []).map((row) => ({
            name: row.name,
            type: row.type || "",
            nullable: row.notnull === 0,
            default: row.dflt_value,
            isPk: row.pk > 0,
            autoIncrement: false,
        }));
        const ddl = masterSet[0]?.[0]?.sql || "";
        const withoutRowid = /WITHOUT\s+ROWID/i.test(ddl);
        const indexes = [];
        for (const idx of indexListSet[0] || []) {
            const infoSet = await query(ctx, `PRAGMA index_info(${quoteIdent("sqlite", idx.name)})`);
            indexes.push({
                name: idx.name,
                unique: idx.unique === 1,
                columns: (infoSet[0] || []).map((c) => c.name).filter(Boolean),
            });
        }
        const foreignKeys = (fkSet[0] || []).map((row) => ({
            column: row.from,
            refTable: row.table,
            refColumn: row.to,
            onUpdate: row.on_update,
            onDelete: row.on_delete,
        }));
        const triggers = (triggersSet[0] || []).map((row) => ({ name: row.name, definition: row.sql }));
        const primaryKey = columns.filter((c) => c.isPk).map((c) => c.name);
        return { columns, indexes, foreignKeys, triggers, primaryKey, rowid: !withoutRowid && !primaryKey.length ? "rowid" : null };
    },

    async runQuery(ctx, sql, opts = {}) {
        const started = performance.now();
        const wrapped = `${sql.replace(/;\s*$/, "")};SELECT changes() AS c;`;
        const sets = await run(argv(ctx, wrapped), opts).then(parseJsonStream);
        const durationMs = Math.round(performance.now() - started);
        const changesSet = sets.pop();
        const affected = Number(changesSet?.[0]?.c ?? 0);
        const results = sets.map((set) => ({ ...fromObjects(set), durationMs }));
        if (!results.length)
            return [makeResult({ affectedRows: affected, durationMs })];
        return results;
    },

    async runScript(ctx, sql, opts = {}) {
        const script = `BEGIN;\n${sql}\nCOMMIT;`;
        await run(argv(ctx, script, []), opts);
    },

    async ddl(ctx, ref) {
        const sets = await query(ctx, `SELECT sql FROM sqlite_master WHERE name = ${quoteLiteral("sqlite", ref.table)}`);
        return sets[0]?.[0]?.sql || "";
    },

    async importCsv(ctx, ref, filePath, opts = {}) {
        await run([BIN, "-batch", ctx.conn.sqlite.path, ".mode csv", `.import ${opts.header ? "--skip 1 " : ""}${filePath} ${ref.table}`], opts);
    },

    async dumpDatabase(ctx, outPath, opts = {}) {
        await run([BIN, ctx.conn.sqlite.path, `.output ${outPath}`, ".dump"], opts);
    },

    async allColumns(ctx) {
        const sets = await query(ctx, "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'");
        const map = {};
        for (const row of sets[0] || []) {
            (map[row.t] = map[row.t] || []).push(row.c);
        }
        return map;
    },

    async explain(ctx, sql, opts = {}) {
        const started = performance.now();
        const stdout = await run(argv(ctx, `EXPLAIN QUERY PLAN ${sql}`, []), opts);
        const rows = stdout.split("\n").filter((line) => line.trim()).map((line) => [line]);
        return [makeResult({ columns: [{ name: "plan" }], rows, durationMs: Math.round(performance.now() - started) })];
    },
};
