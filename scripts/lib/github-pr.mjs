import fs from "node:fs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_CHANGED_FILE_PAGES = 30;
const MAX_MANIFEST_BYTES = 128 * 1024;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const EXTENSION_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GITHUB_HANDLE_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function assertString(value, label, maxLength = 500) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function repositoryParts(fullName) {
  assertString(fullName, "repository", 200);
  if (!REPOSITORY_RE.test(fullName)) {
    throw new Error(`invalid repository name: ${JSON.stringify(fullName)}`);
  }
  const parts = fullName.split("/");
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`invalid repository name: ${JSON.stringify(fullName)}`);
  }
  return parts;
}

function repositoryAPIPath(fullName) {
  return repositoryParts(fullName).map(encodeURIComponent).join("/");
}

function assertSha(sha, label) {
  assertString(sha, label, 64);
  if (!SHA_RE.test(sha)) {
    throw new Error(`${label} is not a full Git commit SHA`);
  }
  return sha;
}

function errorMessage(payload, fallback) {
  if (payload && typeof payload.message === "string") return payload.message;
  return fallback;
}

export class GitHubAPI {
  constructor(token, fetchImpl = globalThis.fetch) {
    this.token = assertString(token, "GITHUB_TOKEN", 1000);
    if (typeof fetchImpl !== "function") {
      throw new Error("a fetch implementation is required");
    }
    this.fetchImpl = fetchImpl;
  }

  async request(apiPath, { method = "GET", body, allow404 = false } = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "muxy-extensions-ci",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await this.fetchImpl(`${API_ROOT}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(
          `GitHub API ${method} ${apiPath.split("?")[0]} returned invalid JSON`,
        );
      }
    }

    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const message = errorMessage(payload, `HTTP ${response.status}`);
      throw new Error(
        `GitHub API ${method} ${apiPath.split("?")[0]} failed: ${message}`,
      );
    }
    return payload;
  }

  get(apiPath, options) {
    return this.request(apiPath, options);
  }

  post(apiPath, body) {
    return this.request(apiPath, { method: "POST", body });
  }

  patch(apiPath, body) {
    return this.request(apiPath, { method: "PATCH", body });
  }

  delete(apiPath) {
    return this.request(apiPath, { method: "DELETE" });
  }
}

export function parsePullRequestContext(event, repositoryFallback = "") {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("GitHub event payload must be an object");
  }
  const pr = event.pull_request;
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
    throw new Error("GitHub event is not a pull request event");
  }

  const number = Number(event.number ?? pr.number);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("pull request number is invalid");
  }

  const baseRepository = pr.base?.repo?.full_name ?? repositoryFallback;
  repositoryParts(baseRepository);

  const headRepository = pr.head?.repo?.full_name ?? null;
  if (headRepository !== null) repositoryParts(headRepository);

  const opener = assertString(pr.user?.login, "pull request opener", 39);
  if (!GITHUB_HANDLE_RE.test(opener)) {
    throw new Error("pull request opener is not a valid GitHub handle");
  }

  return {
    number,
    baseRepository,
    baseSha: assertSha(pr.base?.sha, "base SHA"),
    headRepository,
    headSha: assertSha(pr.head?.sha, "head SHA"),
    opener,
    currentTitle:
      typeof pr.title === "string" && pr.title.length <= 256 ? pr.title : "",
  };
}

export function pullRequestContextFromEnvironment(env = process.env) {
  const eventPath = assertString(env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH", 4096);
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  return parsePullRequestContext(event, env.GITHUB_REPOSITORY);
}

export async function listPullRequestFiles(api, context) {
  const repository = repositoryAPIPath(context.baseRepository);
  const files = [];
  for (let page = 1; page <= MAX_CHANGED_FILE_PAGES; page += 1) {
    const batch = await api.get(
      `/repos/${repository}/pulls/${context.number}/files?per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch)) {
      throw new Error("GitHub returned an invalid pull request file list");
    }
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  throw new Error(
    `pull request file list exceeds ${MAX_CHANGED_FILE_PAGES * 100} files`,
  );
}

function extensionNameFromPath(filePath) {
  if (typeof filePath !== "string" || !filePath.startsWith("extensions/")) {
    return null;
  }
  const segments = filePath.split("/", 3);
  if (segments.length < 3 || segments[2] === "") return null;
  const name = segments[1];
  if (!EXTENSION_NAME_RE.test(name)) {
    throw new Error(
      `invalid extension directory in changed path: ${JSON.stringify(filePath)}`,
    );
  }
  return name;
}

export function changedExtensionNames(files) {
  if (!Array.isArray(files)) {
    throw new Error("pull request files must be an array");
  }
  const names = new Set();
  for (const file of files) {
    const paths = [file?.filename, file?.previous_filename];
    for (const filePath of paths) {
      const name = extensionNameFromPath(filePath);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

function encodeRepositoryFilePath(filePath) {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

export async function getRepositoryTextFile(
  api,
  repository,
  ref,
  filePath,
  { allow404 = false, maxBytes = MAX_MANIFEST_BYTES } = {},
) {
  repositoryParts(repository);
  assertSha(ref, "file ref");
  assertString(filePath, "repository file path", 1000);
  const pathSegments = filePath.split("/");
  if (
    filePath.startsWith("/") ||
    pathSegments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`unsafe repository file path: ${JSON.stringify(filePath)}`);
  }

  const result = await api.get(
    `/repos/${repositoryAPIPath(repository)}/contents/${encodeRepositoryFilePath(filePath)}?ref=${encodeURIComponent(ref)}`,
    { allow404 },
  );
  if (result === null) return null;
  if (
    !result ||
    result.type !== "file" ||
    result.encoding !== "base64" ||
    typeof result.content !== "string"
  ) {
    throw new Error(`GitHub returned invalid content for ${filePath}`);
  }
  if (!Number.isSafeInteger(result.size) || result.size < 0 || result.size > maxBytes) {
    throw new Error(`${filePath} exceeds the ${maxBytes}-byte safety limit`);
  }
  const content = Buffer.from(result.content, "base64");
  if (content.byteLength > maxBytes) {
    throw new Error(`${filePath} exceeds the ${maxBytes}-byte safety limit`);
  }
  return content.toString("utf8");
}

export async function getRepositoryTree(api, repository, ref) {
  repositoryParts(repository);
  assertSha(ref, "tree ref");
  const result = await api.get(
    `/repos/${repositoryAPIPath(repository)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  if (!result || !Array.isArray(result.tree)) {
    throw new Error("GitHub returned an invalid repository tree");
  }
  if (result.truncated) {
    throw new Error("GitHub truncated the repository tree; refusing an incomplete scan");
  }
  return result.tree;
}

export async function getRepositoryBlobText(
  api,
  repository,
  sha,
  { maxBytes } = {},
) {
  repositoryParts(repository);
  assertSha(sha, "blob SHA");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  const result = await api.get(
    `/repos/${repositoryAPIPath(repository)}/git/blobs/${encodeURIComponent(sha)}`,
  );
  if (
    !result ||
    result.encoding !== "base64" ||
    typeof result.content !== "string" ||
    !Number.isSafeInteger(result.size) ||
    result.size < 0 ||
    result.size > maxBytes
  ) {
    throw new Error(`repository blob exceeds the ${maxBytes}-byte safety limit`);
  }
  const content = Buffer.from(result.content, "base64");
  if (content.byteLength > maxBytes) {
    throw new Error(`repository blob exceeds the ${maxBytes}-byte safety limit`);
  }
  return content.toString("utf8");
}

export function parseExtensionManifest(text, expectedName, label = "package.json") {
  assertString(text, label, MAX_MANIFEST_BYTES);
  if (!EXTENSION_NAME_RE.test(expectedName)) {
    throw new Error(`invalid expected extension name: ${JSON.stringify(expectedName)}`);
  }

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  if (pkg.name !== expectedName) {
    throw new Error(
      `${label} name ${JSON.stringify(pkg.name)} must equal ${JSON.stringify(expectedName)}`,
    );
  }
  if (
    typeof pkg.version !== "string" ||
    pkg.version.length > 100 ||
    !SEMVER_RE.test(pkg.version)
  ) {
    throw new Error(
      `${label} version must be valid semver (MAJOR.MINOR.PATCH with optional prerelease/build metadata)`,
    );
  }

  let authorGitHub = null;
  let authorWarning = null;
  const rawAuthor = pkg.muxy?.marketplace?.github;
  if (rawAuthor !== undefined && rawAuthor !== null && rawAuthor !== "") {
    if (typeof rawAuthor !== "string") {
      authorWarning = `${label} marketplace GitHub handle is not a string; ignoring it`;
    } else {
      const handle = rawAuthor.startsWith("@") ? rawAuthor.slice(1) : rawAuthor;
      if (GITHUB_HANDLE_RE.test(handle)) authorGitHub = handle;
      else authorWarning = `${label} marketplace GitHub handle is invalid; ignoring it`;
    }
  }

  return {
    packageJSON: pkg,
    name: pkg.name,
    version: pkg.version,
    authorGitHub,
    authorWarning,
  };
}

function versionCore(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`invalid semver: ${JSON.stringify(version)}`);
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

export function compareVersionCores(left, right) {
  const a = versionCore(left);
  const b = versionCore(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

export function repositoryAPIName(fullName) {
  return repositoryAPIPath(fullName);
}
