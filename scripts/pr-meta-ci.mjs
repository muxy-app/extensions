#!/usr/bin/env node

import {
  changedExtensionNames,
  compareVersionCores,
  getRepositoryTextFile,
  GitHubAPI,
  listPullRequestFiles,
  parseExtensionManifest,
  pullRequestContextFromEnvironment,
  repositoryAPIName,
} from "./lib/github-pr.mjs";

const AUTHOR_REVIEW_MARKER = "<!-- muxy-extension-author-review -->";
const MAX_COMMENT_PAGES = 30;

function workflowMessage(kind, message) {
  const escaped = String(message)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  const output = `::${kind}::${escaped}`;
  if (kind === "error") console.error(output);
  else console.log(output);
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

async function pingExtensionAuthor(api, context, name, authorGitHub) {
  if (!authorGitHub || authorGitHub.toLowerCase() === context.opener.toLowerCase()) {
    console.log("No extension-author review ping is needed.");
    return;
  }

  const comments = await listIssueComments(api, context);
  if (
    comments.some(
      (comment) =>
        comment?.user?.login === "github-actions[bot]" &&
        typeof comment.body === "string" &&
        comment.body.includes(AUTHOR_REVIEW_MARKER),
    )
  ) {
    console.log("The extension author has already been pinged on this pull request.");
    return;
  }

  const repository = repositoryAPIName(context.baseRepository);
  await api.post(`/repos/${repository}/issues/${context.number}/comments`, {
    body:
      `${AUTHOR_REVIEW_MARKER}\n@${authorGitHub} — this PR changes the **${name}** extension, ` +
      "which you're listed as the author of. Could you review it?",
  });
  console.log(`Pinged extension author @${authorGitHub}.`);
}

async function main() {
  const context = pullRequestContextFromEnvironment();
  const api = new GitHubAPI(process.env.GITHUB_TOKEN);
  const files = await listPullRequestFiles(api, context);
  const names = changedExtensionNames(files);

  if (names.length === 0) {
    console.log("No extension changed (tooling-only PR); skipping title and bump checks.");
    return;
  }
  if (names.length > 1) {
    throw new Error(
      `This PR changes ${names.length} extensions (${names.join(", ")}). Open one PR per extension.`,
    );
  }

  const name = names[0];
  const packagePath = `extensions/${name}/package.json`;
  const headText = await getRepositoryTextFile(
    api,
    // Open PR head objects are addressable through the base repository at the
    // exact head SHA. Keeping all API reads in the base repository means the
    // scoped GITHUB_TOKEN never needs access to the fork repository itself.
    context.baseRepository,
    context.headSha,
    packagePath,
    { allow404: true },
  );
  if (headText === null) {
    throw new Error(
      `${packagePath} does not exist at the PR head — cannot derive a version. A removal PR should not be the only change to a single extension.`,
    );
  }
  const submission = parseExtensionManifest(
    headText,
    name,
    `${packagePath} at PR head`,
  );
  if (submission.authorWarning) {
    workflowMessage("warning", submission.authorWarning);
  }

  const baseText = await getRepositoryTextFile(
    api,
    context.baseRepository,
    context.baseSha,
    packagePath,
    { allow404: true },
  );
  if (baseText === null) {
    console.log(`New extension '${name}' at ${submission.version}.`);
  } else {
    const base = parseExtensionManifest(
      baseText,
      name,
      `${packagePath} at base`,
    );
    const comparison = compareVersionCores(submission.version, base.version);
    console.log(
      `Existing '${name}': ${base.version} (base) -> ${submission.version} (PR).`,
    );
    if (comparison < 0) {
      throw new Error(
        `version '${submission.version}' is lower than base version '${base.version}'`,
      );
    }
    if (comparison === 0) {
      throw new Error(
        `version '${submission.version}' does not bump base version '${base.version}'`,
      );
    }
  }

  const desiredTitle = `${name} ${submission.version}`;
  if (context.currentTitle === desiredTitle) {
    console.log(`PR title is already '${desiredTitle}'.`);
  } else {
    const repository = repositoryAPIName(context.baseRepository);
    await api.patch(`/repos/${repository}/pulls/${context.number}`, {
      title: desiredTitle,
    });
    console.log(`Updated PR title to '${desiredTitle}'.`);
  }

  await pingExtensionAuthor(
    api,
    context,
    name,
    submission.authorGitHub,
  );
}

main().catch((error) => {
  workflowMessage("error", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
