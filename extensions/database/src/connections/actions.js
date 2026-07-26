import { ENGINES, listConnections } from "../lib/connections.js";
import { detect } from "../lib/cli-detect.js";

export function connectionTarget(conn) {
    if (conn.engine === "sqlite")
        return conn.sqlite.path || "no file selected";
    const net = conn.net;
    return `${net.user ? net.user + "@" : ""}${net.host}:${net.port}${net.database ? "/" + net.database : ""}${conn.ssh?.enabled ? " via SSH" : ""}`;
}

export async function quickConnect(onOpen) {
    const connections = await listConnections();
    if (!connections.length)
        return false;
    return new Promise((resolve) => {
        muxy.modal.open({
            placeholder: "Connect to database…",
            items: connections
                .slice()
                .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                .map((c) => ({ id: c.id, title: c.name || "Untitled", subtitle: `${ENGINES[c.engine].label} · ${connectionTarget(c)}` })),
            onSelect: (choice) => {
                if (choice) {
                    const conn = connections.find((c) => c.id === choice.id);
                    if (conn)
                        onOpen(conn);
                }
                resolve(Boolean(choice));
            },
        });
    });
}

export async function engineAvailability() {
    const out = {};
    for (const [engine, def] of Object.entries(ENGINES))
        out[engine] = await detect(def.binaries[0]);
    return out;
}
