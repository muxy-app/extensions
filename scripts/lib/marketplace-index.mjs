import { compareSemver, parseSemver } from "./semver.mjs";

export const INDEX_SCHEMA = 1;
export const INDEX_BRANCH = "index";
export const INDEX_FILE = "index.json";
export const METADATA_ASSET = "metadata.json";

const EXTENSION_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function releaseTag(name, version) {
  return `${name}@${version}`;
}

export function zipAssetName(name, version) {
  return `${name}-${version}.zip`;
}

// Tags are `<name>@<version>`. Split at the last `@` so the version never
// swallows part of the name. Returns null for any tag that is not ours.
export function parseReleaseTag(tag) {
  if (typeof tag !== "string") return null;
  const at = tag.lastIndexOf("@");
  if (at <= 0) return null;
  const name = tag.slice(0, at);
  const version = tag.slice(at + 1);
  if (!EXTENSION_NAME_RE.test(name) || !parseSemver(version)) return null;
  return { name, version };
}

function findAsset(release, assetName) {
  return (release.assets ?? []).find((asset) => asset.name === assetName) ?? null;
}

// The highest published version per extension name, sorted by name. Drafts,
// prereleases and tags that do not parse never count as published.
export function latestReleases(releases) {
  const latest = new Map();
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const parsed = parseReleaseTag(release.tag_name);
    if (!parsed) continue;
    const current = latest.get(parsed.name);
    if (!current || compareSemver(parsed.version, current.version) > 0) {
      latest.set(parsed.name, { ...parsed, release });
    }
  }
  return [...latest.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Total zip downloads per extension name, across every release of that name.
export function downloadCounts(releases) {
  const counts = new Map();
  for (const release of releases) {
    const parsed = parseReleaseTag(release.tag_name);
    if (!parsed) continue;
    const zip = findAsset(release, zipAssetName(parsed.name, parsed.version));
    const downloads = Number.isSafeInteger(zip?.download_count) ? zip.download_count : 0;
    counts.set(parsed.name, (counts.get(parsed.name) ?? 0) + downloads);
  }
  return counts;
}

function assetURL(release, assetName, label) {
  const asset = findAsset(release, assetName);
  if (!asset) throw new Error(`release ${release.tag_name} has no ${label} asset '${assetName}'`);
  return asset.browser_download_url;
}

// One index entry from a release and its metadata.json. Throws when the
// release and its metadata disagree, so a broken release is never listed.
export function indexEntry({ name, version, release, metadata, downloads, official }) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error(`release ${release.tag_name} has no readable ${METADATA_ASSET}`);
  }
  if (metadata.name !== name || metadata.version !== version) {
    throw new Error(
      `release ${release.tag_name} carries metadata for ${metadata.name}@${metadata.version}`,
    );
  }
  const zipName = zipAssetName(name, version);
  const zip = findAsset(release, zipName);
  if (!zip) throw new Error(`release ${release.tag_name} has no '${zipName}' asset`);
  if (zip.size !== metadata.size) {
    throw new Error(
      `release ${release.tag_name}: '${zipName}' is ${zip.size} bytes, metadata says ${metadata.size}`,
    );
  }
  if (typeof metadata.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(metadata.sha256)) {
    throw new Error(`release ${release.tag_name}: metadata sha256 is invalid`);
  }

  return {
    name,
    description: metadata.description ?? null,
    version,
    permissions: metadata.permissions ?? [],
    author: metadata.author ?? null,
    homepage: metadata.homepage ?? null,
    repository: metadata.repository ?? null,
    categories: metadata.categories ?? [],
    official,
    downloads,
    published_at: metadata.published_at ?? release.published_at ?? null,
    sha256: metadata.sha256,
    size: metadata.size,
    download_url: zip.browser_download_url,
    icon_url: metadata.icon ? assetURL(release, metadata.icon, "icon") : null,
    screenshot_urls: (metadata.screenshots ?? []).map((shot) =>
      assetURL(release, shot, "screenshot"),
    ),
  };
}

export function assembleIndex(entries) {
  const extensions = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return { schema: INDEX_SCHEMA, extensions };
}

export function serializeIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}
