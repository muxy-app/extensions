// A thin wrapper around the docker CLI, run through muxy.exec.
// Every call runs the `docker` program directly (no shell), so Muxy's
// "Allow & Remember" choice for `docker` covers all of them.

export class DockerError extends Error {
  constructor(message, kind = "command", detail = {}) {
    super(message);
    this.name = "DockerError";
    this.kind = kind; // "daemon" | "missing" | "exec" | "timeout" | "command"
    Object.assign(this, detail);
  }
}

const DAEMON_RE = /cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|error during connect|docker desktop is (?:manually )?(?:paused|stopped|not running|starting)|docker\.sock.*(?:no such file|connection refused)/i;
const MISSING_RE = /executable file not found|command not found|no such file or directory|enoent|not found in path/i;

function cleanError(raw) {
  return String(raw || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^Error( response from daemon)?:\s*/i, ""))
    .join(" ")
    .slice(0, 500);
}

async function exec(args, { timeoutMs = 30000, stdin } = {}) {
  const muxy = window.muxy;
  if (!muxy || typeof muxy.exec !== "function") {
    throw new DockerError("The Muxy API isn't available on this page", "exec");
  }
  const options = { timeoutMs };
  if (stdin != null) options.stdin = stdin;
  let res;
  try {
    res = await muxy.exec(["docker", ...args], options);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (MISSING_RE.test(msg)) throw new DockerError("The docker command wasn't found", "missing", { raw: msg });
    throw new DockerError(msg, "exec", { raw: msg });
  }
  if (res.timedOut) {
    throw new DockerError(`docker ${args[0]} timed out`, "timeout");
  }
  if (res.exitCode !== 0) {
    const raw = `${res.stderr || ""}\n${res.stdout || ""}`.trim();
    if (DAEMON_RE.test(raw)) throw new DockerError("The Docker engine isn't running", "daemon", { raw: cleanError(raw) });
    if (res.exitCode === 127 || /docker: (?:command )?not found|exec: "?docker"?: executable file not found/i.test(raw)) {
      throw new DockerError("The docker command wasn't found", "missing", { raw: cleanError(raw) });
    }
    throw new DockerError(cleanError(raw) || `docker ${args[0]} failed (exit ${res.exitCode})`, "command", {
      raw,
      exitCode: res.exitCode,
    });
  }
  return res;
}

async function run(args, opts) {
  return (await exec(args, opts)).stdout || "";
}

function jsonLines(out) {
  const rows = [];
  for (const line of String(out || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      /* skip non-JSON noise such as warnings */
    }
  }
  return rows;
}

// A Go template that prints one JSON object per container, including the
// Compose labels we group by.
const PS_FIELDS = {
  id: ".ID",
  name: ".Names",
  image: ".Image",
  state: ".State",
  status: ".Status",
  ports: ".Ports",
  created: ".RunningFor",
  command: ".Command",
  project: '(.Label "com.docker.compose.project")',
  service: '(.Label "com.docker.compose.service")',
  configFiles: '(.Label "com.docker.compose.project.config_files")',
  workingDir: '(.Label "com.docker.compose.project.working_dir")',
};
const PS_FORMAT = "{" + Object.entries(PS_FIELDS).map(([k, v]) => `"${k}":{{json ${v}}}`).join(",") + "}";

export const api = {
  async version() {
    return (await run(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 30000 })).trim();
  },

  async contextName() {
    return (await run(["context", "show"], { timeoutMs: 10000 })).trim();
  },

  async contexts() {
    return jsonLines(await run(["context", "ls", "--format", "{{json .}}"], { timeoutMs: 10000 })).map((c) => ({
      name: c.Name,
      description: c.Description || "",
      endpoint: c.DockerEndpoint || "",
      current: c.Current === true || c.Current === "true",
      error: c.Error || "",
    }));
  },

  useContext(name) {
    return run(["context", "use", name], { timeoutMs: 15000 });
  },

  async containers() {
    return jsonLines(await run(["ps", "-a", "--format", PS_FORMAT]));
  },

  async stats() {
    const rows = jsonLines(await run(["stats", "--no-stream", "--format", "{{json .}}"], { timeoutMs: 30000 }));
    const byId = {};
    for (const s of rows) {
      const id = String(s.ID || s.Container || "").slice(0, 12);
      if (!id) continue;
      byId[id] = {
        cpu: s.CPUPerc || "",
        mem: s.MemUsage || "",
        memPerc: s.MemPerc || "",
        net: s.NetIO || "",
        block: s.BlockIO || "",
        pids: s.PIDs || "",
      };
    }
    return byId;
  },

  async inspect(id) {
    const parsed = JSON.parse(await run(["container", "inspect", id]));
    return Array.isArray(parsed) ? parsed[0] : parsed;
  },

  // Returns merged stdout/stderr lines in time order.
  async logs(id, tail = 400) {
    const res = await exec(["logs", "--tail", String(tail), "--timestamps", id], { timeoutMs: 20000 });
    return mergeLogs(res.stdout, res.stderr);
  },

  container(verb, id, extra = []) {
    return run(["container", verb, ...extra, id], { timeoutMs: 120000 });
  },

  compose(project, verb, { configFiles = "", workingDir = "" } = {}) {
    const args = ["compose", "-p", project];
    if (verb === "up") {
      for (const f of configFiles.split(",").map((s) => s.trim()).filter(Boolean)) args.push("-f", f);
      if (workingDir) args.push("--project-directory", workingDir);
      args.push("up", "-d");
    } else {
      args.push(verb);
    }
    return run(args, { timeoutMs: 300000 });
  },

  async images() {
    return jsonLines(await run(["image", "ls", "--format", "{{json .}}"])).map((i) => ({
      id: String(i.ID || "").replace(/^sha256:/, "").slice(0, 12),
      repo: i.Repository || "<none>",
      tag: i.Tag || "<none>",
      size: i.Size || "",
      created: i.CreatedSince || "",
      createdAt: i.CreatedAt || "",
    }));
  },

  removeImage(ref, force = false) {
    return run(["image", "rm", ...(force ? ["-f"] : []), ref], { timeoutMs: 120000 });
  },

  pull(ref) {
    return run(["pull", ref], { timeoutMs: 300000 });
  },

  runImage(ref, options = [], command = []) {
    return run(["run", "-d", ...options, ref, ...command], { timeoutMs: 300000 });
  },

  async volumes() {
    const [all, dangling] = await Promise.all([
      run(["volume", "ls", "--format", "{{json .}}"]),
      run(["volume", "ls", "-q", "--filter", "dangling=true"]),
    ]);
    const unused = new Set(dangling.split("\n").map((s) => s.trim()).filter(Boolean));
    return jsonLines(all).map((v) => ({
      name: v.Name,
      driver: v.Driver || "",
      mountpoint: v.Mountpoint || "",
      labels: v.Labels || "",
      inUse: !unused.has(v.Name),
    }));
  },

  removeVolume(name) {
    return run(["volume", "rm", name], { timeoutMs: 60000 });
  },

  async networks() {
    return jsonLines(await run(["network", "ls", "--format", "{{json .}}"])).map((n) => ({
      id: n.ID,
      name: n.Name,
      driver: n.Driver || "",
      scope: n.Scope || "",
      internal: n.Internal === true || n.Internal === "true",
      labels: n.Labels || "",
    }));
  },

  removeNetwork(id) {
    return run(["network", "rm", id], { timeoutMs: 60000 });
  },

  prune(kind, { all = false } = {}) {
    const args = kind === "system" ? ["system", "prune", "-f"] : [kind, "prune", "-f"];
    if (all) args.push("-a");
    return run(args, { timeoutMs: 300000 });
  },

  async diskUsage() {
    return jsonLines(await run(["system", "df", "--format", "{{json .}}"], { timeoutMs: 30000 }));
  },
};

// ---------- helpers ----------

function normalizeTs(ts) {
  // 2026-11-10T12:00:00.12Z -> fixed-width fraction so string order is time order
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(.*)$/.exec(ts);
  if (!m) return ts;
  return `${m[1]}.${(m[2] || "").padEnd(9, "0").slice(0, 9)}${m[3]}`;
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

function mergeLogs(stdout, stderr) {
  const parse = (text, stream) =>
    String(text || "")
      .split("\n")
      .filter((l) => l.length)
      .map((line, i) => {
        const sp = line.indexOf(" ");
        const ts = sp > 0 ? line.slice(0, sp) : "";
        const valid = /^\d{4}-\d\d-\d\dT/.test(ts);
        return {
          ts: valid ? ts : "",
          key: valid ? normalizeTs(ts) : "",
          text: (valid ? line.slice(sp + 1) : line).replace(ANSI_RE, "").replace(/\r/g, ""),
          stream,
          i,
        };
      });
  const out = parse(stdout, "out");
  const err = parse(stderr, "err");
  if (!err.length) return out;
  if (!out.length) return err;
  return [...out, ...err].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.stream === b.stream ? a.i - b.i : 0));
}

// "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 443/tcp" -> published ports
export function parsePorts(text) {
  const out = [];
  const seen = new Set();
  for (const part of String(text || "").split(",")) {
    const m = /^\s*(.*):(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?\/(\w+)\s*$/.exec(part);
    if (!m) continue;
    const [, ip, hostPort, , containerPort, , proto] = m;
    const key = `${hostPort}/${proto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ip: ip.replace(/^\[|\]$/g, ""), hostPort: Number(hostPort), containerPort: Number(containerPort), proto });
  }
  return out.sort((a, b) => a.hostPort - b.hostPort);
}

export function portUrl(p) {
  const local = !p.ip || p.ip === "0.0.0.0" || p.ip === "::" || p.ip === "127.0.0.1" || p.ip === "::1";
  const host = local ? "localhost" : p.ip.includes(":") ? `[${p.ip}]` : p.ip;
  const scheme = p.containerPort === 443 || p.hostPort === 443 ? "https" : "http";
  return `${scheme}://${host}:${p.hostPort}`;
}

// Shell-like splitting for user-typed `docker run` options.
export function splitArgs(s) {
  const out = [];
  let cur = "";
  let quote = null;
  let started = false;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < str.length) cur += str[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < str.length) {
      cur += str[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

// Quote a value for a terminal command line.
export function shq(s) {
  const v = String(s);
  return /^[\w.\/:@%+=,-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}

const UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
export function parseSize(s) {
  const m = /([\d.]+)\s*([kmgt]?i?b)/i.exec(String(s || ""));
  if (!m) return 0;
  return parseFloat(m[1]) * (UNITS[m[2].toLowerCase()] || 1);
}

export function formatBytes(n) {
  if (!n || n < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
