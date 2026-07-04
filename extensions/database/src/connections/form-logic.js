import { storePassword, setSessionPassword, hasKeychain } from "../lib/credentials.js";
import { getDriver } from "../lib/drivers/index.js";
import { buildContext } from "../workbench/state.js";

export const SSL_MODES = {
    postgres: ["", "disable", "require", "verify-ca", "verify-full"],
    mysql: ["", "DISABLED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"],
    mariadb: ["", "DISABLED", "REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"],
};

export function validate(conn) {
    if (!conn.name.trim())
        return "Name is required";
    if (conn.engine === "sqlite" && !conn.sqlite.path.trim())
        return "Database file path is required";
    if (conn.engine !== "sqlite") {
        if (!conn.net.host.trim())
            return "Host is required";
        if (!conn.net.user.trim())
            return "User is required";
    }
    if (conn.ssh?.enabled && (!conn.ssh.host.trim() || !conn.ssh.user.trim()))
        return "SSH host and user are required for tunneling";
    return null;
}

export async function applyPassword(conn, password) {
    if (!password)
        return;
    if (await hasKeychain()) {
        await storePassword(conn.id, password);
        conn.keychain = true;
    } else {
        setSessionPassword(conn.id, password);
        conn.keychain = false;
    }
}

export async function testConnection(conn, password) {
    const problem = validate(conn);
    if (problem)
        return { ok: false, message: problem };
    try {
        const driver = getDriver(conn.engine);
        const detection = await driver.detect();
        if (!detection.available)
            throw new Error(`Client not found. Install: ${detection.installHint}`);
        if (password)
            setSessionPassword(conn.id, password);
        const ctx = await buildContext(conn);
        const { serverVersion } = await driver.test(ctx);
        return { ok: true, message: `Connected — ${serverVersion || "OK"}` };
    } catch (error) {
        return { ok: false, message: error.message };
    }
}
