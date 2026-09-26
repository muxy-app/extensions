// Working out what CI a repository uses by looking at what is checked in.
//
// Two outcomes matter. A *native* hit (GitHub Actions, GitLab CI) can be read
// directly through the matching CLI, so it becomes a source with no setup. A
// *hint* (Jenkins, TeamCity, CircleCI, …) has no local CLI to read, so it turns
// into a prefilled suggestion for a CCTray monitor instead of a dead end.
//
// Detection is only ever a *suggestion*. GitLab in particular lets a project
// point at any path, another project, or an external URL for its CI config, so
// no file list can be complete — which is why the Sources view can always add a
// native provider by hand. What a provider reads then comes from the API, not
// from the file found here.

/** Native providers: detected from files and readable without configuration. */
const NATIVE = [
  {
    kind: "github",
    label: "GitHub Actions",
    cli: "gh",
    // GitHub only ever runs workflows from this directory.
    scanDirs: [".github/workflows"],
    fileRe: /\.ya?ml$/i,
  },
  {
    kind: "gitlab",
    label: "GitLab CI",
    cli: "glab",
    // Root is GitLab's default; `.gitlab/` and `.gitlab/ci/` are the common
    // conventions once a project moves the config off the root.
    files: [
      ".gitlab-ci.yml", ".gitlab-ci.yaml",
      ".gitlab/.gitlab-ci.yml", ".gitlab/.gitlab-ci.yaml",
    ],
    scanDirs: [".gitlab/ci", ".gitlab-ci"],
    fileRe: /\.ya?ml$/i,
  },
];

/**
 * Systems we can recognize but not query without an endpoint. `cctrayPath` is
 * the conventional CCTray path on that server, offered as a starting point.
 */
const HINTS = [
  { id: "jenkins", label: "Jenkins", files: ["Jenkinsfile", "jenkinsfile"], cctrayPath: "/cc.xml" },
  { id: "teamcity", label: "TeamCity", dirs: [".teamcity"], cctrayPath: "/app/rest/cctray/projects.xml" },
  { id: "circleci", label: "CircleCI", dirs: [".circleci"], cctrayPath: "" },
  { id: "azure", label: "Azure Pipelines", files: ["azure-pipelines.yml", "azure-pipelines.yaml"], cctrayPath: "" },
  { id: "gocd", label: "GoCD", files: [".gocd.yaml", ".gocd.yml"], cctrayPath: "/go/cctray.xml" },
  { id: "drone", label: "Drone", files: [".drone.yml"], cctrayPath: "" },
  { id: "buildkite", label: "Buildkite", dirs: [".buildkite"], cctrayPath: "" },
];

async function statExists(path, project) {
  try {
    const entry = await window.muxy?.files?.stat?.(path, project ? { project } : undefined);
    return Boolean(entry);
  } catch {
    return false;
  }
}

async function listDir(path, project) {
  try {
    const entries = await window.muxy?.files?.list?.(path, project ? { project } : undefined);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Scans the repository for CI configuration.
 * Returns `{ native: [{ kind, label, cli, evidence }], hints: [{ id, label, cctrayPath, evidence }] }`.
 */
export async function detect(cwd = "") {
  const native = [];
  for (const candidate of NATIVE) {
    const evidence = await evidenceFor(candidate, cwd);
    if (evidence) native.push({ kind: candidate.kind, label: candidate.label, cli: candidate.cli, evidence });
  }

  const hints = [];
  for (const hint of HINTS) {
    const evidence = await evidenceFor(hint, cwd);
    if (evidence) hints.push({ id: hint.id, label: hint.label, cctrayPath: hint.cctrayPath, evidence });
  }

  return { native, hints };
}

async function evidenceFor(candidate, cwd) {
  for (const file of candidate.files || []) {
    if (await statExists(file, cwd)) return file;
  }
  for (const dir of candidate.dirs || []) {
    if (await statExists(dir, cwd)) return `${dir}/`;
  }
  for (const dir of candidate.scanDirs || []) {
    const entries = await listDir(dir, cwd);
    const match = entries.find((e) => !e.isDirectory && (!candidate.fileRe || candidate.fileRe.test(e.name)));
    if (match) return `${dir}/${match.name}`;
  }
  return null;
}

/**
 * Turns detection results into the source list a fresh repository should start
 * with: every native provider whose CLI is installed, enabled by default.
 * `hasCli` is injected so this stays testable without a shell.
 */
export async function suggestedSources(detection, hasCli) {
  const sources = [];
  for (const provider of detection.native || []) {
    if (!(await hasCli(provider.cli))) continue;
    sources.push({
      id: `auto-${provider.kind}`,
      kind: provider.kind,
      label: provider.label,
      enabled: true,
    });
  }
  return sources;
}

/** A CCTray URL guess for a hint, given the server's base URL. */
export function cctrayUrlFor(hint, baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base || !hint?.cctrayPath) return base;
  return `${base}${hint.cctrayPath}`;
}

/** Every native provider, for the "add it anyway" path when detection misses. */
export const nativeProviders = () =>
  NATIVE.map(({ kind, label, cli }) => ({ kind, label, cli }));
