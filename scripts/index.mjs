#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extensionDir, packageJSONPath, readJSON, repoRoot } from "./lib/paths.mjs";
import { commitIndexBranch, gitAuthEnv } from "./lib/index-branch.mjs";
import {
  INDEX_BRANCH,
  INDEX_FILE,
  METADATA_ASSET,
  assembleIndex,
  downloadCounts,
  indexEntry,
  latestReleases,
  serializeIndex,
} from "./lib/marketplace-index.mjs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_RELEASE_PAGES = 100;
const MAX_METADATA_BYTES = 256 * 1024;
const REPOSITORY = process.env.GITHUB_REPOSITORY || "muxy-app/extensions";
const TOKEN = process.env.GITHUB_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

async function listReleases() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "muxy-extensions-ci",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const releases = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const url = `${API_ROOT}/repos/${REPOSITORY}/releases?per_page=100&page=${page}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`listing releases failed: HTTP ${response.status} ${body}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid release list");
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
  throw new Error(`release list exceeds ${MAX_RELEASE_PAGES * 100} releases`);
}

async function readMetadata(release) {
  const asset = (release.assets ?? []).find((candidate) => candidate.name === METADATA_ASSET);
  if (!asset) return null;
  if (asset.size > MAX_METADATA_BYTES) {
    throw new Error(`release ${release.tag_name}: ${METADATA_ASSET} is ${asset.size} bytes`);
  }
  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "muxy-extensions-ci" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`release ${release.tag_name}: ${METADATA_ASSET} download failed: HTTP ${response.status}`);
  }
  return response.text();
}

function parseMetadata(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readOfficialNames() {
  const names = readJSON(path.join(repoRoot, "official.json"));
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
    throw new Error("official.json must be a JSON array of extension names");
  }
  return new Set(names);
}

export async function buildIndex() {
  const official = readOfficialNames();
  const releases = await listReleases();
  const downloads = downloadCounts(releases);
  const entries = [];
  for (const { name, version, release } of latestReleases(releases)) {
    if (!fs.existsSync(packageJSONPath(extensionDir(name)))) {
      console.error(`skip ${name}@${version} (no longer in extensions/)`);
      continue;
    }
    const metadata = parseMetadata(await readMetadata(release));
    try {
      entries.push(
        indexEntry({
          name,
          version,
          release,
          metadata,
          downloads: downloads.get(name) ?? 0,
          official: official.has(name),
        }),
      );
    } catch (err) {
      console.error(`::warning::skip ${name}@${version}: ${err.message}`);
    }
  }
  return assembleIndex(entries);
}

async function main() {
  const index = await buildIndex();
  const content = serializeIndex(index);

  if (DRY_RUN) {
    process.stdout.write(content);
    return;
  }

  const result = commitIndexBranch({ cwd: repoRoot, content, env: gitAuthEnv(TOKEN) });
  const summary = `${index.extensions.length} extension(s)`;
  if (result.changed) {
    console.log(`✓ ${INDEX_FILE} updated on '${INDEX_BRANCH}' (${summary}, ${result.commit})`);
  } else {
    console.log(`${INDEX_FILE} on '${INDEX_BRANCH}' is unchanged (${summary})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err.message));
}
