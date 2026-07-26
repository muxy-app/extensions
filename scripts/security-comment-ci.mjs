#!/usr/bin/env node

import {
  changedExtensionNames,
  getRepositoryBlobText,
  getRepositoryTextFile,
  getRepositoryTree,
  GitHubAPI,
  listPullRequestFiles,
  parseExtensionManifest,
  pullRequestContextFromEnvironment,
  repositoryAPIName,
} from "./lib/github-pr.mjs";
import {
  analyseExtensionData,
  COMMENT_MARKER,
  isScannableSourcePath,
  renderSecurityComment,
} from "./lib/security-report.mjs";

const MAX_COMMENT_PAGES = 30;
const MAX_CHANGED_EXTENSIONS = 10;
const MAX_SOURCE_FILES_PER_EXTENSION = 200;
const MAX_TOTAL_SOURCE_REQUESTS = 400;
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_COMMENT_BYTES = 60 * 1024;
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

function workflowError(message) {
  const escaped = String(message)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error::${escaped}`);
}

async function listIssueComments(api, context) {
  const repository = repositoryAPIName(context.baseRepository);
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const batch = await api.get(
      `/repos/${repository}/issues/${context.number}/comments?per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch)) {
      throw new Error("GitHub returned an invalid pull request comment list");
    }
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
  throw new Error(
    `pull request comment list exceeds ${MAX_COMMENT_PAGES * 100} comments`,
  );
}

async function fetchExtensionSource(api, context, tree, name, budget) {
  const prefix = `extensions/${name}/`;
  const candidates = tree.filter((entry) => {
    if (!entry || entry.type !== "blob" || typeof entry.path !== "string") {
      return false;
    }
    return (
      entry.path.startsWith(prefix) &&
      isScannableSourcePath(entry.path.slice(prefix.length))
    );
  });

  const files = [];
  let totalBytes = 0;
  let skippedSourceFiles = 0;
  for (const entry of candidates) {
    if (
      files.length >= MAX_SOURCE_FILES_PER_EXTENSION ||
      budget.remainingRequests <= 0 ||
      !REGULAR_FILE_MODES.has(entry.mode) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > MAX_SOURCE_FILE_BYTES ||
      totalBytes + entry.size > MAX_TOTAL_SOURCE_BYTES
    ) {
      skippedSourceFiles += 1;
      continue;
    }

    budget.remainingRequests -= 1;
    const content = await getRepositoryBlobText(
      api,
      context.baseRepository,
      entry.sha,
      { maxBytes: MAX_SOURCE_FILE_BYTES },
    );
    files.push({
      path: entry.path.slice(prefix.length),
      content,
    });
    totalBytes += Buffer.byteLength(content);
  }

  return { files, skippedSourceFiles };
}

async function analyseExtensions(api, context, names) {
  const tree = await getRepositoryTree(
    api,
    // GitHub exposes the open PR's exact head objects through the base
    // repository, keeping the job's token scoped to that one repository.
    context.baseRepository,
    context.headSha,
  );
  const extensions = [];
  const budget = { remainingRequests: MAX_TOTAL_SOURCE_REQUESTS };

  for (const name of names) {
    const packagePath = `extensions/${name}/package.json`;
    const manifestText = await getRepositoryTextFile(
      api,
      context.baseRepository,
      context.headSha,
      packagePath,
      { allow404: true },
    );
    if (manifestText === null) {
      console.log(`Skipping '${name}': removed at the PR head.`);
      continue;
    }
    const manifest = parseExtensionManifest(
      manifestText,
      name,
      `${packagePath} at PR head`,
    );
    const { files, skippedSourceFiles } = await fetchExtensionSource(
      api,
      context,
      tree,
      name,
      budget,
    );
    extensions.push(
      analyseExtensionData({
        name,
        packageJSON: manifest.packageJSON,
        files,
        skippedSourceFiles,
      }),
    );
  }
  return extensions;
}

async function replaceSecurityComment(api, context, body) {
  if (Buffer.byteLength(body) > MAX_COMMENT_BYTES) {
    throw new Error(`security report exceeds ${MAX_COMMENT_BYTES} bytes`);
  }

  const comments = await listIssueComments(api, context);
  const previous = comments.filter(
    (comment) =>
      comment?.user?.login === "github-actions[bot]" &&
      typeof comment.body === "string" &&
      comment.body.includes(COMMENT_MARKER),
  );
  const repository = repositoryAPIName(context.baseRepository);

  await api.post(`/repos/${repository}/issues/${context.number}/comments`, {
    body,
  });
  for (const comment of previous) {
    if (Number.isSafeInteger(comment.id) && comment.id > 0) {
      await api.delete(`/repos/${repository}/issues/comments/${comment.id}`);
    }
  }
}

async function main() {
  const context = pullRequestContextFromEnvironment();
  const api = new GitHubAPI(process.env.GITHUB_TOKEN);
  const changedFiles = await listPullRequestFiles(api, context);
  const names = changedExtensionNames(changedFiles);

  if (names.length === 0) {
    console.log("No extensions changed; no security comment is needed.");
    return;
  }
  if (names.length > MAX_CHANGED_EXTENSIONS) {
    throw new Error(
      `refusing to scan more than ${MAX_CHANGED_EXTENSIONS} changed extensions`,
    );
  }

  const extensions = await analyseExtensions(api, context, names);
  if (extensions.length === 0) {
    console.log("No extensions remain at the PR head; no security comment is needed.");
    return;
  }
  const report = renderSecurityComment(extensions);
  await replaceSecurityComment(api, context, report);
  console.log(
    `Posted security report for ${extensions.map((e) => e.name).join(", ")}.`,
  );
}

main().catch((error) => {
  workflowError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
