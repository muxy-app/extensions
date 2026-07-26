// Ports extension background process.
//
// This process owns all `muxy.exec` calls. The panel communicates through
// extension events so UI code never executes shell commands directly.

const POLL_MS = 5000;
const KILL_REFRESH_DELAY_MS = 350;

let cache = []; // { port, pid, command, cwd }

function portFromName(name) {
  const idx = name.lastIndexOf(":");
  if (idx === -1) return null;

  const port = Number(name.slice(idx + 1));
  return Number.isInteger(port) && port > 0 ? port : null;
}

// `lsof -F pcn`: `p<pid>`, `c<command>`, `n<host:port>`.
function parseListeners(stdout) {
  const seen = new Map();
  let pid = null;
  let command = "";

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    const tag = line[0];
    const rest = line.slice(1);

    if (tag === "p") {
      pid = Number(rest);
      command = "";
    } else if (tag === "c") {
      command = rest;
    } else if (tag === "n") {
      const port = portFromName(rest);
      if (port && pid && !seen.has(port)) {
        seen.set(port, { port, pid, command });
      }
    }
  }

  return [...seen.values()];
}

// `lsof -a -d cwd -F n -p <pids>` gives each pid's current working directory.
function parseCwds(stdout) {
  const cwds = new Map();
  let pid = null;

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    const tag = line[0];
    const rest = line.slice(1);

    if (tag === "p") pid = Number(rest);
    else if (tag === "n" && pid) cwds.set(pid, rest);
  }

  return cwds;
}

async function scan() {
  let listenOut = "";

  try {
    const res = await muxy.exec(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], {
      timeoutMs: 8000,
    });
    listenOut = res.stdout || "";
  } catch (err) {
    console.warn("ports: lsof listen scan failed", err?.message || err);
    return cache;
  }

  const records = parseListeners(listenOut);
  if (records.length === 0) return [];

  const pids = [...new Set(records.map((rec) => rec.pid).filter(Boolean))];
  let cwds = new Map();

  try {
    const res = await muxy.exec(["lsof", "-a", "-d", "cwd", "-F", "n", "-p", pids.join(",")], {
      timeoutMs: 8000,
    });
    cwds = parseCwds(res.stdout || "");
  } catch (err) {
    console.warn("ports: lsof cwd scan failed", err?.message || err);
  }

  const out = [];
  for (const rec of records) {
    const cwd = cwds.get(rec.pid) || "";
    if (cwd === "" || cwd === "/") continue;
    out.push({ ...rec, cwd });
  }

  return out;
}

async function refresh() {
  cache = await scan();
  await emitData();
}

async function emitData() {
  await muxy.events.emit("extension.ports.data", { records: cache });
}

function targetPids(payload) {
  const requestedPorts = new Set(
    (payload?.ports || [])
      .map((port) => Number(port))
      .filter((port) => Number.isInteger(port) && port > 0),
  );
  const requestedPids = new Set(
    (payload?.pids || [])
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
  const pids = new Set();

  for (const rec of cache) {
    if (requestedPorts.has(rec.port) || requestedPids.has(rec.pid)) {
      pids.add(rec.pid);
    }
  }

  return [...pids];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killPorts(payload) {
  const pids = targetPids(payload);
  const killed = [];
  const failed = [];

  for (const pid of pids) {
    try {
      await muxy.exec(["kill", "-TERM", String(pid)], { timeoutMs: 5000 });
      killed.push(pid);
    } catch (err) {
      failed.push({ pid, message: err?.message || String(err) });
    }
  }

  await sleep(KILL_REFRESH_DELAY_MS);
  await refresh();

  await muxy.events.emit("extension.ports.killResult", { killed, failed });
}

muxy.events.subscribe("extension.ports.request", () => {
  emitData();
});

muxy.events.subscribe("extension.ports.open", async (payload) => {
  const port = payload?.port;
  if (!port) return;

  try {
    await muxy.exec(["open", `http://localhost:${port}`]);
  } catch (err) {
    console.warn("ports: open failed", err?.message || err);
  }
});

muxy.events.subscribe("extension.ports.kill", async (payload) => {
  try {
    await killPorts(payload);
  } catch (err) {
    await muxy.events.emit("extension.ports.killResult", {
      killed: [],
      failed: [{ message: err?.message || String(err) }],
    });
  }
});

refresh();
setInterval(refresh, POLL_MS);
