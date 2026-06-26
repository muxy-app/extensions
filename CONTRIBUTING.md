# Publishing an extension

This repo is the publishing pipeline for Muxy extensions. This guide covers the
fork → validate → PR → publish flow.

> **Looking for the author guide?** How to actually *build* an extension — every
> manifest field, the `window.muxy` API, permissions, and theming — lives in the
> Muxy app repo under
> [`docs/extensions`](https://github.com/muxy-app/muxy/tree/main/docs/extensions),
> with a copyable example at
> [`examples/hello-world`](https://github.com/muxy-app/muxy/tree/main/docs/extensions/examples/hello-world)
> and the manifest schema at
> [`schema/manifest.schema.json`](https://github.com/muxy-app/muxy/blob/main/docs/extensions/schema/manifest.schema.json).

## 1. Fork and scaffold

Fork this repo, then create your extension under `extensions/`. The directory
name **must** equal `manifest.name` (letters, digits, dash, underscore, dot; no
leading dot).

> **Don't full-clone.** This repo holds every published extension and grows
> large over time. Use a partial + sparse checkout so you only download your own
> extension and the tooling:
>
> ```bash
> git clone --filter=blob:none --sparse https://github.com/muxy-app/extensions
> cd extensions
> git sparse-checkout set extensions/my-extension scripts
> ```

Start from the example in the Muxy app repo
([`examples/hello-world`](https://github.com/muxy-app/muxy/tree/main/docs/extensions/examples/hello-world)),
copy it into `extensions/my-extension/`, and set `manifest.name` to
`my-extension`.

Keep the `"$schema"` line at the top of `manifest.json` — it gives editors
autocomplete and inline validation against the schema in the Muxy app repo
([`muxy-app/muxy`](https://github.com/muxy-app/muxy/blob/main/docs/extensions/schema/manifest.schema.json)).
The Muxy app ignores it.

## 2. Build it

Follow the [author guide](https://github.com/muxy-app/muxy/tree/main/docs/extensions)
in the Muxy app repo. CI here enforces the same rules the app does.

### Rules CI enforces

- `manifest.json` matches the
  [manifest schema](https://github.com/muxy-app/muxy/blob/main/docs/extensions/schema/manifest.schema.json)
  in the Muxy app repo.
- Directory name equals `manifest.name`.
- Every referenced file (`background`, tab/panel/popover `entry`, command
  `script`, SVG icons) exists and stays inside your directory.
- Commands reference real `tabTypes` / `panels` / `popovers`; topbar and status
  bar items reference real commands.
- IDs and setting keys are unique.
- A `README.md` is present.
- A **`marketplace` block** is present with a **listing icon** and **at least one
  screenshot** (see §4) — both are required for the store listing.

### Advisory checks (surfaced to reviewers)

Use of `commands:exec`, network calls (`fetch`, `WebSocket`, …), `eval`, and
minified/obfuscated code are flagged for human review. Ship **readable source**
and declare only the permissions you actually use.

## 3. Validate locally

```bash
npm install
node scripts/validate.mjs my-extension     # one extension
node scripts/validate.mjs                   # all extensions
node scripts/pack.mjs --dry-run my-extension  # prove it zips + see its hash
```

Validation fetches the manifest schema from the `muxy-app/muxy` repo at runtime,
so you need network access the first time you run it.

## 4. Listing metadata, icon, and screenshots (required)

Every extension must carry a `marketplace` block in `manifest.json` with a
**listing icon** and **at least one screenshot**. CI rejects PRs without them.

```json
"marketplace": {
  "author": "Your Name",
  "github": "your-handle",
  "homepage": "https://example.com",
  "repository": "https://github.com/you/your-ext",
  "categories": ["git", "productivity"],
  "icon": "icon.svg",
  "screenshots": ["screenshots/screenshot-1.png", "screenshots/screenshot-2.png"]
}
```

This block is used only for the marketplace listing; the app loader ignores it.

### Icon — required

- **SVG (preferred)**, or a **square PNG at least 256×256**.
- Size limits: SVG ≤ 512 KB, PNG ≤ 1 MB.

### Screenshots — at least one required

- **PNG, exactly 1600×1000 (16:10)** — Muxy's window aspect.
- 1 to 6 screenshots, each ≤ 3 MB.

The icon and screenshots are uploaded to the marketplace alongside your signed
extension, each with its own SHA-256.

## 5. Write a good README

Each extension also needs a `README.md` with:

- A one or two sentence description.
- The permissions it uses and why.
- (Optional) an embedded screenshot/GIF for readers browsing the repo.

## 6. Open a pull request

Push your branch and open a PR. Fill in the PR template. CI runs validation; a
Muxy maintainer reviews for safety and quality, then merges. On merge, your
extension is packaged, hashed, signed into the index, and listed.

## Versioning

Published versions are **immutable**. To change an extension after it is merged,
bump `manifest.version` — the previous version's bytes and hash never change, so
already-installed users are never surprised.

## Updating an existing extension

Open a PR that bumps `version` and changes the files. The same review and
publish flow applies.

## Removing an extension

Open a PR deleting the `extensions/<name>/` directory, or file a
[report](.github/ISSUE_TEMPLATE/1-extension-issue.yml) if it is not yours and
should be taken down.
