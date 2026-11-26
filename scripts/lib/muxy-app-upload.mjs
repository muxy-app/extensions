import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildOutputDir, extensionDir, readPackageManifest } from "./paths.mjs";

// The muxy.app website lists extensions from these uploads, and Muxy builds
// before the GitHub index read them too, so every release is uploaded there
// as well as published as a GitHub Release.
const UPLOAD_URL = process.env.MUXY_UPLOAD_URL || "https://muxy.app/api/extensions/upload";
const TOKEN = process.env.MUXY_UPLOAD_TOKEN;
const SECRET_KEY = process.env.MINISIGN_SECRET_KEY;

export function muxyAppUploadEnabled(signing) {
  return Boolean(TOKEN) && signing && process.env.MUXY_APP_UPLOAD !== "false";
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

export async function uploadToMuxyApp(name, packed) {
  const assets = collectListingAssets(name);
  const metadata = metadataFor(name, packed, assets);

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
    throw new Error(`muxy.app upload failed for ${name}@${packed.version}: HTTP ${response.status} ${body}`);
  }
  console.log(
    `✓ uploaded ${name}@${packed.version} (sha256=${packed.sha256}) + ${assets.length} listing asset(s), metadata signed`,
  );

}

