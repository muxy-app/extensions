#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildOutputDir,
  extensionDir,
  packageJSONPath,
  readPackageManifest,
  repoRoot,
} from "./lib/paths.mjs";
import { gitAuthEnv } from "./lib/index-branch.mjs";
import { METADATA_ASSET, releaseTag, zipAssetName } from "./lib/marketplace-index.mjs";
import { packExtension } from "./pack.mjs";
import { muxyAppUploadEnabled, uploadToMuxyApp } from "./lib/muxy-app-upload.mjs";

const REPOSITORY = process.env.GITHUB_REPOSITORY || "muxy-app/extensions";
const TARGET_SHA = process.env.GITHUB_SHA;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const SECRET_KEY = process.env.MINISIGN_SECRET_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

// Optional release announcement. When DISCORD_WEBHOOK_URL is set, each new
// release posts "<name> <version> is published." plus the release page URL.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

// Best-effort: the release is already live, so a webhook failure only warns.
async function postDiscordRelease(name, version, releaseURL) {
  if (!DISCORD_WEBHOOK_URL) return;
  const content = `**${name}** ${version} is published.\n${releaseURL}`;
  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.log(`::warning::Discord announce for ${name}@${version} failed: HTTP ${response.status} ${body}`);
      return;
    }
    console.log(`✓ announced ${name}@${version} to Discord`);
  } catch (err) {
    console.log(`::warning::Discord announce for ${name}@${version} errored: ${err.message}`);
  }
}

// Signing is optional: it needs both the secret and a real committed public
// key, so a fork or an unconfigured repo publishes unsigned releases.
function signingEnabled() {
  if (!SECRET_KEY) return false;
  const publicKeyPath = path.join(repoRoot, "minisign.pub");
  if (!fs.existsSync(publicKeyPath)) return false;
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");
  return !publicKey.includes("PLACEHOLDER") && !publicKey.includes("REPLACE ME");
}

function signFile(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muxy-key-"));
  const keyPath = path.join(tmp, "minisign.key");
  try {
    fs.writeFileSync(keyPath, SECRET_KEY, { mode: 0o600 });
    execFileSync("minisign", ["-S", "-W", "-s", keyPath, "-m", file], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return `${path.basename(file)}.minisig`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Listing assets live in the build output (Vite emits them into dist/) and are
// renamed to the fixed names the index points at.
function listingAssets(name) {
  const distDir = path.join(extensionDir(name), buildOutputDir);
  const market = readPackageManifest(extensionDir(name)).muxy.marketplace ?? {};
  const icon = market.icon
    ? { source: path.join(distDir, market.icon), name: `icon${path.extname(market.icon).toLowerCase()}` }
    : null;
  const screenshots = (market.screenshots ?? []).map((shot, index) => ({
    source: path.join(distDir, shot),
    name: `screenshot-${index + 1}.png`,
  }));
  return { icon, screenshots };
}

function metadataFor(name, packed, assets) {
  const { muxy } = readPackageManifest(extensionDir(name));
  const market = muxy.marketplace ?? {};
  return {
    name,
    version: packed.version,
    sha256: packed.sha256,
    size: packed.size,
    description: muxy.description ?? null,
    permissions: muxy.permissions ?? [],
    author:
      market.author || market.github
        ? { name: market.author ?? null, github: market.github ?? null }
        : null,
    homepage: market.homepage ?? null,
    repository: market.repository ?? null,
    categories: market.categories ?? [],
    icon: assets.icon?.name ?? null,
    screenshots: assets.screenshots.map((shot) => shot.name),
    published_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

// Published versions are immutable: an existing tag is never touched.
function tagExists(tag) {
  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
      cwd: repoRoot,
      env: gitAuthEnv(TOKEN),
      stdio: ["ignore", "ignore", "inherit"],
    });
    return true;
  } catch (err) {
    if (err.status === 2) return false;
    throw new Error(`could not check whether tag ${tag} exists: ${err.message}`);
  }
}

function stageRelease(dir, name, packed, assets, metadata, sign) {
  const files = [];
  const write = (file, data) => {
    fs.writeFileSync(path.join(dir, file), data);
    files.push(file);
  };
  write(zipAssetName(name, packed.version), packed.zip);
  write(METADATA_ASSET, `${JSON.stringify(metadata, null, 2)}\n`);
  for (const asset of [assets.icon, ...assets.screenshots].filter(Boolean)) {
    write(asset.name, fs.readFileSync(asset.source));
  }
  if (sign) {
    for (const file of [zipAssetName(name, packed.version), METADATA_ASSET]) {
      files.push(signFile(path.join(dir, file)));
    }
  }
  return files;
}

async function publishExtension(name, sign, upload) {
  const packed = packExtension(name);
  const tag = releaseTag(name, packed.version);
  const assets = listingAssets(name);
  const metadata = metadataFor(name, packed, assets);

  if (DRY_RUN) {
    console.log(
      `would release ${tag} (${packed.size} bytes, sha256=${packed.sha256}) ` +
        `+ ${assets.icon ? "icon" : "no icon"} + ${assets.screenshots.length} screenshot(s)` +
        `${sign ? ", signed" : ""}${upload ? ", and upload it to muxy.app" : ""}`,
    );
    return;
  }

  if (upload) await uploadToMuxyApp(name, packed);

  if (tagExists(tag)) {
    console.log(`::notice::${tag} is already released; skipping ${name}`);
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muxy-release-"));
  try {
    const files = stageRelease(dir, name, packed, assets, metadata, sign);
    const args = [
      "release",
      "create",
      tag,
      ...files,
      "--repo",
      REPOSITORY,
      "--title",
      `${name} ${packed.version}`,
      "--notes",
      metadata.description ?? "",
    ];
    if (TARGET_SHA) args.push("--target", TARGET_SHA);
    const output = execFileSync("gh", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    const releaseURL =
      output.trim().split("\n").at(-1) ||
      `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`;
    console.log(
      `✓ released ${tag} (sha256=${packed.sha256}) with ${files.length} asset(s)${sign ? ", signed" : ""}`,
    );
    await postDiscordRelease(name, packed.version, releaseURL);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const names = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (names.length === 0) {
    console.log("No changed extensions to publish.");
    return;
  }

  const sign = signingEnabled();
  if (!sign) console.log("Signing is not configured; releases will not be signed.");
  const upload = muxyAppUploadEnabled(sign);
  if (!upload) console.log("::notice::muxy.app upload is off or not configured; publishing to GitHub only.");

  for (const name of names) {
    if (!fs.existsSync(packageJSONPath(extensionDir(name)))) {
      console.log(`skip ${name} (removed)`);
      continue;
    }
    await publishExtension(name, sign, upload);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err.message));
}
