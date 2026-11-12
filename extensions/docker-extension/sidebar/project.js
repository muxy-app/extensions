// Finds Dockerfiles and Compose files in the current Muxy project and reads
// what the sidebar shows about them. It only uses the read-only files API
// (files:read): nothing here writes files or runs programs.

const DOCKERFILE_RE = /^(?:dockerfile|containerfile)(?:[._-][\w.-]+)?$|^[\w.-]+\.(?:dockerfile|containerfile)$/i;
// Names like Dockerfile.md, dockerfile_test.go or Dockerfile.dockerignore aren't Dockerfiles.
const NOT_DOCKERFILE_RE =
  /\.(?:dockerignore|md|mdx|txt|rst|orig|bak|swp|tmpl|tpl|j2|jinja2?|template|erb|in|sample|example|go|js|mjs|cjs|ts|tsx|jsx|py|rb|rs|java|kt|c|h|cc|cpp|cs|php|swift|sh|bash|ps1|json|ya?ml|toml|lock|snap|html|css|xml|ini|cfg|conf|log|diff|patch)$/i;
const COMPOSE_RE = /^(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$/i;
const DEFAULT_COMPOSE_RE = /^(?:docker-)?compose\.ya?ml$/i;
// Compose merges these into the default file next to them on its own.
const OVERRIDE_RE = /^(?:docker-)?compose\.override\.ya?ml$/i;

// Folders that hold dependencies or build output. Git-ignored folders and
// other dot folders are skipped too.
const SKIP_DIRS = new Set([
  "node_modules", "bower_components", "jspm_packages", "vendor", "pods", "carthage", "deriveddata",
  "__pycache__", "venv", "site-packages", "target", "dist", "coverage", "tmp", "temp", "logs",
]);
const DOT_DIRS = new Set([".devcontainer", ".docker"]);

export const MAX_DEPTH = 5;
export const MAX_DIRS = 600;
export const MAX_DOCKERFILES = 50;
const CONCURRENCY = 8;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const isDockerfileName = (name) => DOCKERFILE_RE.test(name) && !NOT_DOCKERFILE_RE.test(name);
export const isComposeName = (name) => COMPOSE_RE.test(name);
export const isWatchedName = (name) => isDockerfileName(name) || isComposeName(name);

export function splitPath(path) {
  const i = path.lastIndexOf("/");
  return { dir: i < 0 ? "" : path.slice(0, i), name: path.slice(i + 1) };
}

const join = (dir, name) => (dir ? `${dir}/${name}` : name);
const depthOf = (path) => path.split("/").length;
const byPath = (a, b) => depthOf(a) - depthOf(b) || collator.compare(a, b);

function skipDir(name, entry) {
  if (entry.isIgnored) return true;
  const lower = name.toLowerCase();
  if (lower.startsWith(".")) return !DOT_DIRS.has(lower);
  return SKIP_DIRS.has(lower);
}

// Walks the project breadth-first, a few folders at a time.
export async function findDockerFiles(files) {
  const dockerfiles = [];
  const compose = [];
  const overrides = [];
  const queue = [{ dir: "", depth: 0 }];
  let listed = 0;
  while (queue.length && listed < MAX_DIRS) {
    const batch = queue.splice(0, Math.min(CONCURRENCY, MAX_DIRS - listed));
    listed += batch.length;
    const results = await Promise.all(
      batch.map((d) =>
        files.list(d.dir).then(
          (entries) => ({ d, entries }),
          (err) => {
            if (!d.dir) throw err; // the project folder itself
            return { d, entries: [] };
          }
        )
      )
    );
    for (const { d, entries } of results) {
      for (const e of Array.isArray(entries) ? entries : []) {
        const name = e.name || String(e.path || "").split("/").pop();
        if (!name) continue;
        const path = join(d.dir, name);
        if (e.isDirectory) {
          if (d.depth < MAX_DEPTH && !skipDir(name, e)) queue.push({ dir: path, depth: d.depth + 1 });
        } else if (isDockerfileName(name)) {
          dockerfiles.push(path);
        } else if (OVERRIDE_RE.test(name)) {
          overrides.push(path);
        } else if (COMPOSE_RE.test(name)) {
          compose.push(path);
        }
      }
    }
  }

  const composeFiles = compose.sort(byPath).map((path) => {
    const { dir, name } = splitPath(path);
    const files = [name];
    if (DEFAULT_COMPOSE_RE.test(name)) {
      const family = name.startsWith("docker-") ? "docker-" : "";
      const near = overrides.map(splitPath).filter((o) => o.dir === dir);
      const override = near.find((o) => o.name.startsWith(family) === !!family) || near[0];
      if (override) files.push(override.name);
    }
    return { path, dir, name, files };
  });

  return { dockerfiles: dockerfiles.sort(byPath), composeFiles, truncated: queue.length > 0 };
}

// ---------------------------------------------------------------- Dockerfile

function substitute(str, vars) {
  return String(str).replace(/\$\{(\w+)(?::?([-+])([^}]*))?\}|\$(\w+)/g, (all, name, op, word, bare) => {
    if (bare) return vars[bare] ?? all;
    const value = vars[name];
    if (op === "-") return value || word;
    if (op === "+") return value ? word : "";
    return value ?? all;
  });
}

const unquote = (s) => String(s).replace(/^(["'])([\s\S]*)\1$/, "$2");

function argPairs(rest) {
  return rest
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const i = w.indexOf("=");
      return i < 0 ? [w, undefined] : [w.slice(0, i), unquote(w.slice(i + 1))];
    });
}

function envPairs(rest) {
  if (!/^[\w.-]+=/.test(rest)) {
    const m = /^(\S+)\s+([\s\S]*)$/.exec(rest);
    return m ? [[m[1], unquote(m[2].trim())]] : [];
  }
  const out = [];
  const re = /([\w.-]+)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g;
  let m;
  while ((m = re.exec(rest))) out.push([m[1], unquote(m[2])]);
  return out;
}

// Splits a Dockerfile into instructions: joins continuation lines and skips
// comments, blank lines, and heredoc bodies.
function instructions(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let escape = "\\";
  for (const line of lines) {
    const m = /^\s*#\s*(\w+)\s*=\s*(\S+)\s*$/.exec(line);
    if (!m) break;
    if (m[1].toLowerCase() === "escape" && (m[2] === "`" || m[2] === "\\")) escape = m[2];
  }
  const out = [];
  let cur = null;
  let heredoc = null;
  for (const raw of lines) {
    if (heredoc) {
      const line = (heredoc.strip ? raw.replace(/^\t+/, "") : raw).trimEnd();
      if (line === heredoc.word) heredoc = null;
      continue;
    }
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const body = raw.trimEnd();
    const cont = body.endsWith(escape);
    const piece = (cont ? body.slice(0, -1) : body).trim();
    cur = cur == null ? piece : `${cur} ${piece}`;
    if (cont) continue;
    out.push(cur);
    const hd = /^(?:RUN|COPY|ADD)\b.*?<<(-?)(["']?)([A-Za-z_][\w-]*)\2/i.exec(cur);
    if (hd) heredoc = { strip: hd[1] === "-", word: hd[3] };
    cur = null;
  }
  if (cur) out.push(cur);
  return out;
}

// Returns the build stages, the final stage's base image, and the ports it exposes.
export function parseDockerfile(text) {
  const globals = {};
  const stages = [];
  let vars = {};
  for (const ins of instructions(text)) {
    const m = /^(\w+)\s*([\s\S]*)$/.exec(ins);
    if (!m) continue;
    const kw = m[1].toUpperCase();
    const rest = m[2].trim();
    if (kw === "ARG") {
      for (const [k, v] of argPairs(rest)) {
        if (!stages.length) globals[k] = v ?? globals[k] ?? "";
        else vars[k] = v ?? vars[k] ?? globals[k] ?? "";
      }
    } else if (kw === "FROM") {
      const words = rest.split(/\s+/).filter((w) => w && !w.startsWith("--"));
      const image = substitute(words[0] || "", globals);
      const name = words[1] && words[1].toUpperCase() === "AS" ? words[2] || "" : "";
      stages.push({ image, name, ports: [] });
      vars = {};
    } else if (kw === "ENV" && stages.length) {
      for (const [k, v] of envPairs(rest)) vars[k] = substitute(v, { ...globals, ...vars });
    } else if (kw === "EXPOSE" && stages.length) {
      for (const w of rest.split(/\s+/).filter(Boolean)) {
        const pm = /^(\d+(?:-\d+)?)(?:\/(tcp|udp|sctp))?$/i.exec(substitute(w, { ...globals, ...vars }));
        if (pm) stages[stages.length - 1].ports.push({ port: pm[1], proto: (pm[2] || "tcp").toLowerCase() });
      }
    }
  }

  // Follow `FROM <earlier stage>` back to a real image; EXPOSE carries over.
  const byName = new Map(stages.filter((s) => s.name).map((s) => [s.name.toLowerCase(), s]));
  const final = stages[stages.length - 1];
  let base = final ? final.image : "";
  const ports = final ? [...final.ports] : [];
  const seen = new Set();
  let s = final;
  while (s && !seen.has(s) && byName.has(s.image.toLowerCase())) {
    seen.add(s);
    s = byName.get(s.image.toLowerCase());
    base = s.image;
    ports.push(...s.ports);
  }
  const uniquePorts = [];
  const keys = new Set();
  for (const p of ports) {
    const key = `${p.port}/${p.proto}`;
    if (keys.has(key)) continue;
    keys.add(key);
    uniquePorts.push(p);
  }
  return { stages: stages.map(({ image, name }) => ({ image, name })), base, ports: uniquePorts };
}

// ---------------------------------------------------------------- naming

// Folder names that say where a Dockerfile lives rather than what it builds.
const NAME_NOISE = new Set([
  "docker", "dockerfiles", "build", "package", "packaging", "deploy", "deployment", "deployments",
  "ci", "infra", "containers", "container", "images", "services", "apps", "packages", "src", "cmd",
]);
// A Dockerfile in one of these usually builds from the folder above it.
const CONTEXT_NOISE = new Set([
  "docker", ".docker", "dockerfiles", "build", "package", "packaging", "deploy", "deployment",
  "deployments", "ci", ".ci", "infra", "containers",
]);

export function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function variantOf(file) {
  const m = /^(?:dockerfile|containerfile)[._-](.+)$/i.exec(file) || /^(.+)\.(?:dockerfile|containerfile)$/i.exec(file);
  return m ? m[1] : "";
}

// Image names for each Dockerfile: the project's name, plus the folder and
// variant when there's more than one, e.g. shop, shop-api, shop-dev.
export function imageNames(projectName, paths) {
  const base = slug(projectName) || "app";
  const used = new Set();
  const named = (parts) => {
    const suffix = slug(parts.join("-"));
    return suffix && suffix !== base ? `${base}-${suffix}` : base;
  };
  return paths.map((path) => {
    const parts = path.split("/");
    const variant = variantOf(parts.pop());
    const short = named([...parts.filter((p) => !NAME_NOISE.has(p.toLowerCase().replace(/^\.+/, ""))), variant]);
    const long = named([...parts, variant]);
    let name = !used.has(short) ? short : long;
    for (let i = 2; used.has(name); i++) name = `${long}-${i}`;
    used.add(name);
    return name;
  });
}

export function defaultContext(path) {
  const parts = path.split("/");
  parts.pop();
  while (parts.length && CONTEXT_NOISE.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts.join("/") || ".";
}

// What `docker compose` calls a project when the file doesn't set `name`.
export function composeProjectName(folder) {
  return String(folder || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[^a-z0-9]+/, "");
}
