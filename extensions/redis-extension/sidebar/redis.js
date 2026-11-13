// Talks to Redis without a client library or redis-cli.
//
// Muxy pages can't open sockets, so each call encodes its commands as RESP,
// pipes them through one fixed shell command that opens the connection (nc,
// openssl s_client for TLS, or nc inside a Docker container), and parses the
// replies here. Both directions cross the pipe as base64, so binary keys and
// values survive. Every call ends with QUIT, so Redis closes the connection
// and the command exits as soon as the last reply is in.

export class RedisError extends Error {
  constructor(message, kind = "command", detail = {}) {
    super(message);
    this.name = "RedisError";
    // refused | timeout | dns | tls | auth | noauth | denied | missing | docker
    // | exec | protocol | toolarge | db | command
    this.kind = kind;
    Object.assign(this, detail);
  }
}

// An error reply (-ERR …) inside a pipeline. Not thrown: the other replies
// in the same pipeline are still good.
export class ReplyError {
  constructor(message) {
    this.message = String(message);
  }
  toString() {
    return this.message;
  }
}

// A status reply (+OK) in console mode, where it prints differently from a
// bulk string ("OK").
export class Status {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

export const isErr = (r) => r instanceof ReplyError;

// The connection itself is broken, as opposed to one command failing.
const CONN_KINDS = new Set(["refused", "timeout", "dns", "tls", "auth", "noauth", "denied", "missing", "docker", "exec", "protocol"]);
export const isConnError = (e) => e instanceof RedisError && CONN_KINDS.has(e.kind);

const enc = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true });
const loose = new TextDecoder("utf-8");
const CRLF = new Uint8Array([13, 10]);

// ---------------------------------------------------------------- RESP

function bytesOf(v) {
  return v instanceof Uint8Array ? v : enc.encode(String(v));
}

export function encodeCommands(cmds) {
  const parts = [];
  let total = 0;
  const push = (b) => {
    parts.push(b);
    total += b.length;
  };
  for (const cmd of cmds) {
    push(enc.encode(`*${cmd.length}\r\n`));
    for (const arg of cmd) {
      const b = bytesOf(arg);
      push(enc.encode(`$${b.length}\r\n`));
      push(b);
      push(CRLF);
    }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  let s = String(text || "").replace(/[^A-Za-z0-9+/=]/g, "");
  s = s.slice(0, s.length - (s.length % 4));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class Incomplete extends Error {}

// Text when it's valid UTF-8, otherwise the raw bytes.
function bulkValue(b) {
  try {
    return utf8.decode(b);
  } catch {
    return b.slice();
  }
}

function intValue(s) {
  const v = Number(s);
  return Number.isSafeInteger(v) ? v : s;
}

export function parseReplies(buf, { status = false } = {}) {
  let pos = 0;
  const n = buf.length;

  function line() {
    let i = pos;
    while (i < n - 1 && !(buf[i] === 13 && buf[i + 1] === 10)) i++;
    if (i >= n - 1) throw new Incomplete();
    const s = loose.decode(buf.subarray(pos, i));
    pos = i + 2;
    return s;
  }

  function bulk() {
    const len = parseInt(line(), 10);
    if (!(len >= 0)) return null;
    if (pos + len + 2 > n) throw new Incomplete();
    const b = buf.subarray(pos, pos + len);
    pos += len + 2;
    return bulkValue(b);
  }

  function aggregate(pairs = false) {
    const len = parseInt(line(), 10);
    if (!(len >= 0)) return null;
    const out = [];
    for (let i = 0; i < len * (pairs ? 2 : 1); i++) out.push(read());
    return out;
  }

  function read() {
    if (pos >= n) throw new Incomplete();
    const t = buf[pos++];
    switch (t) {
      case 43: // + status
        return status ? new Status(line()) : line();
      case 45: // - error
        return new ReplyError(line());
      case 58: // : integer
        return intValue(line());
      case 36: // $ bulk string
        return bulk();
      case 42: // * array
      case 126: // ~ set (RESP3)
      case 62: // > push (RESP3)
        return aggregate();
      case 37: // % map (RESP3), flattened like RESP2
        return aggregate(true);
      case 124: // | attributes (RESP3): skip them
        aggregate(true);
        return read();
      case 95: // _ null
        line();
        return null;
      case 35: // # boolean
        return line() === "t" ? 1 : 0;
      case 44: // , double
        return line();
      case 40: // ( big number
        return line();
      case 33: {
        // ! bulk error
        const s = bulk();
        return new ReplyError(typeof s === "string" ? s : loose.decode(s));
      }
      case 61: {
        // = verbatim string: "txt:" prefix
        const s = bulk();
        return typeof s === "string" ? s.slice(4) : s;
      }
      default:
        throw new RedisError("The server didn't answer in the Redis protocol", "protocol");
    }
  }

  const replies = [];
  let complete = true;
  while (pos < n) {
    const start = pos;
    try {
      replies.push(read());
    } catch (e) {
      if (!(e instanceof Incomplete)) throw e;
      complete = false;
      pos = start;
      break;
    }
  }
  return { replies, complete };
}

// ---------------------------------------------------------------- transport

// The only shell commands this extension runs. Host and port come in through
// the environment, so each string stays fixed and Muxy's "Allow & Remember"
// covers every connection, and nothing in a host name is read as shell syntax.
const TCP = 'base64 -d | nc "$MUXY_REDIS_HOST" "$MUXY_REDIS_PORT" | base64';
const TLS = {
  verify: 'base64 -d | openssl s_client -quiet -verify 9 -verify_return_error -connect "$MUXY_REDIS_TARGET" -servername "$MUXY_REDIS_HOST" | base64',
  verifyIp: 'base64 -d | openssl s_client -quiet -verify 9 -verify_return_error -connect "$MUXY_REDIS_TARGET" | base64',
  insecure: 'base64 -d | openssl s_client -quiet -connect "$MUXY_REDIS_TARGET" -servername "$MUXY_REDIS_HOST" | base64',
  insecureIp: 'base64 -d | openssl s_client -quiet -connect "$MUXY_REDIS_TARGET" | base64',
};

// Runs inside a Redis container: Alpine images have BusyBox nc, Debian ones
// have bash and its /dev/tcp.
const IN_CONTAINER =
  'base64 -d | if command -v nc >/dev/null 2>&1; then nc 127.0.0.1 "$1"; ' +
  "elif command -v bash >/dev/null 2>&1; then bash -c 'exec 3<>\"/dev/tcp/127.0.0.1/$0\" && cat >&3 && cat <&3' \"$1\"; " +
  'else echo "muxy-redis: the container has neither nc nor bash" >&2; exit 127; fi | base64';

const isIp = (host) => /^[\d.]+$/.test(host) || host.includes(":");

function muxyApi() {
  const m = window.muxy;
  if (!m || typeof m.exec !== "function") throw new RedisError("The Muxy API isn't available on this page", "exec");
  return m;
}

// Keeps a burst of calls from starting dozens of processes at once.
let active = 0;
const waiting = [];
async function slot(fn) {
  if (active >= 4) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function describeConn(c) {
  if (!c) return "Redis";
  if (c.kind === "docker") return `the container ${c.container}`;
  return hostPort(c);
}

export function hostPort(c) {
  const host = c.host || "127.0.0.1";
  return `${host.includes(":") ? `[${host}]` : host}:${c.port || 6379}`;
}

function transport(conn, stdin, timeoutMs) {
  const m = muxyApi();
  if (conn.kind === "docker") {
    return m.exec(["docker", "exec", "-i", conn.container, "sh", "-c", IN_CONTAINER, "sh", String(conn.port || 6379)], { stdin, timeoutMs });
  }
  const host = String(conn.host || "127.0.0.1").trim();
  const port = String(conn.port || 6379);
  const env = {
    MUXY_REDIS_HOST: host,
    MUXY_REDIS_PORT: port,
    MUXY_REDIS_TARGET: host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`,
  };
  const shell = conn.tls ? TLS[(conn.tlsInsecure ? "insecure" : "verify") + (isIp(host) ? "Ip" : "")] : TCP;
  // With the { shell } form, Muxy reads the options from the same object.
  return m.exec({ shell, env, stdin, timeoutMs });
}

const DOCKER_DOWN = /cannot connect to the docker daemon|is the docker daemon running|docker desktop is (?:manually )?(?:paused|stopped|not running|starting)|error during connect/i;

function firstLine(s) {
  return (
    String(s || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^(depth=|verify return:|verify error:num=0)/.test(l)) || ""
  );
}

// Nothing came back: say why, from what the programs printed.
function transportError(conn, res) {
  const err = String(res.stderr || "").trim();
  const where = describeConn(conn);
  if (res.timedOut) return new RedisError(`Timed out waiting for ${where}${conn.tls ? ". Does it use TLS?" : ""}`, "timeout");
  if (conn.kind === "docker") {
    if (DOCKER_DOWN.test(err)) return new RedisError("Docker isn't running", "docker");
    if (/no such container/i.test(err)) return new RedisError(`There's no container named ${conn.container}`, "docker");
    if (/is not running|is paused|is restarting/i.test(err)) return new RedisError(`The container ${conn.container} isn't running`, "docker");
    if (/muxy-redis: the container has neither/.test(err)) return new RedisError(`The container ${conn.container} has neither nc nor bash to connect with`, "docker");
    if (/executable file not found|docker: (?:command )?not found/i.test(err)) return new RedisError("The docker command wasn't found", "missing");
  }
  const missing = /(?:^|\s|:)([\w.-]+): (?:command )?not found/i.exec(err);
  if (missing || res.exitCode === 127) {
    const prog = missing?.[1] || (conn.tls ? "openssl" : "nc");
    return new RedisError(`${prog} wasn't found on this computer`, "missing", { raw: err });
  }
  if (/verify error|certificate verify failed|unable to get local issuer|self[- ]signed/i.test(err)) {
    return new RedisError(`The TLS certificate of ${where} isn't trusted`, "tls", { raw: err });
  }
  if (/wrong version number|unknown protocol|handshake failure|tlsv1 alert|ssl3_get_record|packet length too long/i.test(err)) {
    return new RedisError(`TLS didn't work with ${where}. Does it use TLS?`, "tls", { raw: err });
  }
  if (/nodename nor servname|not known|could not resolve|getaddrinfo|no address associated|name resolution/i.test(err)) {
    return new RedisError(`Couldn't find the host ${conn.host}`, "dns", { raw: err });
  }
  if (!err || /refused|connect: |connection reset/i.test(err)) {
    return new RedisError(`Nothing answered at ${where}`, "refused", { raw: err });
  }
  return new RedisError(firstLine(err) || `Couldn't reach ${where}`, "refused", { raw: err });
}

function authMessage(msg) {
  if (/WRONGPASS|invalid password|invalid username-password/i.test(msg)) return "Wrong user name or password";
  return msg.replace(/^ERR\s+/, "");
}

// Sends `cmds` (arrays of arguments) in one connection and returns one reply
// per command, in order. Error replies come back as ReplyError; connection
// problems, a wrong password, or a missing database throw a RedisError.
export async function call(conn, cmds, { db, timeoutMs = 15000, status = false } = {}) {
  if (!conn) throw new RedisError("No connection", "exec");
  const pre = [];
  if (conn.password) pre.push(conn.username ? ["AUTH", conn.username, conn.password] : ["AUTH", conn.password]);
  const dbn = Number(db ?? conn.db ?? 0) || 0;
  if (dbn) pre.push(["SELECT", String(dbn)]);
  const all = [...pre, ...cmds, ["QUIT"]];
  const stdin = toBase64(encodeCommands(all));

  let res;
  try {
    res = await slot(() => transport(conn, stdin, timeoutMs));
  } catch (err) {
    const msg = err?.message || String(err);
    if (/denied|not allowed|cancel/i.test(msg)) throw new RedisError(msg, "exec", { denied: true });
    throw new RedisError(msg, "exec");
  }

  const raw = fromBase64(res.stdout || "");
  if (!raw.length) throw transportError(conn, res);
  let replies;
  try {
    ({ replies } = parseReplies(raw, { status }));
  } catch {
    throw new RedisError(`${describeConn(conn)} doesn't look like a Redis server`, "protocol");
  }

  // Refused before reading anything: protected mode, too many clients.
  const first = replies[0];
  if (isErr(first) && /^(DENIED|ERR max number of clients)/.test(first.message)) {
    throw new RedisError(first.message.replace(/^DENIED\s+/, ""), "denied");
  }

  let i = 0;
  if (conn.password) {
    const r = replies[i++];
    if (isErr(r) && !/without any password configured|no password is set|Client sent AUTH, but no password is set/i.test(r.message)) {
      throw new RedisError(authMessage(r.message), "auth");
    }
  }
  if (dbn) {
    const r = replies[i++];
    if (isErr(r)) throw new RedisError(`Can't use database ${dbn}: ${r.message.replace(/^ERR\s+/, "")}`, "db");
  }

  const out = replies.slice(i, i + cmds.length);
  if (out.length < cmds.length) {
    if (res.timedOut) throw new RedisError(`Timed out waiting for ${describeConn(conn)}`, "timeout");
    if (res.truncated) throw new RedisError("The reply was too large to show", "toolarge");
    const last = replies[replies.length - 1];
    throw new RedisError(isErr(last) ? last.message : "The connection closed before Redis answered", "protocol");
  }
  if (out.some((r) => isErr(r) && /^NOAUTH\b/.test(r.message))) {
    throw new RedisError("This Redis needs a password", "noauth");
  }
  return out;
}

// One command; an error reply throws.
export async function run(conn, cmd, opts) {
  const [r] = await call(conn, [cmd], opts);
  if (isErr(r)) throw new RedisError(r.message, "command");
  return r;
}

// ---------------------------------------------------------------- Docker

const REDIS_IMAGE = /redis|valkey|keydb|dragonfly|garnet/i;

function dockerError(res) {
  const err = `${res.stderr || ""}\n${res.stdout || ""}`.trim();
  if (DOCKER_DOWN.test(err)) return new RedisError("Docker isn't running", "daemon");
  if (res.exitCode === 127 || /not found/i.test(err)) return new RedisError("The docker command wasn't found", "missing");
  return new RedisError(firstLine(err) || `docker failed (exit ${res.exitCode})`, "command");
}

async function docker(args, timeoutMs = 15000) {
  const m = muxyApi();
  let res;
  try {
    res = await m.exec(["docker", ...args], { timeoutMs });
  } catch (err) {
    const msg = err?.message || String(err);
    throw new RedisError(msg, /not found|enoent/i.test(msg) ? "missing" : "exec");
  }
  if (res.timedOut) throw new RedisError("docker timed out", "timeout");
  if (res.exitCode !== 0) throw dockerError(res);
  return res.stdout || "";
}

function parseLabels(s) {
  const out = {};
  for (const part of String(s || "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

// Running containers that look like Redis (or Valkey, KeyDB, Dragonfly).
export async function dockerRedisContainers() {
  const out = await docker(["ps", "--format", "{{json .}}"]);
  const rows = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let c;
    try {
      c = JSON.parse(t);
    } catch {
      continue;
    }
    const name = String(c.Names || "").split(",")[0];
    if (!REDIS_IMAGE.test(`${c.Image} ${name}`)) continue;
    const labels = parseLabels(c.Labels);
    const ports = String(c.Ports || "");
    const pub = /(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]|::):(\d+)->(\d+)\/tcp/.exec(ports);
    rows.push({
      name,
      image: c.Image || "",
      status: c.Status || "",
      publishedPort: pub ? Number(pub[1]) : null,
      project: labels["com.docker.compose.project"] || "",
      service: labels["com.docker.compose.service"] || "",
      workingDir: labels["com.docker.compose.project.working_dir"] || "",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// What it takes to connect to a container: the port Redis listens on inside
// it, and the password, when the container's command line or environment
// sets one (--requirepass "$REDIS_PASSWORD", REDIS_PASSWORD=…).
export async function dockerConnInfo(container) {
  const out = await docker(["container", "inspect", container]);
  const ins = JSON.parse(out)[0] || {};
  const cfg = ins.Config || {};
  const env = {};
  for (const e of cfg.Env || []) {
    const i = e.indexOf("=");
    if (i > 0) env[e.slice(0, i)] = e.slice(i + 1);
  }
  const args = [...(cfg.Entrypoint || []), ...(cfg.Cmd || []), env.REDIS_ARGS || "", env.REDIS_EXTRA_FLAGS || "", env.VALKEY_EXTRA_FLAGS || ""].join(" ");
  const portArg = /--port[\s=]+(\d+)/.exec(args);
  let password = "";
  let passwordEnv = "";
  const pass = /--requirepass[\s=]+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(args);
  if (pass) {
    const v = pass[1] ?? pass[2] ?? pass[3] ?? "";
    const ref = /^\$\{?(\w+)\}?$/.exec(v);
    if (ref) {
      password = env[ref[1]] || "";
      passwordEnv = ref[1];
    } else {
      password = v;
    }
  } else {
    for (const k of ["REDIS_PASSWORD", "VALKEY_PASSWORD", "KEYDB_PASSWORD", "REDISCLI_AUTH", "REDIS_PASS"]) {
      if (env[k]) {
        password = env[k];
        passwordEnv = k;
        break;
      }
    }
  }
  return {
    running: ins.State?.Running === true,
    status: ins.State?.Status || "",
    port: portArg ? Number(portArg[1]) : 6379,
    password,
    passwordEnv,
    image: cfg.Image || "",
  };
}

// ---------------------------------------------------------------- parsing helpers

export function parseInfo(text) {
  const out = { _sections: {} };
  let sec = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      sec = line.slice(1).trim().toLowerCase();
      out._sections[sec] = out._sections[sec] || {};
      continue;
    }
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    out[k] = v;
    (out._sections[sec] = out._sections[sec] || {})[k] = v;
  }
  return out;
}

// "keys=1,expires=0,avg_ttl=0" -> { keys: 1, expires: 0, avg_ttl: 0 }
export function parseFields(s) {
  const out = {};
  for (const part of String(s || "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const v = part.slice(i + 1);
    out[part.slice(0, i)] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}

export function keyspace(info) {
  const out = {};
  for (const [k, v] of Object.entries(info || {})) {
    const m = /^db(\d+)$/.exec(k);
    if (m) out[m[1]] = parseFields(v);
  }
  return out;
}

export function parseClientList(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const o = {};
      for (const part of line.split(" ")) {
        const i = part.indexOf("=");
        if (i > 0) o[part.slice(0, i)] = part.slice(i + 1);
      }
      return o;
    });
}

// redis-cli's argument rules: "double quotes" with \n \t \xHH escapes,
// 'single quotes' with only \' escaped. An argument with \xHH bytes that
// aren't valid UTF-8 comes back as a Uint8Array.
export function splitCommandLine(line) {
  const s = String(line);
  const args = [];
  let i = 0;
  const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const isHex = (c) => c !== undefined && /[0-9a-fA-F]/.test(c);
  for (;;) {
    while (i < s.length && isSpace(s[i])) i++;
    if (i >= s.length) return args;
    const bytes = [];
    let raw = false;
    const add = (str) => {
      for (const b of enc.encode(str)) bytes.push(b);
    };
    let mode = "plain";
    for (;;) {
      const c = s[i];
      if (mode === "dq") {
        if (c === undefined) throw new Error("Unbalanced quotes");
        if (c === "\\" && s[i + 1] === "x" && isHex(s[i + 2]) && isHex(s[i + 3])) {
          const b = parseInt(s.substr(i + 2, 2), 16);
          if (b > 0x7f) raw = true;
          bytes.push(b);
          i += 4;
          continue;
        }
        if (c === "\\" && i + 1 < s.length) {
          const e = s[i + 1];
          add({ n: "\n", r: "\r", t: "\t", b: "\b", a: "\x07" }[e] ?? e);
          i += 2;
          continue;
        }
        if (c === '"') {
          if (i + 1 < s.length && !isSpace(s[i + 1])) throw new Error("A closing quote must be followed by a space");
          i++;
          break;
        }
        add(c);
        i++;
      } else if (mode === "sq") {
        if (c === undefined) throw new Error("Unbalanced quotes");
        if (c === "\\" && s[i + 1] === "'") {
          add("'");
          i += 2;
          continue;
        }
        if (c === "'") {
          if (i + 1 < s.length && !isSpace(s[i + 1])) throw new Error("A closing quote must be followed by a space");
          i++;
          break;
        }
        add(c);
        i++;
      } else {
        if (c === undefined || isSpace(c)) break;
        if (c === '"') mode = "dq";
        else if (c === "'") mode = "sq";
        else add(c);
        i++;
      }
    }
    const b = new Uint8Array(bytes);
    if (raw) {
      try {
        args.push(utf8.decode(b));
      } catch {
        args.push(b);
      }
    } else {
      args.push(loose.decode(b));
    }
  }
}

// Bytes as redis-cli prints them: printable ASCII as is, the rest as \xHH.
export function escapeBinary(bytes) {
  let s = "";
  for (const b of bytes) {
    if (b === 0x5c) s += "\\\\";
    else if (b === 0x22) s += '\\"';
    else if (b === 10) s += "\\n";
    else if (b === 13) s += "\\r";
    else if (b === 9) s += "\\t";
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else s += "\\x" + b.toString(16).padStart(2, "0");
  }
  return s;
}

// A key or value as display text.
export function showText(v) {
  if (v == null) return "";
  return v instanceof Uint8Array ? escapeBinary(v) : String(v);
}

function quote(s) {
  return `"${s.replace(/[\\"\x00-\x1f\x7f]/g, (c) => {
    if (c === "\\") return "\\\\";
    if (c === '"') return '\\"';
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0");
  })}"`;
}

// A reply as redis-cli prints it.
export function formatReply(r, pad = "") {
  if (r === null || r === undefined) return "(nil)";
  if (isErr(r)) return `(error) ${r.message}`;
  if (r instanceof Status) return r.text;
  if (typeof r === "number") return `(integer) ${r}`;
  if (r instanceof Uint8Array) return `"${escapeBinary(r)}"`;
  if (Array.isArray(r)) {
    if (!r.length) return "(empty array)";
    const w = String(r.length).length;
    return r
      .map((x, i) => {
        const label = `${String(i + 1).padStart(w)}) `;
        return (i ? pad : "") + label + formatReply(x, pad + " ".repeat(label.length));
      })
      .join("\n");
  }
  return quote(String(r));
}

// redis://user:pass@host:port/db and rediss:// (TLS).
export function parseRedisUrl(url) {
  const s = String(url || "").trim();
  const m = /^(rediss?|valkeys?):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?(\[[^\]]+\]|[^:/?#]*)(?::(\d+))?(?:\/(\d+))?/i.exec(s);
  if (!m) return null;
  const dec = (v) => {
    try {
      return decodeURIComponent(v || "");
    } catch {
      return v || "";
    }
  };
  const user = dec(m[2]);
  return {
    tls: /^(rediss|valkeys)$/i.test(m[1]),
    username: user === "default" ? "" : user,
    password: dec(m[3]),
    host: (m[4] || "127.0.0.1").replace(/^\[|\]$/g, ""),
    port: m[5] ? Number(m[5]) : 6379,
    db: m[6] ? Number(m[6]) : 0,
  };
}

export function connUrl(c, { password = false } = {}) {
  const auth =
    c.username || (password && c.password)
      ? `${encodeURIComponent(c.username || "default")}${password && c.password ? `:${encodeURIComponent(c.password)}` : ""}@`
      : "";
  return `${c.tls ? "rediss" : "redis"}://${auth}${hostPort(c)}${c.db ? `/${c.db}` : ""}`;
}

// Escape glob characters so a literal string matches only itself in SCAN MATCH.
export const escapeGlob = (s) => String(s).replace(/[\\*?[\]]/g, "\\$&");

export function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
