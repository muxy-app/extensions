const BOARD_COLUMNS = [
  { id: "open", title: "Open", statuses: ["open"] },
  { id: "in_progress", title: "In Progress", statuses: ["in_progress"] },
  { id: "blocked", title: "Blocked", statuses: ["blocked"] },
  { id: "deferred", title: "Deferred", statuses: ["deferred"] },
  { id: "closed", title: "Closed", statuses: ["closed"] },
];

const BUILT_IN_COLUMN_IDS = new Set(BOARD_COLUMNS.map((column) => column.id));

const STATUS_LABELS = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  deferred: "Deferred",
  closed: "Closed",
  pinned: "Pinned",
  hooked: "Hooked",
};

export { BOARD_COLUMNS };

export async function loadBoardData() {
  const projectName = await loadProjectName();
  const workspacePath = await getActiveWorkspacePath().catch(() => null);
  const cli = await loadIssuesFromCli();

  if (cli.ok) {
    return {
      issues: normalizeIssues(cli.issues, cli.readyIDs),
      source: cli.source,
      projectName,
      workspacePath,
      error: null,
    };
  }

  const exported = await loadIssuesFromExport();
  return {
    issues: normalizeIssues(exported.issues, new Set()),
    source: exported.ok ? exported.source : "none",
    projectName,
    workspacePath,
    error: exported.ok ? cli.error : exported.error || cli.error,
  };
}

export function groupIssuesByColumn(issues) {
  const buckets = getBoardColumns(issues).map((column) => ({ ...column, issues: [] }));

  for (const issue of issues) {
    const columnID = getColumnID(issue);
    const bucket = buckets.find((column) => column.id === columnID) ?? buckets[0];
    bucket.issues.push(issue);
  }

  return buckets;
}

export function applyColumnOrder(columns, order) {
  if (!Array.isArray(order) || order.length === 0) return columns;

  const byID = new Map(columns.map((column) => [column.id, column]));
  const ordered = order.map((id) => byID.get(id)).filter(Boolean);
  const orderedIDs = new Set(ordered.map((column) => column.id));
  const remaining = columns.filter((column) => !orderedIDs.has(column.id));
  return [...ordered, ...remaining];
}

export function getBoardColumns(issues) {
  const extraStatuses = [...new Set(issues.map((issue) => issue.status))]
    .filter((status) => status && !BUILT_IN_COLUMN_IDS.has(status))
    .sort();
  const extraColumns = extraStatuses.map((status) => ({
    id: status,
    title: getStatusLabel(status),
    statuses: [status],
  }));

  const closed = BOARD_COLUMNS.find((column) => column.id === "closed");
  return [
    ...BOARD_COLUMNS.filter((column) => column.id !== "closed"),
    ...extraColumns,
    closed,
  ];
}

export function getStatusLabel(status) {
  return STATUS_LABELS[status] ?? titleize(status || "open");
}

export function getPriorityLabel(priority) {
  if (Number.isInteger(priority)) return `P${priority}`;
  return "P?";
}

export function getIssueAge(issue) {
  const value = issue.updated_at || issue.created_at;
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo" : `${months}mo`;
}

async function loadIssuesFromCli() {
  const all = await runBdJSON(["bd", "list", "--json", "--all", "--limit", "0"]);
  if (!all.ok) return all;

  const ready = await runBdJSON(["bd", "ready", "--json"]);
  const readyIDs = new Set((ready.ok ? unwrapIssues(ready.value) : []).map((issue) => issue.id));

  return {
    ok: true,
    issues: unwrapIssues(all.value),
    readyIDs,
    source: "bd list --json",
  };
}

async function runBdJSON(argv) {
  try {
    const result = await muxy.exec(argv, { timeoutMs: 10000 });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        issues: [],
        error: cleanError(result.stderr || result.stdout || `${argv.join(" ")} failed`),
      };
    }

    return { ok: true, value: JSON.parse(result.stdout || "[]") };
  } catch (error) {
    return { ok: false, issues: [], error: error?.message ?? String(error) };
  }
}

async function loadIssuesFromExport() {
  const candidates = ["issues.jsonl", ".beads/issues.jsonl"];

  for (const path of candidates) {
    let res;
    try {
      res = await muxy.files.read(path);
    } catch {
      continue;
    }

    if (!res?.content) continue;

    try {
      return { ok: true, issues: parseJSONLines(res.content, path), source: path };
    } catch (error) {
      return {
        ok: false,
        issues: [],
        error: error?.message ?? String(error),
      };
    }
  }

  return {
    ok: false,
    issues: [],
    error: "No Beads database or exported issues.jsonl found in this workspace.",
  };
}

function unwrapIssues(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.issues)) return value.issues;
  return [];
}

function parseJSONLines(content, path) {
  const issues = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      issues.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`Failed to parse ${path} line ${index + 1}: ${error?.message ?? String(error)}`);
    }
  });

  return issues;
}

function normalizeIssues(rawIssues, readyIDs) {
  return rawIssues
    .map((raw) => {
      const status = normalizeStatus(raw.status);
      return {
        ...raw,
        id: raw.id || "unknown",
        title: raw.title || "(untitled)",
        status,
        ready: readyIDs.has(raw.id),
        issue_type: raw.issue_type || raw.type || "task",
        priority: normalizePriority(raw.priority),
        labels: Array.isArray(raw.labels) ? raw.labels : [],
        dependency_count: raw.dependency_count ?? raw.dependencyCount ?? 0,
        dependent_count: raw.dependent_count ?? raw.dependentCount ?? 0,
        comment_count: raw.comment_count ?? raw.commentCount ?? 0,
      };
    })
    .sort(compareIssues);
}

function normalizeStatus(status) {
  return String(status || "open").replaceAll("-", "_").toLowerCase();
}

function normalizePriority(priority) {
  const value = Number(priority);
  return Number.isInteger(value) ? value : null;
}

function compareIssues(a, b) {
  const priorityA = a.priority ?? 99;
  const priorityB = b.priority ?? 99;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return (new Date(b.updated_at || b.created_at || 0)) - (new Date(a.updated_at || a.created_at || 0));
}

function getColumnID(issue) {
  return issue.status || "open";
}

function titleize(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanError(message) {
  return String(message).trim().replace(/\s+/g, " ");
}

async function loadProjectName() {
  try {
    const res = await muxy.files.read("package.json");
    if (res?.content) {
      const pkg = JSON.parse(res.content);
      if (pkg.displayName || pkg.name) return pkg.displayName || pkg.name;
    }
  } catch {
  }

  try {
    const res = await muxy.files.read("go.mod");
    const match = res?.content?.match(/^module\s+(.+)$/m);
    if (match) return match[1].trim();
  } catch {
  }

  try {
    const projects = await muxy.projects.list();
    const active = projects.find((project) => project.isActive);
    if (active?.name) return active.name;
    if (active?.path) return active.path.split("/").filter(Boolean).pop();
  } catch {
  }

  return "Workspace";
}

async function getActiveWorkspacePath() {
  const projects = await muxy.projects.list();
  const active = projects.find((project) => project.isActive);
  if (!active) return null;

  const worktrees = await muxy.worktrees.list(active.id).catch(() => []);
  const activeWorktree = worktrees.find((worktree) => worktree.isActive);
  return activeWorktree?.path || active.path || null;
}
