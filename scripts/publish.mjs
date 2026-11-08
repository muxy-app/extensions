#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildOutputDir, extensionDir, packageJSONPath, readPackageManifest } from "./lib/paths.mjs";
import { packExtension } from "./pack.mjs";

const UPLOAD_URL = process.env.MUXY_UPLOAD_URL || "https://muxy.app/api/extensions/upload";
const TOKEN = process.env.MUXY_UPLOAD_TOKEN;
const SECRET_KEY = process.env.MINISIGN_SECRET_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

// Optional release announcement. When DISCORD_WEBHOOK_URL is set, each
// successful upload posts "<name> <version> is published." plus the store page
// URL, which Discord unfurls into a preview card. Unset = silently skipped.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
// Store base; an extension's page is `${STORE_BASE_URL}/<name>`.
const STORE_BASE_URL = (process.env.MUXY_STORE_URL || "https://muxy.app/store").replace(/\/+$/, "");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

// Announce a publish to Discord. Best-effort: publishing has already succeeded
// and the artifact is live, so a webhook failure must never fail the run — it
// only warns. The store URL is posted bare (not masked, embeds not suppressed)
// so Discord unfurls the store page's Open Graph tags into a preview card.
async function postDiscordRelease(name, version) {
  if (!DISCORD_WEBHOOK_URL) return;
  const storeUrl = `${STORE_BASE_URL}/${encodeURIComponent(name)}`;
  const content = `**${name}** ${version} is published.\n${storeUrl}`;
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

function signBytes(bytes) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muxy-sign-"));
  const dataPath = path.join(tmp, "data");
  const keyPath = path.join(tmp, "minisign.key");
  try {
    fs.writeFileSync(dataPath, bytes);
    fs.writeFileSync(keyPath, SECRET_KEY, { mode: 0o600 });
    execFileSync("minisign", ["-S", "-W", "-s", keyPath, "-m", dataPath], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return fs.readFileSync(`${dataPath}.minisig`, "utf8");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const CONTENT_TYPES = { ".svg": "image/svg+xml", ".png": "image/png" };

function listingAsset(dir, field, relative) {
  const data = fs.readFileSync(path.join(dir, relative));
  const ext = path.extname(relative).toLowerCase();
  return {
    field,
    path: relative,
    filename: path.basename(relative),
    contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    data,
  };
}

function collectListingAssets(name) {
  // Listing assets live in the build output (Vite emits them into dist/).
  const distDir = path.join(extensionDir(name), buildOutputDir);
  const market = readPackageManifest(extensionDir(name)).muxy.marketplace ?? {};
  const assets = [];
  if (market.icon) assets.push(listingAsset(distDir, "icon", market.icon));
  (market.screenshots ?? []).forEach((shot, index) =>
    assets.push(listingAsset(distDir, `screenshot-${index}`, shot)),
  );
  return assets;
}

function metadataFor(name, packed, assets) {
  const { muxy } = readPackageManifest(extensionDir(name));
  const market = muxy.marketplace ?? {};
  const icon = assets.find((asset) => asset.field === "icon");
  const screenshots = assets.filter((asset) => asset.field.startsWith("screenshot-"));
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
    icon: icon ? { field: icon.field, filename: icon.filename, sha256: icon.sha256 } : null,
    screenshots: screenshots.map((shot) => ({
      field: shot.field,
      filename: shot.filename,
      sha256: shot.sha256,
    })),
  };
}

async function uploadExtension(name) {
  const packed = packExtension(name);
  const assets = collectListingAssets(name);
  const metadata = metadataFor(name, packed, assets);

  if (DRY_RUN) {
    console.log(
      `would upload ${name}@${packed.version} (${packed.size} bytes, sha256=${packed.sha256}) ` +
        `+ icon + ${metadata.screenshots.length} screenshot(s)`,
    );
    return;
  }

  const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");
  const zipSignature = signBytes(packed.zip);
  const metadataSignature = signBytes(metadataBytes);

  const form = new FormData();
  form.set(
    "metadata",
    new Blob([metadataBytes], { type: "application/json" }),
    "metadata.json",
  );
  form.set("metadataSignature", metadataSignature);
  form.set("signature", zipSignature);
  form.set(
    "artifact",
    new Blob([packed.zip], { type: "application/zip" }),
    `${name}-${packed.version}.zip`,
  );
  for (const asset of assets) {
    form.set(asset.field, new Blob([asset.data], { type: asset.contentType }), asset.filename);
  }

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "X-Extension-Name": name,
      "X-Extension-Version": packed.version,
      "X-Extension-Sha256": packed.sha256,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    fail(`upload failed for ${name}@${packed.version}: HTTP ${response.status} ${body}`);
  }
  console.log(
    `✓ uploaded ${name}@${packed.version} (sha256=${packed.sha256}) + ${assets.length} listing asset(s), metadata signed`,
  );

  // Announce only after a confirmed upload, so the store link is live.
  await postDiscordRelease(name, packed.version);
}

async function main() {
  const names = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (names.length === 0) {
    console.log("No changed extensions to publish.");
    return;
  }

  if (!DRY_RUN) {
    if (!TOKEN) fail("MUXY_UPLOAD_TOKEN is not set.");
    if (!SECRET_KEY) fail("MINISIGN_SECRET_KEY is not set.");
  }

  for (const name of names) {
    if (!fs.existsSync(packageJSONPath(extensionDir(name)))) {
      console.log(`skip ${name} (removed)`);
      continue;
    }
    await uploadExtension(name);
  }
}

main().catch((err) => fail(err.message));
