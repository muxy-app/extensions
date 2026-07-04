import { run, tryRun } from "./exec.js";
import { which } from "./cli-detect.js";
import { saveConnection } from "./connections.js";

const SERVICE = "muxy-database";
const session = new Map();
let keychain = null;

export async function hasKeychain() {
    if (keychain === null) {
        const uname = await tryRun(["uname", "-s"]);
        keychain = uname?.trim() === "Darwin" && !!(await which("security"));
    }
    return keychain;
}

export async function storePassword(connId, password) {
    if (!(await hasKeychain())) {
        session.set(connId, password);
        return false;
    }
    await run(["security", "add-generic-password", "-U", "-s", SERVICE, "-a", connId, "-w", password]);
    session.delete(connId);
    return true;
}

export function setSessionPassword(connId, password) {
    session.set(connId, password);
}

export function hasSessionPassword(connId) {
    return session.has(connId);
}

export async function deletePassword(connId) {
    session.delete(connId);
    if (await hasKeychain())
        await tryRun(["security", "delete-generic-password", "-s", SERVICE, "-a", connId]);
}

export async function resolvePassword(conn) {
    if (session.has(conn.id))
        return session.get(conn.id);
    if (conn.keychain) {
        const stored = await tryRun(["security", "find-generic-password", "-w", "-s", SERVICE, "-a", conn.id]);
        return stored === null ? "" : stored.replace(/\n$/, "");
    }
    return "";
}

export async function ensurePassword(conn) {
    if (conn.keychain || session.has(conn.id))
        return true;
    if (!muxy.dialog?.prompt)
        return false;
    const entered = await muxy.dialog.prompt({
        title: "Password required",
        message: `Enter the password for ${conn.net?.user || "user"} @ ${conn.net?.host || "database"}`,
        placeholder: "Password",
        confirm: "Connect",
    });
    if (entered === null)
        return false;
    session.set(conn.id, entered);
    if (await hasKeychain()) {
        await storePassword(conn.id, entered);
        conn.keychain = true;
        await saveConnection(conn).catch(() => undefined);
    }
    return true;
}
