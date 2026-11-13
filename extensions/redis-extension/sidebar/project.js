// Finds the Redis a project is configured to use, from the .env files at the
// project's root: any variable holding a redis:// or rediss:// URL, and
// REDIS_HOST with REDIS_PORT, REDIS_PASSWORD and friends.

import { parseRedisUrl } from "./redis.js";

const PREFERRED = [".env", ".env.local", ".env.development", ".env.development.local", ".env.dev"];
const SKIP = /\.(example|sample|template|dist|defaults?)$/i;

export const isEnvFile = (name) => /^\.env(\.[\w.-]+)?$/.test(name) && !SKIP.test(name);

export function parseEnv(text) {
  const vars = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    vars[m[1]] = v;
  }
  // ${VAR} and $VAR from the same file.
  for (const k of Object.keys(vars)) {
    vars[k] = vars[k].replace(/\$\{(\w+)\}|\$(\w+)/g, (all, a, b) => vars[a || b] ?? all);
  }
  return vars;
}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || ""));

export function envConnections(file, vars) {
  const out = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!/^(rediss?|valkeys?):\/\//i.test(value)) continue;
    const c = parseRedisUrl(value);
    if (c) out.push({ id: `env:${file}:${key}`, kind: "tcp", source: "env", file, envKey: key, ...c, tlsInsecure: false });
  }
  const host = vars.REDIS_HOST || vars.REDIS_HOSTNAME || vars.REDIS_SERVER;
  if (host && !host.includes("://")) {
    out.push({
      id: `env:${file}:REDIS_HOST`,
      kind: "tcp",
      source: "env",
      file,
      envKey: "REDIS_HOST",
      host,
      port: Number(vars.REDIS_PORT) || 6379,
      username: vars.REDIS_USERNAME || vars.REDIS_USER || "",
      password: vars.REDIS_PASSWORD || vars.REDIS_PASS || "",
      db: Number(vars.REDIS_DB ?? vars.REDIS_DATABASE) || 0,
      tls: truthy(vars.REDIS_TLS) || truthy(vars.REDIS_SSL),
      tlsInsecure: false,
    });
  }
  return out;
}

export async function findEnvConnections(muxy) {
  let names;
  try {
    names = (await muxy.files.list("")).filter((e) => !e.isDirectory && isEnvFile(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
  const rank = (n) => (PREFERRED.includes(n) ? PREFERRED.indexOf(n) : PREFERRED.length);
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const found = [];
  const seen = new Set();
  for (const file of names.slice(0, 8)) {
    let content = "";
    try {
      content = (await muxy.files.read(file))?.content || "";
    } catch {
      continue;
    }
    for (const c of envConnections(file, parseEnv(content))) {
      const sig = [c.host, c.port, c.db, c.username, c.password, c.tls].join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      found.push(c);
    }
  }
  return found;
}
