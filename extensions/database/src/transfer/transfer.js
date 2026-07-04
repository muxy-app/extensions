import { toast } from "../ui/toast.js";
import { serializeCsv } from "../lib/parse/csv.js";
import { quoteIdent, quoteLiteral, qualifiedName } from "../lib/sql/quote.js";
import { buildSelect } from "../lib/sql/select-builder.js";
import { writeTextFile } from "../lib/secure-file.js";
import { copyToClipboard } from "../lib/clipboard.js";

export function resultToInserts(engine, ref, result) {
    const target = qualifiedName(engine, ref);
    const names = result.columns.map((c) => quoteIdent(engine, c.name)).join(", ");
    return result.rows
        .map((row) => `INSERT INTO ${target} (${names}) VALUES (${row.map((v) => quoteLiteral(engine, v)).join(", ")});`)
        .join("\n");
}

export function resultToJson(result) {
    return JSON.stringify(result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]]))), null, 2);
}

async function writeFile(path, content) {
    await writeTextFile(path, content);
}

async function chooseFile(defaultName) {
    const folder = await muxy.dialog.pickFolder({ title: "Choose destination folder" });
    if (!folder)
        return null;
    const name = await muxy.dialog.prompt({ title: "File name", message: "Save as", default: defaultName });
    if (!name)
        return null;
    return `${folder}/${name}`;
}

export async function copyResult(engine, ref, result, format) {
    let text;
    if (format === "csv")
        text = serializeCsv(result.columns, result.rows);
    else if (format === "json")
        text = resultToJson(result);
    else
        text = resultToInserts(engine, ref, result);
    await copyToClipboard(text);
    toast(`Copied as ${format.toUpperCase()}`, "success");
}

export async function exportResult(engine, ref, result, format) {
    const ext = format === "sql" ? "sql" : format;
    const path = await chooseFile(`${ref?.table || "export"}.${ext}`);
    if (!path)
        return;
    let content;
    if (format === "csv")
        content = serializeCsv(result.columns, result.rows);
    else if (format === "json")
        content = resultToJson(result);
    else
        content = resultToInserts(engine, ref, result);
    try {
        await writeFile(path, content);
        toast(`Exported to ${path}`, "success");
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

async function fetchAll(session, ref) {
    const sql = buildSelect(session.conn.engine, ref, { limit: 1000000, offset: 0 });
    const results = await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
    return results[0];
}

export async function exportTable(session, ref, format) {
    setBusy("Exporting…");
    try {
        const result = await fetchAll(session, ref);
        await exportResult(session.conn.engine, ref, result, format);
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

export async function importCsv(session, ref) {
    const folder = await muxy.dialog.pickFolder({ title: "Folder containing the CSV" });
    if (!folder)
        return;
    const name = await muxy.dialog.prompt({ title: "CSV file", message: "File name", placeholder: "data.csv" });
    if (!name)
        return;
    const path = `${folder}/${name}`;
    try {
        await session.driver.importCsv(session.ctx, ref, path, { header: true });
        toast("CSV imported", "success");
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

export async function dumpDatabase(session) {
    const conn = session.conn;
    const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
    const path = await chooseFile(`${conn.name.replace(/\W+/g, "_")}-${stamp}.sql`);
    if (!path)
        return;
    setBusy("Dumping database…");
    try {
        await session.driver.dumpDatabase(session.ctx, path, { timeoutMs: 600000 });
        toast(`Dump written to ${path}`, "success");
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

function setBusy(message) {
    toast(message, "info");
}
