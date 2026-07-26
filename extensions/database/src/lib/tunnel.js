import { tryRun } from "./exec.js";
import { getTunnels, setTunnels } from "./storage.js";

const active = new Map();

function hashPort(connId) {
    let hash = 2166136261;
    for (let i = 0; i < connId.length; i++) {
        hash ^= connId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return 49152 + (Math.abs(hash) % 16000);
}

function sockPath(connId) {
    return `/tmp/muxy-database-${connId}.sock`;
}

function destination(ssh) {
    return `${ssh.user}@${ssh.host}`;
}

function forwardSpec(localPort, conn) {
    return `127.0.0.1:${localPort}:${conn.net.host}:${conn.net.port}`;
}

async function recordTunnel(entry) {
    const list = (await getTunnels()).filter((t) => t.connId !== entry.connId);
    list.push(entry);
    await setTunnels(list);
}

async function forgetTunnel(connId) {
    const list = await getTunnels();
    await setTunnels(list.filter((t) => t.connId !== connId));
}

async function checkAlive(conn) {
    const res = await muxy.exec(["ssh", "-S", sockPath(conn.id), "-O", "check", destination(conn.ssh)], { timeoutMs: 10000 });
    return res.exitCode === 0;
}

export async function ensureTunnel(conn) {
    const existing = active.get(conn.id);
    if (existing && (await checkAlive(conn)))
        return existing.localPort;
    active.delete(conn.id);
    return establish(conn);
}

async function establish(conn) {
    const ssh = conn.ssh;
    await teardownArtifacts(conn.id, ssh, null);
    let port = hashPort(conn.id);
    let lastError = "";
    for (let attempt = 0; attempt < 10; attempt++, port++) {
        const spec = forwardSpec(port, conn);
        const argv = [
            "ssh", "-f", "-N", "-M", "-S", sockPath(conn.id),
            "-o", "BatchMode=yes",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ConnectTimeout=10",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            "-p", String(ssh.port || 22),
        ];
        if (ssh.keyPath)
            argv.push("-i", ssh.keyPath);
        argv.push("-L", spec, destination(ssh));
        const res = await muxy.exec(argv, { timeoutMs: 25000 });
        if (res.exitCode === 0) {
            active.set(conn.id, { localPort: port });
            await recordTunnel({ connId: conn.id, localPort: port, spec, sock: sockPath(conn.id), dest: destination(ssh), startedAt: Date.now() });
            return port;
        }
        lastError = (res.stderr || res.stdout || "").trim();
        if (/address already in use|forwarding failed|control socket|already in progress/i.test(lastError)) {
            await tryRun(["rm", "-f", sockPath(conn.id)]);
            continue;
        }
        break;
    }
    throw new Error(sshErrorMessage(lastError));
}

function sshErrorMessage(stderr) {
    let hint = "";
    if (/permission denied/i.test(stderr))
        hint = "\nCheck the SSH user, add your key to ssh-agent (ssh-add), or set a key file on the connection.";
    else if (/host key verification failed/i.test(stderr))
        hint = "\nConnect to this host once from a terminal to accept its host key.";
    else if (/could not resolve|connection refused|timed out/i.test(stderr))
        hint = "\nCheck the SSH host and port.";
    return `SSH tunnel failed: ${stderr || "unknown error"}${hint}`;
}

export async function closeTunnel(conn) {
    active.delete(conn.id);
    await teardownArtifacts(conn.id, conn.ssh, null);
    await forgetTunnel(conn.id);
}

async function teardownArtifacts(connId, ssh, spec) {
    if (ssh)
        await tryRun(["ssh", "-S", sockPath(connId), "-O", "exit", destination(ssh)], { timeoutMs: 10000 });
    if (spec)
        await tryRun(["pkill", "-f", spec], { timeoutMs: 10000 });
    await tryRun(["rm", "-f", sockPath(connId)]);
}

export async function sweepTunnels() {
    const list = await getTunnels();
    if (!list.length)
        return;
    for (const entry of list) {
        if (active.has(entry.connId))
            continue;
        await tryRun(["ssh", "-S", entry.sock, "-O", "exit", entry.dest], { timeoutMs: 10000 });
        if (entry.spec)
            await tryRun(["pkill", "-f", entry.spec], { timeoutMs: 10000 });
        await tryRun(["rm", "-f", entry.sock]);
    }
    await setTunnels(list.filter((t) => active.has(t.connId)));
}

export function activeTunnelPort(connId) {
    return active.get(connId)?.localPort ?? null;
}
