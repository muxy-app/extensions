# Releasing GSD Control Tower

This guide prepares a reviewable Muxy marketplace contribution. It does not publish to npm or publish an extension to the Muxy store.

The canonical standalone source repository is `https://github.com/gabeosx/muxy-gsd-control-tower`. Keep the reviewed extension source at its repository root; the upstream marketplace fork is only a submission transport.

## Versioning

`package.json` is the version source. The root package version in `package-lock.json` must match it before release preparation starts.

Until 1.0, use patch releases for fixes, security, documentation, and listing corrections. Use minor releases for features, permission changes, newly supported workspace shapes, or breaking changes.

Published `gsd-control-tower@version` pairs are immutable. Never rebuild an existing marketplace version; issue the next patch or minor version. Repository tags use `gsd-control-tower-vX.Y.Z`.

## Prepare a release

1. Move relevant notes from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update `package.json` and the root package entry in `package-lock.json` together.
3. Review the frozen manifest, ordered listing assets, permissions, events, commands, entries, and README claims. No npm publish step or publishing lifecycle script is allowed.
4. From a clean source tree, run:

   ```sh
   npm ci
   npm test
   npm run build
   npm run validate
   npm audit --audit-level=high
   ```

5. Complete the native Muxy matrix on the exact build being submitted. Retain only the two sanitized marketplace screenshots; do not retain credentials, private planning content, local paths, receipts, or generated qualification data.

## Prepare the marketplace source

Start from a clean, tagged commit in `gabeosx/muxy-gsd-control-tower`. Use a partial sparse checkout of the authenticated `gabeosx/extensions` fork, based on current `muxy-app/extensions/main`, and copy that reviewed source to `extensions/gsd-control-tower`.

Retain `panel/`, `assets/`, `src/`, `scripts/`, `test/fixtures/`, reviewer-useful tests, `package.json`, `package-lock.json`, Vite configuration, documentation, `.gitignore`, and the nested `.github/workflows/ci.yml`. The nested workflow is review evidence only; GitHub does not activate it from below the repository-root workflow directory.

Exclude `.research/`, `.agents/`, `.planning/`, `.qualification/`, `.gsd/`, `skills-lock.json`, caches, `node_modules/`, `dist/`, `.DS_Store`, credentials, receipts, local logs, and generated qualification evidence.

From the copied extension run `npm ci`, `npm test`, `npm run build`, and `npm run validate`. From the upstream checkout root run:

```sh
node scripts/build.mjs gsd-control-tower
node scripts/validate.mjs gsd-control-tower
node scripts/pack.mjs --dry-run gsd-control-tower
```

Inspect the background-extension archive layout, size, and SHA-256 before review. Submission automation must stop with a local, unpushed commit unless the release owner separately authorizes a push or pull request.

## After upstream merge

Tag the exact reviewed source commit as `gsd-control-tower-vX.Y.Z`. Install the signed marketplace build in a clean Muxy profile, recheck permissions and the native smoke path, and record the result with the upstream review.

## Rollback

Do not rewrite a published package, tag, or marketplace version. If withdrawal is necessary, use Muxy's supported listing control, revert source on a new reviewed commit, and ship a corrective immutable version. Users can disable or uninstall the extension; uninstalling removes the integration and Muxy-managed extension storage but never modifies project files.
