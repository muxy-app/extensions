import { writeSecureFile, removeFile } from "./secure-file.js";
import { resolvePassword } from "./credentials.js";

const files = new Map();

function pgpassEscape(value) {
    return String(value).replace(/([\\:])/g, "\\$1");
}

function iniEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function ensurePgPassFile(ctx) {
    const key = `pg:${ctx.conn.id}`;
    if (files.has(key))
        return files.get(key);
    const password = await resolvePassword(ctx.conn);
    const net = ctx.conn.net;
    const path = `/tmp/muxy-database-${ctx.conn.id}.pgpass`;
    const line = ["*", "*", "*", pgpassEscape(net.user), pgpassEscape(password)].join(":");
    await writeSecureFile(path, line + "\n");
    files.set(key, path);
    return path;
}

export async function ensureMyCnfFile(ctx) {
    const key = `my:${ctx.conn.id}`;
    if (files.has(key))
        return files.get(key);
    const password = await resolvePassword(ctx.conn);
    const path = `/tmp/muxy-database-${ctx.conn.id}.cnf`;
    const content = `[client]\npassword="${iniEscape(password)}"\n`;
    await writeSecureFile(path, content);
    files.set(key, path);
    return path;
}

export async function clearCredFiles(connId) {
    for (const key of [`pg:${connId}`, `my:${connId}`]) {
        const path = files.get(key);
        if (path) {
            await removeFile(path);
            files.delete(key);
        }
    }
}
