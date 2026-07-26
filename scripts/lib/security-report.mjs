export const COMMENT_MARKER = "<!-- muxy-extension-security-report -->";

const PERMISSIONS = {
  "files:read": { risk: "high", what: "Read files anywhere in the project" },
  "files:write": {
    risk: "high",
    what: "Create, modify, or delete files in the project",
  },
  "git:read": { risk: "medium", what: "Read git state (status, history, diffs)" },
  "git:write": {
    risk: "high",
    what: "Run git operations that change the repo (commit, checkout, etc.)",
  },
  "worktrees:read": { risk: "low", what: "Read the list of worktrees" },
  "worktrees:write": {
    risk: "medium",
    what: "Create, switch, or remove worktrees",
  },
  "projects:read": { risk: "low", what: "Read open projects" },
  "projects:write": {
    risk: "medium",
    what: "Open, close, or switch projects",
  },
  "panes:read": { risk: "low", what: "Read terminal/editor pane state" },
  "panes:write": { risk: "medium", what: "Create or manipulate panes" },
  "tabs:read": { risk: "low", what: "Read open tabs" },
  "tabs:write": { risk: "low", what: "Open or close tabs" },
  "panels:write": { risk: "low", what: "Show or hide the extension's own panels" },
  "notifications:write": {
    risk: "low",
    what: "Post desktop/in-app notifications",
  },
  "commands:run-script": {
    risk: "medium",
    what: "Run a bundled script shipped with the extension",
  },
  "commands:exec": {
    risk: "high",
    what: "Execute arbitrary shell commands on the host",
  },
  "remote:serve": {
    risk: "high",
    what: "Open a network-facing server the host can reach",
  },
};

const RISK_BADGE = { high: "🔴 High", medium: "🟠 Medium", low: "🟢 Low" };
const RISK_ORDER = { high: 0, medium: 1, low: 2 };
const EXEC_PATTERN = /\bmuxy\.exec\b/;
const NETWORK_PATTERN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/;
const EVAL_PATTERN = /\b(eval|Function)\s*\(/;
const MIN_MINIFIED_LINE = 2000;
const SOURCE_EXTENSION_RE = /\.(js|mjs|ts|jsx|tsx|vue|svelte|html)$/i;
const SKIP_SCAN_DIRS = new Set(["node_modules", "dist"]);
const MAX_DESCRIPTION_LENGTH = 500;

function markdownText(value, maxLength = MAX_DESCRIPTION_LENGTH) {
  const plain = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return plain
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "@\u200b")
    .replace(/([\\`*_[\]{}()#+.!|~-])/g, "\\$1");
}

function permissionId(value) {
  return markdownText(value, 100);
}

export function isScannableSourcePath(relativePath) {
  if (typeof relativePath !== "string" || !SOURCE_EXTENSION_RE.test(relativePath)) {
    return false;
  }
  const segments = relativePath.split("/");
  return !segments.some(
    (segment) => segment.startsWith(".") || SKIP_SCAN_DIRS.has(segment),
  );
}

function scanSource(files, permissions, skippedSourceFiles) {
  const signals = [];
  let networkFiles = 0;
  let evalFiles = 0;
  let minifiedFiles = 0;
  let execFiles = 0;

  for (const file of files) {
    const content = typeof file?.content === "string" ? file.content : "";
    if (NETWORK_PATTERN.test(content)) networkFiles += 1;
    if (EVAL_PATTERN.test(content)) evalFiles += 1;
    if (EXEC_PATTERN.test(content)) execFiles += 1;
    const longest = content
      .split("\n")
      .reduce((max, line) => Math.max(max, line.length), 0);
    if (longest > MIN_MINIFIED_LINE) minifiedFiles += 1;
  }

  if (networkFiles > 0) {
    signals.push(
      `🌐 Makes network requests in ${networkFiles} file(s) — verify the endpoints and what data is sent.`,
    );
  }
  if (evalFiles > 0) {
    signals.push(
      `⚠️ Uses \`eval\`/\`Function\` in ${evalFiles} file(s) — inspect for obfuscation.`,
    );
  }
  if (minifiedFiles > 0) {
    signals.push(
      `📦 ${minifiedFiles} file(s) look minified/obfuscated — extensions should ship readable source.`,
    );
  }
  if (execFiles > 0 && !permissions.has("commands:exec")) {
    signals.push(
      `⚠️ Calls \`muxy.exec\` in ${execFiles} file(s) without declaring \`commands:exec\`.`,
    );
  }
  if (permissions.has("commands:exec")) {
    signals.push(
      "🖥️ Can run shell commands (`commands:exec`) — confirm the usage is justified.",
    );
  }
  if (skippedSourceFiles > 0) {
    signals.push(
      `⚠️ Skipped ${skippedSourceFiles} oversized or unsupported source file(s); review them manually.`,
    );
  }
  return signals;
}

export function analyseExtensionData({
  name,
  packageJSON,
  files = [],
  skippedSourceFiles = 0,
}) {
  if (!packageJSON || typeof packageJSON !== "object" || Array.isArray(packageJSON)) {
    throw new Error(`package.json for ${name} must contain an object`);
  }
  const muxy =
    packageJSON.muxy &&
    typeof packageJSON.muxy === "object" &&
    !Array.isArray(packageJSON.muxy)
      ? packageJSON.muxy
      : {};
  const declared = Array.isArray(muxy.permissions)
    ? muxy.permissions
        .slice(0, 100)
        .filter(
          (permission) =>
            typeof permission === "string" && permission.length <= 100,
        )
    : [];
  const declaredUnique = [...new Set(declared)];
  const permissionSet = new Set(declaredUnique);

  const permissions = declaredUnique
    .map((id) => ({
      id,
      ...(PERMISSIONS[id] ?? { risk: "low", what: "Unknown permission" }),
    }))
    .sort(
      (a, b) =>
        RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.id.localeCompare(b.id),
    );

  const highest = permissions.reduce(
    (risk, permission) =>
      RISK_ORDER[permission.risk] < RISK_ORDER[risk] ? permission.risk : risk,
    "low",
  );

  return {
    name,
    version:
      typeof packageJSON.version === "string" ? packageJSON.version : "",
    description: typeof muxy.description === "string" ? muxy.description : "",
    permissions,
    highestRisk: permissions.length ? highest : "low",
    signals: scanSource(files, permissionSet, skippedSourceFiles),
  };
}

function renderExtension(extension) {
  const lines = [];
  const title = extension.version
    ? `${extension.name} v${extension.version}`
    : extension.name;
  lines.push(`### \`${title}\` — overall ${RISK_BADGE[extension.highestRisk]}`);
  if (extension.description) {
    lines.push(`_${markdownText(extension.description)}_`);
  }
  lines.push("");

  if (extension.permissions.length === 0) {
    lines.push("**Permissions:** none declared.");
  } else {
    lines.push("**Permissions**");
    lines.push("");
    lines.push("| Permission | Risk | What it allows |");
    lines.push("| --- | --- | --- |");
    for (const permission of extension.permissions) {
      lines.push(
        `| \`${permissionId(permission.id)}\` | ${RISK_BADGE[permission.risk]} | ${permission.what} |`,
      );
    }
  }
  lines.push("");

  lines.push("**Security signals**");
  lines.push("");
  if (extension.signals.length === 0) {
    lines.push(
      "- ✅ No automated flags. Permissions still warrant a manual review.",
    );
  } else {
    for (const signal of extension.signals) lines.push(`- ${signal}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderSecurityComment(extensions) {
  const lines = [COMMENT_MARKER, "## 🔐 Extension security review", ""];

  if (extensions.length === 0) {
    lines.push("No extensions changed in this PR.");
    return lines.join("\n");
  }

  lines.push(
    `Analysed ${extensions.length} extension(s). Risk is heuristic — a maintainer must still review the code and permissions before merge.`,
    "",
  );
  for (const extension of extensions) {
    lines.push(renderExtension(extension));
  }
  lines.push(
    "---",
    "<sub>Generated by `scripts/security-comment.mjs`. Permission risk levels are advisory.</sub>",
  );
  return lines.join("\n");
}
