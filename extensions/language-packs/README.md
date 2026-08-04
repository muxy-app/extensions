# Language Packs

A [Muxy](https://muxy.app) localization extension that adds community-contributed app languages via **Settings → Interface → Language**.

One extension, one `localizations` entry per language — anyone can add a new language by adding a bundle folder and one manifest entry, no code required.

## Languages

| Language | id | Bundle |
| --- | --- | --- |
| 한국어 (Korean) | `ko` | `localization/Korean.bundle` |
| Português (Brasil) | `pt-BR` | `localization/BrazilianPortuguese.bundle` |
| فارسی (Persian) | `fa` | `localization/Persian.bundle` |

## Permissions

None. This extension only ships resource-only localization bundles — no code runs.

## How it works

Each language is a resource-only Apple `.bundle` under `localization/`, containing `<language>.lproj/Localizable.strings` translated from Muxy's English source (`Muxy/Resources/Localization/en.lproj/Localizable.strings`). Missing keys fall back to English automatically. Format placeholders (`%@`, `%lld`, etc.) are kept in the same position and type as the English source — see [`docs/extensions/localizations.md`](https://github.com/muxy-app/muxy/blob/main/docs/extensions/localizations.md) in the Muxy app repo for the exact rules.

## Adding a new language

1. Add `localization/<Language>.bundle/<lang>.lproj/Localizable.strings` (and optionally `Localizable.stringsdict`), plus a minimal `Info.plist` with no `CFBundleExecutable`.
2. Translate every key from the English source, keeping format placeholders identical in position and type.
3. Add one entry to `muxy.localizations` in `package.json`:
   ```json
   {
     "id": "<lang>",
     "language": "<lang>",
     "title": "<Language name in that language>",
     "bundle": "localization/<Language>.bundle"
   }
   ```
4. Add a row to the table above.
