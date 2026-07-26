import { getConnections, setConnections, removeConnectionData } from "./storage.js";

export const ENGINES = {
    sqlite: { label: "SQLite", defaultPort: null, binaries: ["sqlite3"], dumpBinaries: ["sqlite3"] },
    postgres: { label: "PostgreSQL", defaultPort: 5432, binaries: ["psql"], dumpBinaries: ["pg_dump"] },
    mysql: { label: "MySQL", defaultPort: 3306, binaries: ["mysql"], dumpBinaries: ["mysqldump"] },
    mariadb: { label: "MariaDB", defaultPort: 3306, binaries: ["mariadb", "mysql"], dumpBinaries: ["mariadb-dump", "mysqldump"] },
};

export const COLORS = ["#e06c75", "#e5a56b", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd", "#abb2bf"];

export function newId() {
    return "c-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newConnection(engine) {
    const conn = {
        id: newId(),
        name: "",
        engine,
        group: "",
        color: COLORS[5],
        keychain: false,
        createdAt: Date.now(),
        lastUsedAt: 0,
    };
    if (engine === "sqlite")
        conn.sqlite = { path: "" };
    else
        conn.net = { host: "127.0.0.1", port: ENGINES[engine].defaultPort, user: "", database: "", sslMode: "" };
    return conn;
}

export async function listConnections() {
    return getConnections();
}

export async function saveConnection(conn) {
    const list = await getConnections();
    const index = list.findIndex((c) => c.id === conn.id);
    if (index >= 0)
        list[index] = conn;
    else
        list.push(conn);
    await setConnections(list);
    return conn;
}

export async function deleteConnection(id) {
    const list = await getConnections();
    await setConnections(list.filter((c) => c.id !== id));
    await removeConnectionData(id);
}

export async function getConnection(id) {
    const list = await getConnections();
    return list.find((c) => c.id === id) || null;
}

export async function touchConnection(id) {
    const list = await getConnections();
    const conn = list.find((c) => c.id === id);
    if (conn) {
        conn.lastUsedAt = Date.now();
        await setConnections(list);
    }
}

export async function duplicateConnection(id) {
    const source = await getConnection(id);
    if (!source)
        return null;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = newId();
    copy.name = `${source.name} copy`;
    copy.keychain = false;
    copy.createdAt = Date.now();
    copy.lastUsedAt = 0;
    return saveConnection(copy);
}

const URL_ENGINES = {
    "postgres:": "postgres",
    "postgresql:": "postgres",
    "mysql:": "mysql",
    "mariadb:": "mariadb",
};

export function parseConnectionUrl(input) {
    const raw = input.trim();
    if (!raw)
        return null;
    if (raw.startsWith("/") || raw.startsWith("~") || raw.endsWith(".db") || raw.endsWith(".sqlite") || raw.endsWith(".sqlite3")) {
        const conn = newConnection("sqlite");
        conn.sqlite.path = raw;
        conn.name = raw.split("/").pop();
        return { conn, password: null };
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return null;
    }
    const engine = URL_ENGINES[url.protocol];
    if (!engine)
        return null;
    const conn = newConnection(engine);
    conn.net.host = url.hostname || "127.0.0.1";
    conn.net.port = url.port ? Number(url.port) : ENGINES[engine].defaultPort;
    conn.net.user = decodeURIComponent(url.username || "");
    conn.net.database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    conn.net.sslMode = url.searchParams.get("sslmode") || "";
    conn.name = conn.net.database ? `${conn.net.database} @ ${conn.net.host}` : conn.net.host;
    const password = decodeURIComponent(url.password || "");
    return { conn, password: password || null };
}
