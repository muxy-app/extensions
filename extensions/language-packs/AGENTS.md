# Language Packs

These instructions apply to every change under `extensions/language-packs/`.

## Source Of Truth

- Always translate from the latest English catalog in
  [`muxy-app/muxy`](https://github.com/muxy-app/muxy/blob/main/Muxy/Resources/Localization/en.lproj/Localizable.strings).
- Fetch a fresh copy before starting. Never use another translation as the source and never assume an existing catalog has every current key.
- Record the Muxy source commit used in the pull request so reviewers can reproduce the catalog.
- A new catalog should contain every English source key exactly once and in the same order. Translate only the value on the right side of `=`.

Fetch and pin the current source instead of copying it from a local checkout:

```bash
SOURCE_COMMIT="$(git ls-remote https://github.com/muxy-app/muxy.git refs/heads/main | cut -f1)"
curl -fsSL "https://raw.githubusercontent.com/muxy-app/muxy/${SOURCE_COMMIT}/Muxy/Resources/Localization/en.lproj/Localizable.strings" \
  -o "/tmp/Muxy-Localizable.strings"
```

## Adding A Language

1. Choose the canonical BCP 47 language tag, such as `de`, `fr`, or `pt-BR`, and the language's native display name.
2. Create `localization/<EnglishLanguageName>.bundle/<tag>.lproj/Localizable.strings` from the current English catalog.
3. Add `localization/<EnglishLanguageName>.bundle/Info.plist` with:
   - A unique, lowercase `CFBundleIdentifier` following `app.muxy.language-packs.<tag>`.
   - `CFBundleDevelopmentRegion` set to the exact BCP 47 tag.
   - No `CFBundleExecutable`; localization bundles must remain resource-only.
4. Add one entry to `muxy.localizations` in `package.json`. The `id`, `language`, `.lproj` directory, development region, and regional casing must agree exactly. Point `bundle` at the new bundle directory and use the native display name for `title`.
5. Add the language to the table in `README.md`.
6. Increment the package patch version in both `package.json` and `package-lock.json`. Published versions are immutable.

Follow the existing naming pattern: English PascalCase bundle directory names, canonical BCP 47 tags for provider IDs and `.lproj` directories, and lowercase tags in bundle identifiers.

## Translation Rules

- Keep keys byte-for-byte identical to the English source. Do not translate, normalize, reorder, add, or remove keys.
- Preserve format argument positions and types. Never change `%@` to a numeric or C-string placeholder, add arguments, or turn `%%` into a placeholder.
- Use positional placeholders such as `%1$@` and `%2$lld` when grammar requires argument reordering.
- Preserve required escapes, including `\"`, `\n`, and literal percent signs.
- Keep product names, commands, file paths, URLs, code, and technical identifiers unchanged unless the source text clearly treats them as ordinary prose.
- Use natural terminology consistently across the whole catalog. Do not submit raw machine translation as finished work; AI-assisted catalogs require fluent-speaker review.
- For right-to-left languages, review punctuation, placeholders, paths, and mixed-direction technical text in the running interface.

Muxy rejects a localization bundle when a translated format string could read arguments with incompatible types. The complete rules are documented in
[`docs/extensions/localizations.md`](https://github.com/muxy-app/muxy/blob/main/docs/extensions/localizations.md).

## Validation

Run plist checks for the new bundle on macOS:

```bash
plutil -lint extensions/language-packs/localization/<EnglishLanguageName>.bundle/Info.plist
plutil -lint extensions/language-packs/localization/<EnglishLanguageName>.bundle/<tag>.lproj/Localizable.strings
```

From the repository root, run the complete package checks:

```bash
npm ci --ignore-scripts
node scripts/build.mjs language-packs
node scripts/validate.mjs language-packs
node scripts/pack.mjs --dry-run language-packs
git diff --check
```

Inspect `extensions/language-packs/dist/` only to verify the built package. Do not commit generated `dist/` or `node_modules/` directories.

Before finishing, verify all of the following:

- The translated catalog parses and has the same complete key set as the pinned English source.
- Every manifest path and language tag matches the bundle on disk exactly.
- `Info.plist` has no executable declaration.
- The extension still has no permissions or executable localization code.
- A fluent speaker reviewed wording, consistency, truncation-prone labels, and format substitutions.
- The pull request changes only `language-packs` and is titled `language-packs <version>`.
