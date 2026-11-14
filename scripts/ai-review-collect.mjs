#!/usr/bin/env node
// Job 1 of the Copilot malware review (.github/workflows/ai-review.yml).
//
// Runs from the trusted base branch with a read-only token. Reads the PR's
// changed files through the GitHub API at the exact head SHA, never checks
// out or executes fork code, and writes:
//
//   <out>/meta.json          trusted facts for the decide job
//   <out>/prompt.txt         the prompt piped to Copilot on stdin
//   <out>/bundle/CHANGES.md  change summary and diffs (untrusted data)
//   <out>/bundle/files/...   changed files at the PR head (untrusted data)
//
// Copilot runs with `<out>/bundle` as its only readable directory.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  changedExtensionNames,
  getRepositoryTextFile,
  getRepositoryTree,
  GitHubAPI,
  listPullRequestFiles,
  pullRequestContextFromEnvironment,
  repositoryAPIName,
} from "./lib/github-pr.mjs";
import {
  buildPrompt,
  checkLimits,
  copilotStepStarted,
  deterministicSignals,
  findHiddenUnicode,
  isImagePath,
  isProbablyText,
  MANUAL_LABEL,
  mustReview,
  permissionsOf,
  summariseDependencies,
  summariseLockfile,
  TRUSTED_ASSOCIATIONS,
  untrustedBlock,
} from "./lib/ai-review.mjs";

const MAX_EXTENSIONS = 3;
const MAX_FILES = 300;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_LOCKFILE_BYTES = 8 * 1024 * 1024;
const INLINE_CHANGES_LIMIT = 150 * 1024;
const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RUN_PAGES = 5;

function limitFromEnv(name, fallback) {
  const raw = (process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (0 disables it)`);
  }
  return value;
}

// Lists this workflow's runs from the last 24 hours and marks which ones
// reached the Copilot step. Runs cancelled before that step spent nothing.
async function recentRuns(api, repository) {
  const workflowFile =
    (process.env.GITHUB_WORKFLOW_REF ?? "").match(/\/([^/@]+\.ya?ml)@/)?.[1] ?? "ai-review.yml";
  const since = new Date(Date.now() - LIMIT_WINDOW_MS).toISOString();
  const currentRun = String(process.env.GITHUB_RUN_ID ?? "");
  const runs = [];
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const result = await api.get(
      `/repos/${repositoryAPIName(repository)}/actions/workflows/${encodeURIComponent(workflowFile)}/runs` +
        `?created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`,
    );
    const batch = Array.isArray(result?.workflow_runs) ? result.workflow_runs : [];
    for (const run of batch) {
      if (String(run?.id) === currentRun) continue;
      if (run?.status === "completed" && run?.conclusion === "skipped") continue;
      const jobs = await api.get(
        `/repos/${repositoryAPIName(repository)}/actions/runs/${encodeURIComponent(run.id)}/jobs?per_page=50`,
      );
      runs.push({
        id: run.id,
        actorLogin: run.actor?.login ?? "",
        spent: copilotStepStarted(jobs?.jobs),
      });
    }
    if (batch.length < 100) return runs;
  }
  // More runs than we are willing to inspect: treat the repository as over
  // its limit rather than guessing.
  runs.push(...Array.from({ length: 10_000 }, () => ({ id: 0, actorLogin: "", spent: true })));
  return runs;
}

function outDir() {
  const index = process.argv.indexOf("--out");
  const dir = index > 0 ? process.argv[index + 1] : process.env.AI_REVIEW_DIR;
  if (!dir) throw new Error("pass --out <dir> or set AI_REVIEW_DIR");
  return path.resolve(dir);
}

function safeRelative(filePath) {
  const segments = String(filePath).split("/");
  if (
    filePath.startsWith("/") ||
    segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\0"))
  ) {
    throw new Error(`unsafe path in pull request: ${JSON.stringify(filePath)}`);
  }
  return segments.join(path.sep);
}

async function getBlob(api, repository, sha, maxBytes) {
  const result = await api.get(
    `/repos/${repositoryAPIName(repository)}/git/blobs/${encodeURIComponent(sha)}`,
  );
  if (
    !result ||
    result.encoding !== "base64" ||
    typeof result.content !== "string" ||
    !Number.isSafeInteger(result.size) ||
    result.size > maxBytes
  ) {
    throw new Error("blob is invalid or over the size limit");
  }
  const buffer = Buffer.from(result.content, "base64");
  if (buffer.byteLength > maxBytes) throw new Error("blob is over the size limit");
  return buffer;
}

function parseJSON(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeMeta(dir, meta) {
  fs.writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

async function collectExtension({ api, context, tree, name, changedFiles, budget, bundleDir }) {
  const prefix = `extensions/${name}/`;
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const entries = [];
  const skipped = [];
  const requiredFiles = [];
  const diffs = [];

  const files = changedFiles.filter(
    (f) => f.filename.startsWith(prefix) || f.previous_filename?.startsWith(prefix),
  );
  if (files.length > MAX_FILES) {
    skipped.push({ message: `Changes ${files.length} files in ${name}; only the first ${MAX_FILES} were reviewed.` });
  }

  for (const file of files.slice(0, MAX_FILES)) {
    const filePath = file.filename;
    const status = file.status;
    const patch = typeof file.patch === "string" ? file.patch : "";
    const isLockfile = filePath === `${prefix}package-lock.json`;

    if (status === "removed") {
      entries.push({ path: filePath, status, kind: "removed" });
      diffs.push({ path: filePath, status, patch: "" });
      continue;
    }
    const entry = byPath.get(filePath);
    if (!entry) {
      skipped.push({ path: filePath, message: "is missing from the PR head tree." });
      continue;
    }
    if (entry.mode === "160000") {
      entries.push({ path: filePath, status, kind: "submodule" });
      continue;
    }
    if (entry.mode === "120000") {
      const target = (await getBlob(api, context.baseRepository, entry.sha, 4096)).toString("utf8");
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), target));
      const escapes = target.startsWith("/") || !resolved.startsWith(prefix);
      entries.push({ path: filePath, status, kind: "symlink", target, escapes });
      continue;
    }
    if (isLockfile) {
      // Summarised separately; too large and noisy to send verbatim.
      entries.push({ path: filePath, status, kind: "lockfile" });
      continue;
    }
    if (isImagePath(filePath)) {
      entries.push({ path: filePath, status, kind: "image" });
      continue;
    }
    if (!Number.isSafeInteger(entry.size) || entry.size > MAX_FILE_BYTES) {
      skipped.push({ path: filePath, message: `is over ${MAX_FILE_BYTES / 1024} KB and was not reviewed.` });
      continue;
    }
    if (budget.bytes + entry.size > MAX_TOTAL_BYTES) {
      skipped.push({ path: filePath, message: `was not reviewed: the PR is over the ${MAX_TOTAL_BYTES / 1024 / 1024} MB review budget.` });
      continue;
    }

    const buffer = await getBlob(api, context.baseRepository, entry.sha, MAX_FILE_BYTES);
    budget.bytes += buffer.byteLength;
    if (!isProbablyText(buffer)) {
      entries.push({ path: filePath, status, kind: "binary" });
      continue;
    }
    const text = buffer.toString("utf8");
    const target = path.join(bundleDir, "files", safeRelative(filePath));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, { mode: 0o644 });
    entries.push({ path: filePath, status, kind: "text", hiddenUnicode: findHiddenUnicode(text) });
    if (mustReview(filePath)) requiredFiles.push(filePath);
    diffs.push({ path: filePath, status, patch, previous: file.previous_filename });
  }

  // Manifest and dependency changes.
  const packagePath = `${prefix}package.json`;
  const lockPath = `${prefix}package-lock.json`;
  const [headPackageText, basePackageText] = await Promise.all([
    getRepositoryTextFile(api, context.baseRepository, context.headSha, packagePath, { allow404: true }),
    getRepositoryTextFile(api, context.baseRepository, context.baseSha, packagePath, { allow404: true }),
  ]);
  const headPackage = parseJSON(headPackageText);
  const basePackage = parseJSON(basePackageText);
  const dependencies = headPackage ? summariseDependencies(basePackage, headPackage) : null;

  let lockfile = null;
  if (entries.some((e) => e.kind === "lockfile")) {
    try {
      const [headLock, baseLock] = await Promise.all([
        getRepositoryTextFile(api, context.baseRepository, context.headSha, lockPath, { allow404: true, maxBytes: MAX_LOCKFILE_BYTES }),
        getRepositoryTextFile(api, context.baseRepository, context.baseSha, lockPath, { allow404: true, maxBytes: MAX_LOCKFILE_BYTES }),
      ]);
      if (headLock !== null) lockfile = summariseLockfile(baseLock ?? "", headLock);
    } catch (error) {
      skipped.push({ message: "The lockfile could not be analysed." });
      console.log(`lockfile analysis failed: ${error.message}`);
    }
  }

  return {
    name,
    isNew: basePackageText === null,
    baseVersion: basePackage?.version ?? null,
    headVersion: headPackage?.version ?? null,
    description: headPackage?.muxy?.description ?? "",
    basePermissions: permissionsOf(basePackage),
    headPermissions: permissionsOf(headPackage),
    entries,
    skipped,
    requiredFiles,
    diffs,
    dependencies,
    lockfile,
  };
}

function renderChanges({ nonce, context, extension, signals, author }) {
  const lines = [];
  const e = extension;
  lines.push(`# PR #${context.number}: extension ${e.name}`, "");
  lines.push(
    `- Type: ${e.isNew ? "new extension" : `update ${e.baseVersion} → ${e.headVersion}`}`,
    `- Opened by: ${context.opener} (${author})`,
    `- Permissions at head: ${e.headPermissions.join(", ") || "none"}`,
    `- Permissions at base: ${e.isNew ? "(new extension)" : e.basePermissions.join(", ") || "none"}`,
    "",
  );
  lines.push(untrustedBlock(nonce, "PR title and manifest description", `Title: ${context.currentTitle}\nDescription: ${e.description}`), "");

  lines.push("## Automated checks", "");
  if (signals.length === 0) lines.push("- none");
  for (const s of signals) lines.push(`- [${s.level}] ${s.message}`);
  lines.push("");

  lines.push("## Dependencies", "");
  const d = e.dependencies;
  if (!d) lines.push("- package.json could not be read at the PR head.");
  else {
    for (const x of d.added) lines.push(`- added ${x.field}: ${x.name} ${x.spec}`);
    for (const x of d.changed) lines.push(`- changed ${x.field}: ${x.name} ${x.from} → ${x.to}`);
    for (const x of d.removed) lines.push(`- removed ${x.field}: ${x.name}`);
    for (const x of d.scriptChanges) lines.push(`- npm script "${x.name}" is now: ${x.command}`);
    if (!d.added.length && !d.changed.length && !d.removed.length && !d.scriptChanges.length) {
      lines.push("- no dependency or npm script changes");
    }
  }
  if (e.lockfile) {
    const l = e.lockfile;
    lines.push(
      "",
      `Lockfile: ${l.total} packages; ${l.added.length} added, ${l.changed.length} changed, ${l.removed} removed.`,
    );
    for (const x of l.added.slice(0, 150)) lines.push(`- added ${x.name}@${x.version}${x.hasInstallScript ? " (has install script)" : ""}`);
    if (l.added.length > 150) lines.push(`- …and ${l.added.length - 150} more added`);
    for (const x of l.changed.slice(0, 100)) lines.push(`- changed ${x.name} ${x.from} → ${x.version}`);
  }
  lines.push("");

  lines.push("## Changed files", "");
  for (const entry of e.entries) lines.push(`- ${entry.status} ${entry.kind}: ${entry.path}`);
  lines.push("");

  lines.push("## Diffs", "");
  for (const diff of e.diffs) {
    const label = `${diff.status} ${diff.path}${diff.previous ? ` (from ${diff.previous})` : ""}`;
    const body = diff.status === "removed"
      ? "(file removed)"
      : diff.patch || "(diff not available from GitHub; read the full file under files/)";
    lines.push(untrustedBlock(nonce, label, body), "");
  }
  return lines.join("\n");
}

async function main() {
  const dir = outDir();
  const bundleDir = path.join(dir, "bundle");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(bundleDir, "files"), { recursive: true });

  const context = pullRequestContextFromEnvironment();
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const author = String(event.pull_request?.author_association ?? "NONE").replace(/[^A-Z_]/g, "");
  const api = new GitHubAPI(process.env.GITHUB_TOKEN);
  const nonce = crypto.randomBytes(16).toString("hex");

  const changedFiles = await listPullRequestFiles(api, context);
  const extensionNames = changedExtensionNames(changedFiles);
  const outsidePaths = changedFiles
    .flatMap((f) => [f.filename, f.previous_filename])
    .filter((p) => typeof p === "string" && !p.startsWith("extensions/"));

  const manual = event.action === "labeled" && event.label?.name === MANUAL_LABEL;
  const trusted = TRUSTED_ASSOCIATIONS.has(author);

  const meta = {
    version: 1,
    manual,
    limited: null,
    number: context.number,
    headSha: context.headSha,
    baseSha: context.baseSha,
    nonce,
    extensionNames,
    skip: false,
    signals: [],
    requiredFiles: [],
  };

  if (extensionNames.length === 0) {
    meta.skip = true;
    writeMeta(dir, meta);
    console.log("No extension changed; nothing to review.");
    return;
  }

  if (manual) {
    console.log(`Manual review requested with the '${MANUAL_LABEL}' label; limits do not apply.`);
  } else if (trusted) {
    console.log(`Author association ${author}; limits do not apply.`);
  } else {
    const repoLimit = limitFromEnv("AI_REVIEW_DAILY_LIMIT", 30);
    const authorLimit = limitFromEnv("AI_REVIEW_AUTHOR_DAILY_LIMIT", 10);
    const runs = await recentRuns(api, context.baseRepository);
    meta.limited = checkLimits({ runs, author: context.opener, repoLimit, authorLimit });
    if (meta.limited) {
      writeMeta(dir, meta);
      console.log(
        `Limit reached (${meta.limited.scope}: ${meta.limited.count}/${meta.limited.limit} in 24h); Copilot will not run.`,
      );
      return;
    }
    const spent = runs.filter((r) => r.spent);
    console.log(
      `Usage in the last 24h: ${spent.length}/${repoLimit || "∞"} repository, ` +
        `${spent.filter((r) => r.actorLogin.toLowerCase() === context.opener.toLowerCase()).length}/${authorLimit || "∞"} by ${context.opener}.`,
    );
  }

  const tree = await getRepositoryTree(api, context.baseRepository, context.headSha);
  const budget = { bytes: 0 };
  const sections = [];
  const extraSkipped = [];
  if (extensionNames.length > MAX_EXTENSIONS) {
    extraSkipped.push({ message: `Only the first ${MAX_EXTENSIONS} of ${extensionNames.length} changed extensions were reviewed.` });
  }

  for (const name of extensionNames.slice(0, MAX_EXTENSIONS)) {
    const extension = await collectExtension({
      api, context, tree, name, changedFiles, budget, bundleDir,
    });
    const signals = deterministicSignals({
      extensionNames,
      outsidePaths,
      entries: extension.entries,
      dependencies: extension.dependencies,
      lockfile: extension.lockfile,
      basePermissions: extension.basePermissions,
      headPermissions: extension.headPermissions,
      skipped: [...extension.skipped, ...(sections.length === 0 ? extraSkipped : [])],
    });
    // PR-wide signals repeat per extension; keep the first copy.
    for (const s of signals) {
      if (!meta.signals.some((x) => x.level === s.level && x.message === s.message)) {
        meta.signals.push(s);
      }
    }
    meta.requiredFiles.push(...extension.requiredFiles);
    sections.push(renderChanges({ nonce, context, extension, signals, author }));
  }

  const changes = sections.join("\n\n---\n\n");
  fs.writeFileSync(path.join(bundleDir, "CHANGES.md"), changes);
  const prompt = buildPrompt({
    nonce,
    changes,
    changesInline: Buffer.byteLength(changes) <= INLINE_CHANGES_LIMIT,
    reviewFiles: meta.requiredFiles,
  });
  fs.writeFileSync(path.join(dir, "prompt.txt"), prompt);
  // The workflow runs the Copilot step only when this flag exists, so runs
  // that never reach Copilot show it as skipped and do not count as spend.
  if (process.env.AI_REVIEW_FLAG) fs.writeFileSync(process.env.AI_REVIEW_FLAG, "run\n");
  writeMeta(dir, meta);

  console.log(`Prepared review of ${extensionNames.join(", ")} at ${context.headSha}.`);
  console.log(`  files to read: ${meta.requiredFiles.length}, bytes: ${budget.bytes}, prompt: ${Buffer.byteLength(prompt)} bytes`);
  for (const s of meta.signals) console.log(`  [${s.level}] ${s.message}`);
}

main().catch((error) => {
  const message = String(error instanceof Error ? error.message : error)
    .replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
