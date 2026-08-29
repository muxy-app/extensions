// Everything that talks to the outside world.
//
// Reads go through `glab api`, which speaks the GitLab REST API directly, so
// the response shapes are GitLab's documented ones rather than glab's porcelain
// output. Writes go through glab's own subcommands (`glab mr merge`, …).
//
// Both are pinned to one instance and one project, derived from the git remote:
// reads pass `--hostname <host>`, writes pass `-R <web_url>`. That is what makes
// a self-managed instance work the same as gitlab.com — nothing depends on
// glab's own guess about which remote is the GitLab one.

const MISSING_RE = /command not found|no such file|executable file not found|not found in \$path/i;
const AUTH_RE = /401|invalid_token|token is expired|not logged in|no token|authentication|unauthorized|please run .*auth login/i;
const NOT_FOUND_RE = /404|project not found|not found/i;

/** An error carrying a `kind` the UI can branch on to show the right screen. */
export class GlabError extends Error {
  constructor(kind, message, raw = "") {
    super(message);
    this.name = "GlabError";
    this.kind = kind; // missing | auth | not-found | no-repo | failed
    this.raw = raw;
  }
}

function classify(output) {
  const text = String(output || "");
  if (MISSING_RE.test(text)) return "missing";
  if (AUTH_RE.test(text)) return "auth";
  if (NOT_FOUND_RE.test(text)) return "not-found";
  return "failed";
}

/** Wrapper around muxy.exec. `cwd` empty means the active project directory. */
export async function exec(argv, cwd = "") {
  if (!window.muxy || typeof window.muxy.exec !== "function") {
    throw new GlabError("failed", "muxy.exec is unavailable (requires the commands:exec permission).");
  }
  let res;
  try {
    res = cwd ? await window.muxy.exec(argv, { cwd }) : await window.muxy.exec(argv);
  } catch (e) {
    // A missing binary can surface as a rejection rather than a non-zero exit,
    // so the thrown message needs the same classification as command output.
    const message = e?.message || String(e);
    throw new GlabError(classify(message), message, message);
  }
  return {
    stdout: res?.stdout ?? "",
    stderr: res?.stderr ?? "",
    code: res?.exitCode ?? res?.code ?? 0,
  };
}

/**
 * Whether glab holds a working token for `host`. Used to tell "this project
 * doesn't exist" apart from "you aren't signed in" — GitLab answers 404, not
 * 401, for a private project when the request is unauthenticated, so a bare
 * 404 on a self-managed instance is usually a missing login.
 */
export async function isAuthenticated(host, cwd = "") {
  try {
    const user = await api("user", { host, cwd });
    return Boolean(user?.id);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- git remote

/**
 * Parses a git remote URL into `{ host, path }`, where `path` is the
 * namespace/project part with any `.git` suffix removed. Handles the three
 * forms git remotes come in: scp-like SSH, ssh:// URLs, and https:// URLs.
 */
export function parseRemote(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;

  let host = "";
  let path = "";

  const scp = raw.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
  if (scp && !raw.includes("://")) {
    host = scp[1];
    path = scp[2];
  } else {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    host = parsed.hostname;
    path = parsed.pathname;
  }

  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!host || !path || !path.includes("/")) return null;
  return { host: host.toLowerCase(), path };
}

/** The remote to read the project identity from: origin if present, else the first. */
export async function resolveProject(cwd) {
  const list = await exec(["git", "remote"], cwd);
  if (list.code !== 0) {
    throw new GlabError("no-repo", "This project is not a git repository.", list.stderr);
  }
  const remotes = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!remotes.length) {
    throw new GlabError("no-repo", "This repository has no git remote.", "");
  }
  const ordered = [
    ...remotes.filter((r) => r === "origin"),
    ...remotes.filter((r) => r !== "origin"),
  ];

  for (const remote of ordered) {
    const { stdout, code } = await exec(["git", "remote", "get-url", remote], cwd);
    if (code !== 0) continue;
    const parsed = parseRemote(stdout);
    if (parsed) return { ...parsed, remote };
  }
  throw new GlabError("no-repo", "Could not read a URL from any git remote.", "");
}

// ------------------------------------------------------------- REST reads

/** `group/sub/project` → `group%2Fsub%2Fproject`, the id form GitLab expects. */
export function encodeProjectPath(path) {
  return encodeURIComponent(path);
}

export function query(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * GET a REST endpoint on `host` and return the parsed JSON body.
 * `endpoint` is a path below /api/v4, e.g. `projects/foo%2Fbar/issues?state=opened`.
 */
export async function api(endpoint, { host, cwd = "" } = {}) {
  const argv = ["glab", "api"];
  if (host) argv.push("--hostname", host);
  argv.push(endpoint);

  const { stdout, stderr, code } = await exec(argv, cwd);
  if (code !== 0) {
    const output = stderr || stdout;
    throw new GlabError(classify(output), (output || "glab api failed").trim(), output);
  }
  try {
    return JSON.parse(stdout || "null");
  } catch {
    throw new GlabError("failed", "Could not parse the GitLab API response.", stdout);
  }
}

/** Same as `api`, but resolves to `null` instead of throwing. For optional data. */
export async function apiOptional(endpoint, options) {
  try {
    return await api(endpoint, options);
  } catch (e) {
    console.warn("[gitlab] optional request failed:", endpoint, e.message);
    return null;
  }
}

// ------------------------------------------------------------ glab writes

/**
 * Runs a glab subcommand against a specific project. `-R <web_url>` pins both
 * the instance and the project, so this works unchanged on a self-managed host.
 */
export async function write(args, { repo, cwd = "" }) {
  const argv = ["glab", ...args];
  if (repo) argv.push("-R", repo);
  const { stdout, stderr, code } = await exec(argv, cwd);
  if (code !== 0) {
    const output = stderr || stdout;
    throw new GlabError(classify(output), (output || "Command failed").trim(), output);
  }
  return stdout;
}

/** Opens a URL in the user's default browser. */
export async function openUrl(url) {
  if (!url) return;
  try {
    await exec(["open", url]);
  } catch (e) {
    console.error("[gitlab] failed to open:", e);
  }
}
