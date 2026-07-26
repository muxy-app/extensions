import { run } from "../exec.js";
import { detect as detectBinary, firstAvailable } from "../cli-detect.js";
import { ensureMyCnfFile } from "../cred-file.js";
import { quoteIdent, quoteLiteral } from "../sql/quote.js";
import { makeResult } from "../parse/result.js";
import { parseMysqlXml } from "../parse/xml.js";
import { splitForEngine, statementKind } from "../sql/statement-split.js";

const SYSTEM_DBS = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

function sslArgs(binary, sslMode) {
    if (!sslMode)
        return [];
    if (binary === "mysql")
        return [`--ssl-mode=${sslMode}`];
    if (sslMode === "DISABLED")
        return ["--skip-ssl"];
    if (sslMode === "REQUIRED")
        return ["--ssl"];
    return ["--ssl", "--ssl-verify-server-cert"];
}

export function makeMysqlDriver(engine, binaries) {
    let resolvedBinary = null;

    async function bin() {
        if (!resolvedBinary)
            resolvedBinary = await firstAvailable(binaries);
        if (!resolvedBinary)
            throw new Error(`${binaries[0]} not found`);
        return resolvedBinary;
    }

    async function baseArgv(ctx, extra) {
        const binary = await bin();
        const net = ctx.conn.net;
        const database = ctx.database || net.database;
        const credFile = await ensureMyCnfFile(ctx);
        return [
            binary, `--defaults-extra-file=${credFile}`,
            "--batch", "--connect-timeout=10",
            "-h", ctx.endpoint?.host || net.host,
            "-P", String(ctx.endpoint?.port || net.port || 3306),
            "--protocol=TCP",
            "-u", net.user,
            ...sslArgs(binary, net.sslMode),
            ...(database ? ["-D", database] : []),
            ...extra,
        ];
    }

    async function exec(ctx, extra, opts = {}) {
        return run(await baseArgv(ctx, extra), opts);
    }

    async function runStatement(ctx, sql, opts = {}) {
        const started = performance.now();
        const stdout = await exec(ctx, ["--xml", "-e", `${sql.replace(/;\s*$/, "")};SELECT ROW_COUNT() AS __rc`], opts);
        const durationMs = Math.round(performance.now() - started);
        const sets = parseMysqlXml(stdout);
        const rcSet = sets.pop();
        const rc = Number(rcSet?.rows?.[0]?.[0] ?? -1);
        const affected = statementKind(sql) === "command" && rc >= 0 ? rc : null;
        if (!sets.length)
            return [makeResult({ affectedRows: affected, durationMs })];
        return sets.map((set) => makeResult({ columns: set.columns, rows: set.rows, durationMs }));
    }

    async function query(ctx, sql, opts = {}) {
        const results = await runStatement(ctx, sql, opts);
        return results[0] || { columns: [], rows: [] };
    }

    function rowsAsObjects(result) {
        return result.rows.map((row) => Object.fromEntries(result.columns.map((col, i) => [col.name, row[i]])));
    }

    return {
        engine,
        capabilities: { databases: true, schemas: false, routines: true, sequences: false, triggers: true, importCsv: true, explain: true, rowid: false },
        dialect: { explainPrefix: "EXPLAIN", cmDialect: engine === "mariadb" ? "MariaSQL" : "MySQL" },

        detect: () => detectBinary(binaries[0]),

        async test(ctx) {
            const result = await query(ctx, "SELECT VERSION() AS v", { timeoutMs: 15000 });
            return { ok: true, serverVersion: result.rows[0]?.[0] || "" };
        },

        async listDatabases(ctx) {
            const result = await query(ctx, "SHOW DATABASES");
            return result.rows.map((r) => r[0]).filter((name) => !SYSTEM_DBS.has(name));
        },

        async listSchemas() {
            return [];
        },

        async listTables(ctx) {
            const result = await query(ctx, "SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, TABLE_ROWS AS estimate FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1");
            return rowsAsObjects(result).map((r) => ({
                name: r.name,
                kind: /view/i.test(r.kind || "") ? "view" : "table",
                rowEstimate: r.estimate === null ? null : Number(r.estimate),
            }));
        },

        async tableInfo(ctx, ref) {
            const tableLit = quoteLiteral(engine, ref.table);
            const [cols, idx, fks, trg] = await Promise.all([
                query(ctx, `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS ckey, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableLit} ORDER BY ORDINAL_POSITION`),
                query(ctx, `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonunique, COLUMN_NAME AS col, SEQ_IN_INDEX AS seq FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableLit} ORDER BY INDEX_NAME, SEQ_IN_INDEX`),
                query(ctx, `SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS reftable, REFERENCED_COLUMN_NAME AS refcol FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableLit} AND REFERENCED_TABLE_NAME IS NOT NULL`),
                query(ctx, `SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = ${tableLit}`),
            ]);
            const columns = rowsAsObjects(cols).map((r) => ({
                name: r.name,
                type: r.type || "",
                nullable: r.nullable === "YES",
                default: r.dflt,
                isPk: r.ckey === "PRI",
                autoIncrement: (r.extra || "").includes("auto_increment"),
            }));
            const indexMap = new Map();
            for (const r of rowsAsObjects(idx)) {
                if (!indexMap.has(r.name))
                    indexMap.set(r.name, { name: r.name, unique: r.nonunique === "0", columns: [] });
                indexMap.get(r.name).columns.push(r.col);
            }
            const foreignKeys = rowsAsObjects(fks).map((r) => ({ name: r.name, column: r.col, refTable: r.reftable, refColumn: r.refcol }));
            const triggers = rowsAsObjects(trg).map((r) => ({ name: r.name, definition: `${r.timing} ${r.event}` }));
            return {
                columns,
                indexes: [...indexMap.values()],
                foreignKeys,
                triggers,
                primaryKey: columns.filter((c) => c.isPk).map((c) => c.name),
                rowid: null,
            };
        },

        async listRoutines(ctx) {
            const result = await query(ctx, "SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS kind FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY 1");
            return rowsAsObjects(result).map((r) => ({ name: r.name, kind: (r.kind || "function").toLowerCase() }));
        },

        async runQuery(ctx, sql, opts = {}) {
            const statements = splitForEngine(sql, engine);
            const results = [];
            for (const statement of statements)
                results.push(...(await runStatement(ctx, statement.sql, opts)));
            return results.length ? results : [makeResult({})];
        },

        async runScript(ctx, sql, opts = {}) {
            const script = `START TRANSACTION;\n${sql.replace(/;\s*$/, "")};\nCOMMIT;`;
            await exec(ctx, ["-e", script], opts);
        },

        async ddl(ctx, ref) {
            const result = await query(ctx, `SHOW CREATE TABLE ${quoteIdent(engine, ref.table)}`);
            return result.rows[0]?.[1] || "";
        },

        async importCsv(ctx, ref, filePath, opts = {}) {
            const sql = `LOAD DATA LOCAL INFILE ${quoteLiteral(engine, filePath)} INTO TABLE ${quoteIdent(engine, ref.table)} FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\\n'${opts.header ? " IGNORE 1 LINES" : ""}`;
            await exec(ctx, ["--local-infile=1", "-e", sql], opts);
        },

        async dumpDatabase(ctx, outPath, opts = {}) {
            const dumpBin = await firstAvailable(engine === "mariadb" ? ["mariadb-dump", "mysqldump"] : ["mysqldump"]);
            if (!dumpBin)
                throw new Error(`${engine === "mariadb" ? "mariadb-dump" : "mysqldump"} not found`);
            const net = ctx.conn.net;
            const credFile = await ensureMyCnfFile(ctx);
            const argv = [
                dumpBin, `--defaults-extra-file=${credFile}`, "--protocol=TCP", `--result-file=${outPath}`,
                "-h", ctx.endpoint?.host || net.host,
                "-P", String(ctx.endpoint?.port || net.port || 3306),
                "-u", net.user,
                ctx.database || net.database,
            ];
            await run(argv, { timeoutMs: opts.timeoutMs || 600000 });
        },

        async allColumns(ctx) {
            const result = await query(ctx, "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION");
            const map = {};
            for (const row of rowsAsObjects(result)) {
                (map[row.t] = map[row.t] || []).push(row.c);
            }
            return map;
        },

        async explain(ctx, sql, opts = {}) {
            return this.runQuery(ctx, `EXPLAIN ${sql}`, opts);
        },
    };
}

export const mysql = makeMysqlDriver("mysql", ["mysql"]);
export const mariadb = makeMysqlDriver("mariadb", ["mariadb", "mysql"]);
