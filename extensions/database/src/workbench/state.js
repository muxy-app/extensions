import { getDriver } from "../lib/drivers/index.js";
import { ENGINES } from "../lib/connections.js";
import { getPref } from "../lib/storage.js";
import { ensureTunnel } from "../lib/tunnel.js";
import { ensurePassword, hasKeychain } from "../lib/credentials.js";

export async function buildContext(conn) {
    const ctx = { conn, database: conn.net?.database || "", schema: conn.engine === "postgres" ? "public" : "" };
    if (conn.net) {
        let host = conn.net.host;
        let port = conn.net.port;
        if (conn.ssh?.enabled) {
            port = await ensureTunnel(conn);
            host = "127.0.0.1";
        }
        ctx.endpoint = { host, port };
    }
    return ctx;
}

export async function openSession(conn) {
    const driver = getDriver(conn.engine);
    const detection = await driver.detect();
    if (!detection.available)
        throw new Error(`${ENGINES[conn.engine].binaries[0]} not found.\nInstall it with: ${detection.installHint}`);
    if (conn.engine !== "sqlite" && !conn.keychain) {
        const provided = await ensurePassword(conn);
        if (!provided)
            throw new Error("A password is required to connect.");
    }
    const ctx = await buildContext(conn);
    const { serverVersion } = await driver.test(ctx);
    return {
        conn,
        driver,
        ctx,
        serverVersion,
        tables: [],
        infoCache: new Map(),
        ref: null,
        view: "data",
        gridState: new Map(),
        pageSize: Number(await getPref("pageSize")) || 200,
        timeoutMs: (Number(await getPref("queryTimeoutSeconds")) || 60) * 1000,
    };
}

export async function loadTables(session) {
    session.tables = await session.driver.listTables(session.ctx);
    return session.tables;
}

export async function loadColumns(session) {
    try {
        session.columnsMap = await session.driver.allColumns(session.ctx);
    }
    catch {
        session.columnsMap = {};
    }
}

export async function tableInfo(session, ref, fresh = false) {
    const key = `${ref.database || ""}.${ref.schema || ""}.${ref.table}`;
    if (!fresh && session.infoCache.has(key))
        return session.infoCache.get(key);
    const info = await session.driver.tableInfo(session.ctx, ref);
    session.infoCache.set(key, info);
    return info;
}
