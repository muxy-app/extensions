// The generic provider: any build server that publishes a CCTray feed.
//
// CCTray (cctray.xml) is the one status format essentially every CI server
// speaks — TeamCity, Jenkins, GoCD, Bamboo, CruiseControl. That makes it the
// right fallback when a repository has no GitHub Actions or GitLab CI to read.
//
// Requests go out through `curl` rather than `muxy.http.fetch`, deliberately:
// muxy.http blocks private and loopback hosts, and most build servers people
// need to watch live on an internal network.

import { exec, CIError } from "../exec.js";
import { normalizeStatus, STATUS } from "../model.js";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function decodeEntities(value) {
  return String(value)
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

const PROJECT_RE = /<Project\b([^>]*?)\/?>/gi;
const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Parses a CCTray document into raw project records. Attribute-only format, so
 * a focused parser beats DOMParser here: it runs identically under `node --test`.
 */
export function parseCCTray(xml) {
  const text = String(xml || "");
  if (!/<Projects?\b/i.test(text)) return [];

  const projects = [];
  for (const match of text.matchAll(PROJECT_RE)) {
    const attrs = {};
    for (const attr of match[1].matchAll(ATTR_RE)) {
      attrs[attr[1].toLowerCase()] = decodeEntities(attr[3] ?? attr[4] ?? "");
    }
    if (attrs.name) projects.push(attrs);
  }
  return projects;
}

// CCTray splits "is it building right now" (activity) from "how did it last go"
// (lastBuildStatus), so a running build has to win over the previous outcome.
function statusOf(project) {
  const activity = String(project.activity || "").toLowerCase();
  if (activity === "building") return STATUS.running;
  if (activity === "checkingmodifications") return STATUS.queued;
  const last = String(project.lastbuildstatus || "").toLowerCase();
  if (last === "exception") return STATUS.failed;
  return normalizeStatus(last);
}

/**
 * Splits a CCTray project name into its parts. TeamCity publishes
 * `Project :: Build Config`, and branch-aware setups append `:: branch`;
 * Jenkins multibranch uses `job / branch`.
 */
export function splitName(name) {
  const raw = String(name || "").trim();
  const parts = raw.split("::").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { workflow: parts.slice(0, -1).join(" :: "), title: parts.at(-2), branch: parts.at(-1) };
  }
  if (parts.length === 2) return { workflow: parts[0], title: parts[1], branch: "" };

  const paren = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) return { workflow: "", title: paren[1], branch: paren[2] };
  return { workflow: "", title: raw, branch: "" };
}

/** Maps one CCTray project record onto the normalized run shape. */
export function toRun(project, source) {
  const { workflow, title, branch } = splitName(project.name);
  const label = project.lastbuildlabel || "";
  return {
    id: `${source.id}:${project.name}:${label}`,
    source: source.id,
    sourceKind: "cctray",
    sourceLabel: source.label || "CCTray",
    number: label,
    title,
    workflow: workflow || source.label || "CCTray",
    status: statusOf(project),
    branch,
    sha: "",
    event: "",
    // lastBuildTime is when a build last *finished*. For a build that is
    // running now that is the previous build's end, so it orders the row but
    // must never be read as this build's start.
    createdAt: project.lastbuildtime || "",
    startedAt: "",
    finishedAt: statusOf(project) === STATUS.running ? "" : project.lastbuildtime || "",
    durationMs: null,
    durationKnown: false,
    webUrl: project.weburl || "",
    message: project.messages || "",
    jobs: null, // CCTray reports no job breakdown
  };
}

/** Builds the curl argv for a source, including its auth mode. */
export function curlArgs(source, url) {
  const args = [
    "curl", "-sS",
    "--max-time", "25",
    "--location",
    "-H", "Accept: application/xml, text/xml, */*",
    // Response headers to stderr, body to stdout, so the HTTP status is
    // available without giving up the body on an error response.
    "-D", "/dev/stderr",
  ];
  const auth = source.auth || { kind: "none" };
  switch (auth.kind) {
    case "token":
      args.push("-H", `Authorization: Bearer ${auth.token}`);
      break;
    case "header":
      if (auth.name) args.push("-H", `${auth.name}: ${auth.value}`);
      break;
    case "basic":
      args.push("-u", `${auth.user}:${auth.password}`);
      break;
    case "curlConfig":
      // Secrets stay in a file the user owns; curl reads headers/auth from it.
      if (auth.path) args.push("--config", auth.path);
      break;
    default:
      break;
  }
  if (source.insecure) args.push("--insecure");
  args.push(url || source.url);
  return args;
}

const STATUS_LINE_RE = /^HTTP\/[\d.]+\s+(\d{3})/m;

/** Fetches and parses a CCTray feed. Throws a classified CIError on failure. */
export async function fetchProjects(source, cwd = "", url = "") {
  const target = url || source.url;
  if (!target) throw new CIError("failed", "This monitor has no URL.");

  const { stdout, stderr, code } = await exec(curlArgs(source, target), cwd);
  if (code !== 0) {
    throw new CIError(code === 127 ? "missing" : "failed", curlMessage(stderr, code), stderr);
  }

  const httpStatus = Number(stderr.match(STATUS_LINE_RE)?.[1] || 0);
  if (httpStatus === 401 || httpStatus === 403) {
    throw new CIError("auth", `The server refused the request (HTTP ${httpStatus}). Check the monitor's credentials.`, stderr);
  }
  if (httpStatus >= 400) {
    throw new CIError("failed", `The server returned HTTP ${httpStatus}.`, stdout.slice(0, 400));
  }

  const projects = parseCCTray(stdout);
  if (!projects.length) {
    throw new CIError("failed", "That URL did not return a CCTray project list.", stdout.slice(0, 400));
  }
  return projects;
}

// curl's exit codes are the only signal when the transport itself fails.
const CURL_HINTS = {
  6: "Could not resolve the host.",
  7: "Could not connect to the server.",
  28: "The request timed out.",
  35: "TLS handshake failed.",
  60: "The server's TLS certificate could not be verified — enable “Allow self-signed certificates” if that is expected.",
};

function curlMessage(stderr, code) {
  const hint = CURL_HINTS[code];
  const detail = String(stderr || "").split("\n").filter((l) => !/^HTTP\/|^[\w-]+:\s/.test(l)).join(" ").trim();
  return hint || detail || `curl exited with code ${code}.`;
}

/** Applies the monitor's project allowlist. Empty means "everything". */
export function selectProjects(projects, allow) {
  if (!allow || !allow.length) return projects;
  const wanted = new Set(allow);
  return projects.filter((p) => wanted.has(p.name));
}

export const capabilities = {
  jobs: false,
  logs: false,
  retry: false,
  cancel: false,
  environments: false,
};

/** Provider entry point: configured monitor → normalized runs. */
export async function loadRuns(source, cwd = "") {
  const projects = selectProjects(await fetchProjects(source, cwd), source.projects);
  return projects.map((p) => toRun(p, source));
}
