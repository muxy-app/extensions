import { run } from "../exec.js";
import { detect as detectBinary, which } from "../cli-detect.js";
import { ensurePgPassFile } from "../cred-file.js";
import { quoteIdent, quoteLiteral, qualifiedName } from "../sql/quote.js";
import { makeResult } from "../parse/result.js";
import { parseCsv } from "../parse/csv.js";
import { splitForEngine, statementKind } from "../sql/statement-split.js";

const BIN = "psql";

function nullSentinel() {
    return `__NULL_${Math.random().toString(36).slice(2, 10)}__`;
}

const TAG_PATTERN = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|COPY \d+|SELECT \d+|[A-Z]+(?: [A-Z]+)*)$/;

function connKeyword(value) {
    return `'${String(value).replace(/(['\\])/g, "\\$1")}'`;
}

async function conninfo(ctx) {
    const net = ctx.conn.net;
    const passfile = await ensurePgPassFile(ctx);
    const parts = [
        `host=${connKeyword(ctx.endpoint?.host || net.host)}`,
        `port=${connKeyword(ctx.endpoint?.port || net.port || 5432)}`,
        `user=${connKeyword(net.user)}`,
        `dbname=${connKeyword(ctx.database || net.database || "postgres")}`,
        `passfile=${connKeyword(passfile)}`,
    ];
    if (net.sslMode)
        parts.push(`sslmode=${connKeyword(net.sslMode)}`);
    return parts.join(" ");
}

async function exec(ctx, extra, opts = {}) {
    const argv = [BIN, "-X", "-w", "-v", "ON_ERROR_STOP=1", "-d", await conninfo(ctx), ...extra];
    return run(argv, opts);
}

function regclass(ctx, ref) {
    return quoteLiteral("postgres", `${quoteIdent("postgres", ref.schema || "public")}.${quoteIdent("postgres", ref.table)}`) + "::regclass";
}

function decodeCsv(text, sentinel) {
    const rows = parseCsv(text, { bareEmpty: "" });
    return rows.map((row) => row.map((value) => (value === sentinel ? null : value)));
}

function parseStatementOutput(stdout, kind, sentinel) {
    let csvText = stdout;
    let commandTag = "";
    let affectedRows = null;
    if (kind === "command") {
        const lines = stdout.replace(/\n$/, "").split("\n");
        const last = lines[lines.length - 1] || "";
        if (TAG_PATTERN.test(last)) {
            commandTag = last;
            lines.pop();
            csvText = lines.length ? lines.join("\n") + "\n" : "";
            const numbers = last.match(/\d+/g);
            if (numbers)
                affectedRows = Number(numbers[numbers.length - 1]);
        }
    }
    const rows = csvText.trim() ? decodeCsv(csvText, sentinel) : [];
    if (!rows.length)
        return makeResult({ commandTag, affectedRows });
    return makeResult({
        columns: rows[0].map((name) => ({ name: name ?? "" })),
        rows: rows.slice(1),
        commandTag,
        affectedRows,
    });
}

async function runStatement(ctx, sql, opts = {}) {
    const sentinel = nullSentinel();
    const started = performance.now();
    const stdout = await exec(ctx, ["--csv", "-P", `null=${sentinel}`, "-c", sql], opts);
    const result = parseStatementOutput(stdout, statementKind(sql), sentinel);
    result.durationMs = Math.round(performance.now() - started);
    return result;
}

async function query(ctx, sql, opts = {}) {
    const result = await runStatement(ctx, sql, opts);
    return { columns: result.columns, rows: result.rows };
}

function rowsAsObjects(result) {
    return result.rows.map((row) => Object.fromEntries(result.columns.map((col, i) => [col.name, row[i]])));
}

export const postgres = {
    engine: "postgres",
    capabilities: { databases: true, schemas: true, routines: true, sequences: true, triggers: true, importCsv: true, explain: true, rowid: false },
    dialect: { explainPrefix: "EXPLAIN", cmDialect: "PostgreSQL" },

    detect: () => detectBinary(BIN),

    async test(ctx) {
        const result = await query(ctx, "SELECT current_setting('server_version') AS v", { timeoutMs: 15000 });
        return { ok: true, serverVersion: result.rows[0]?.[0] || "" };
    },

    async listDatabases(ctx) {
        const result = await query(ctx, "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1");
        return result.rows.map((r) => r[0]);
    },

    async listSchemas(ctx) {
        const result = await query(ctx, "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY 1");
        return result.rows.map((r) => r[0]);
    },

    async listTables(ctx) {
        const schema = quoteLiteral("postgres", ctx.schema || "public");
        const result = await query(ctx, `SELECT c.relname AS name, CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind, GREATEST(c.reltuples, 0)::bigint AS estimate FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p','v','m') AND n.nspname = ${schema} ORDER BY 1`);
        return rowsAsObjects(result).map((r) => ({ name: r.name, kind: r.kind, rowEstimate: Number(r.estimate) || null }));
    },

    async tableInfo(ctx, ref) {
        const schemaLit = quoteLiteral("postgres", ref.schema || "public");
        const tableLit = quoteLiteral("postgres", ref.table);
        const rc = regclass(ctx, ref);
        const [cols, pk, idx, fks, trg] = await Promise.all([
            query(ctx, `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS dflt FROM information_schema.columns WHERE table_schema = ${schemaLit} AND table_name = ${tableLit} ORDER BY ordinal_position`),
            query(ctx, `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = ${rc} AND i.indisprimary`),
            query(ctx, `SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = ${schemaLit} AND tablename = ${tableLit} ORDER BY 1`),
            query(ctx, `SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'f' AND conrelid = ${rc}`),
            query(ctx, `SELECT tgname AS name, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = ${rc} AND NOT tgisinternal`),
        ]);
        const pkNames = new Set(pk.rows.map((r) => r[0]));
        const columns = rowsAsObjects(cols).map((r) => ({
            name: r.name,
            type: r.type || "",
            nullable: r.nullable === "YES",
            default: r.dflt,
            isPk: pkNames.has(r.name),
            autoIncrement: !!(r.dflt && r.dflt.startsWith("nextval(")),
        }));
        const indexes = rowsAsObjects(idx).map((r) => ({
            name: r.name,
            unique: /CREATE UNIQUE INDEX/i.test(r.definition),
            columns: (r.definition.match(/\(([^)]*)\)\s*$/)?.[1] || "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean),
            definition: r.definition,
        }));
        const foreignKeys = rowsAsObjects(fks).map((r) => {
            const match = r.definition.match(/FOREIGN KEY \("?([^)"]+)"?\) REFERENCES ("?[^("]+"?)\("?([^)"]+)"?\)/);
            return { name: r.name, column: match?.[1] || "", refTable: (match?.[2] || "").replace(/"/g, ""), refColumn: match?.[3] || "", definition: r.definition };
        });
        const triggers = rowsAsObjects(trg).map((r) => ({ name: r.name, definition: r.definition }));
        return { columns, indexes, foreignKeys, triggers, primaryKey: [...pkNames], rowid: null };
    },

    async listRoutines(ctx) {
        const schema = quoteLiteral("postgres", ctx.schema || "public");
        const result = await query(ctx, `SELECT routine_name AS name, routine_type AS kind FROM information_schema.routines WHERE specific_schema = ${schema} ORDER BY 1`);
        return rowsAsObjects(result).map((r) => ({ name: r.name, kind: (r.kind || "function").toLowerCase() }));
    },

    async runQuery(ctx, sql, opts = {}) {
        const statements = splitForEngine(sql, "postgres");
        const results = [];
        for (const statement of statements)
            results.push(await runStatement(ctx, statement.sql, opts));
        return results.length ? results : [makeResult({})];
    },

    async runScript(ctx, sql, opts = {}) {
        await exec(ctx, ["-q", "-c", sql], opts);
    },

    async ddl(ctx, ref) {
        if (await which("pg_dump")) {
            const argv = ["pg_dump", "-w", "--schema-only", "--no-owner", "--no-privileges", "-d", await conninfo(ctx), "-t", `${ref.schema || "public"}.${ref.table}`];
            const stdout = await run(argv, { timeoutMs: 30000 });
            return stdout
                .split("\n")
                .filter((line) => !/^--|^SET |^SELECT pg_catalog|^\s*$/.test(line))
                .join("\n")
                .trim();
        }
        const info = await this.tableInfo(ctx, ref);
        const body = info.columns.map((c) => `    ${quoteIdent("postgres", c.name)} ${c.type}${c.nullable ? "" : " NOT NULL"}${c.default ? ` DEFAULT ${c.default}` : ""}`);
        return `CREATE TABLE ${qualifiedName("postgres", ref)} (\n${body.join(",\n")}\n);`;
    },

    async importCsv(ctx, ref, filePath, opts = {}) {
        const target = qualifiedName("postgres", ref);
        const sql = `\\copy ${target} FROM ${quoteLiteral("postgres", filePath)} WITH (FORMAT csv${opts.header ? ", HEADER" : ""})`;
        await exec(ctx, ["-q", "-c", sql], opts);
    },

    async dumpDatabase(ctx, outPath, opts = {}) {
        await run(["pg_dump", "-w", "-d", await conninfo(ctx), "-f", outPath], { timeoutMs: opts.timeoutMs || 600000 });
    },

    async allColumns(ctx) {
        const schema = quoteLiteral("postgres", ctx.schema || "public");
        const result = await query(ctx, `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ${schema} ORDER BY table_name, ordinal_position`);
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
