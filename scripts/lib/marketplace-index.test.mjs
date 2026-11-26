import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleIndex,
  downloadCounts,
  indexEntry,
  latestReleases,
  parseReleaseTag,
  serializeIndex,
} from "./marketplace-index.mjs";

const SHA = "a".repeat(64);
const DOWNLOAD = "https://github.com/muxy-app/extensions/releases/download";

function asset(tag, name, extra = {}) {
  return {
    name,
    size: 100,
    download_count: 0,
    browser_download_url: `${DOWNLOAD}/${encodeURIComponent(tag)}/${name}`,
    ...extra,
  };
}

function release(tag, { draft = false, prerelease = false, downloads = 0, assets } = {}) {
  const parsed = parseReleaseTag(tag);
  const zip = parsed ? `${parsed.name}-${parsed.version}.zip` : "other.zip";
  return {
    tag_name: tag,
    draft,
    prerelease,
    published_at: "2026-11-26T17:30:50Z",
    assets: assets ?? [
      asset(tag, zip, { download_count: downloads }),
      asset(tag, "metadata.json"),
      asset(tag, "icon.svg"),
      asset(tag, "screenshot-1.png"),
      asset(tag, "screenshot-2.png"),
    ],
  };
}

function metadata(name, version, extra = {}) {
  return {
    name,
    version,
    sha256: SHA,
    size: 100,
    description: "Desc",
    permissions: ["git:read"],
    author: { name: "Author", github: "author" },
    homepage: null,
    repository: "https://github.com/muxy-app/extensions",
    categories: ["git"],
    icon: "icon.svg",
    screenshots: ["screenshot-1.png", "screenshot-2.png"],
    published_at: "2026-11-26T17:30:50Z",
    ...extra,
  };
}

test("parseReleaseTag splits at the last @ and rejects foreign tags", () => {
  assert.deepEqual(parseReleaseTag("git@2.1.0"), { name: "git", version: "2.1.0" });
  assert.deepEqual(parseReleaseTag("my.ext-name@1.0.0-beta.1"), {
    name: "my.ext-name",
    version: "1.0.0-beta.1",
  });
  assert.equal(parseReleaseTag("a@b@1.0.0"), null);
  assert.equal(parseReleaseTag("v1.0.0"), null);
  assert.equal(parseReleaseTag("@1.0.0"), null);
  assert.equal(parseReleaseTag("git@latest"), null);
  assert.equal(parseReleaseTag("../git@1.0.0"), null);
  assert.equal(parseReleaseTag(null), null);
});

test("latestReleases picks the highest semver and skips drafts, prereleases and foreign tags", () => {
  const releases = [
    release("git@1.9.0"),
    release("git@1.10.0"),
    release("git@2.0.0", { draft: true }),
    release("git@3.0.0", { prerelease: true }),
    release("git@1.2.0"),
    release("files@0.1.0"),
    release("v9.9.9"),
  ];
  const latest = latestReleases(releases);
  assert.deepEqual(
    latest.map(({ name, version }) => `${name}@${version}`),
    ["files@0.1.0", "git@1.10.0"],
  );
  assert.equal(latest[1].release, releases[1]);
});

test("downloadCounts sums zip downloads across every release of a name only", () => {
  const counts = downloadCounts([
    release("git@1.0.0", { downloads: 10 }),
    release("git@1.1.0", {
      assets: [
        asset("git@1.1.0", "git-1.1.0.zip", { download_count: 5 }),
        asset("git@1.1.0", "metadata.json", { download_count: 1000 }),
        asset("git@1.1.0", "git-1.0.0.zip", { download_count: 1000 }),
      ],
    }),
    release("files@1.0.0", { downloads: 3 }),
  ]);
  assert.equal(counts.get("git"), 15);
  assert.equal(counts.get("files"), 3);
});

test("indexEntry points every URL at the release's own assets", () => {
  const tag = "git@2.1.0";
  const entry = indexEntry({
    name: "git",
    version: "2.1.0",
    release: release(tag),
    metadata: metadata("git", "2.1.0"),
    downloads: 42,
    official: true,
  });
  assert.equal(entry.download_url, `${DOWNLOAD}/git%402.1.0/git-2.1.0.zip`);
  assert.equal(entry.icon_url, `${DOWNLOAD}/git%402.1.0/icon.svg`);
  assert.deepEqual(entry.screenshot_urls, [
    `${DOWNLOAD}/git%402.1.0/screenshot-1.png`,
    `${DOWNLOAD}/git%402.1.0/screenshot-2.png`,
  ]);
  assert.equal(entry.sha256, SHA);
  assert.equal(entry.size, 100);
  assert.equal(entry.downloads, 42);
  assert.equal(entry.official, true);
  assert.deepEqual(entry.author, { name: "Author", github: "author" });
  assert.deepEqual(Object.keys(entry), [
    "name",
    "description",
    "version",
    "permissions",
    "author",
    "homepage",
    "repository",
    "categories",
    "official",
    "downloads",
    "published_at",
    "sha256",
    "size",
    "download_url",
    "icon_url",
    "screenshot_urls",
  ]);
});

test("indexEntry refuses a release whose assets disagree with its metadata", () => {
  const base = { name: "git", version: "2.1.0", downloads: 0, official: false };
  const tag = "git@2.1.0";
  assert.throws(() => indexEntry({ ...base, release: release(tag), metadata: null }));
  assert.throws(() =>
    indexEntry({ ...base, release: release(tag), metadata: metadata("git", "2.0.0") }),
  );
  assert.throws(() =>
    indexEntry({ ...base, release: release(tag), metadata: metadata("git", "2.1.0", { size: 99 }) }),
  );
  assert.throws(() =>
    indexEntry({ ...base, release: release(tag), metadata: metadata("git", "2.1.0", { sha256: "x" }) }),
  );
  assert.throws(() =>
    indexEntry({
      ...base,
      release: release(tag, { assets: [asset(tag, "metadata.json")] }),
      metadata: metadata("git", "2.1.0"),
    }),
  );
  assert.throws(() =>
    indexEntry({
      ...base,
      release: release(tag),
      metadata: metadata("git", "2.1.0", { screenshots: ["screenshot-3.png"] }),
    }),
  );
});

test("assembled index is sorted by name and byte-identical for the same input", () => {
  const entries = ["git", "database", "files"].map((name) =>
    indexEntry({
      name,
      version: "1.0.0",
      release: release(`${name}@1.0.0`),
      metadata: metadata(name, "1.0.0", { icon: null }),
      downloads: 0,
      official: false,
    }),
  );
  const index = assembleIndex(entries);
  assert.equal(index.schema, 1);
  assert.deepEqual(index.extensions.map((entry) => entry.name), ["database", "files", "git"]);
  assert.equal(index.extensions[0].icon_url, null);
  assert.equal(serializeIndex(index), serializeIndex(assembleIndex([...entries].reverse())));
});
