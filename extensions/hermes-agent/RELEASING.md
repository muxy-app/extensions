# Releasing Hermes Agent

This guide prepares a reviewable Muxy marketplace contribution. It does not publish to npm or publish an extension to the Muxy store.

## Versioning

`package.json` is the version source. The root package version in `package-lock.json` must match it before release preparation starts.

Until 1.0, use patch releases for fixes, security, documentation, and listing corrections. Use minor releases for features, permission changes, newly supported deployment shapes, or breaking changes.

Published `hermes-agent@version` pairs are immutable. A correction never rebuilds an existing version: issue the next patch or minor version instead. Repository tags use `hermes-agent-vX.Y.Z`, because `v1.0` already names a project milestone.

## Prepare a release

1. Move the relevant notes from `Unreleased` into a dated version section in `CHANGELOG.md`.
2. Update the version in both `package.json` and the root package entry in `package-lock.json`.
3. Review the manifest, listing assets, permissions, and `README.md`; do not add a publishing lifecycle script.
4. Run the local gates from a clean working tree:

   ```sh
   npm ci
   npm test
   npm run validate
   npm run qualify
   ```

5. Retain the local output and qualification cleanup result with the review record. Do not retain credentials, disposable keys, or generated qualification data.

## Submit a draft marketplace pull request

Prepare a clean sparse checkout of the authenticated `gabeosx/extensions` fork. Copy only the reviewed extension source to `extensions/hermes-agent`; keep source fixtures and release documents that reviewers need.

Exclude `dist/`, `.planning/`, `.qualification/`, `.agents/`, `.gsd/`, `node_modules/`, receipts, credentials, generated qualification data, local caches/logs, and `skills-lock.json`. Retain the checked-in `fixtures/` data, `qualification/` harness, and `.github/workflows/ci.yml` because the submitted release tests and governance validator exercise them. The nested workflow remains review-only inside `extensions/hermes-agent`; GitHub does not activate workflows outside the repository-root `.github/workflows/` directory. `.qualification/` is the runtime evidence directory that must not cross the repository boundary.

From the copied extension, run:

```sh
npm ci
npm test
npm run build
```

From the upstream checkout root, run Muxy's authoritative package checks:

```sh
node scripts/validate.mjs hermes-agent
node scripts/pack.mjs --dry-run hermes-agent
```

Confirm the resulting artifact has the reviewed version, icon, README, and ordered listing images. Open a draft pull request for review. The current work stops at a draft pull request: no npm publish step, marketplace publication, merge, release, or tag is performed here.

## After upstream merge

Tag the exact reviewed source commit as `hermes-agent-vX.Y.Z`, then smoke-test the signed Muxy store build on a clean profile. Record the store build result with the upstream pull request.

## Rollback

Do not rewrite a published package, tag, or store version. If a release needs to be withdrawn, use the Muxy store's supported listing control if available, revert the source change on a new reviewed commit, and ship a corrective immutable version. Users can disable or uninstall the extension to remove its integration and saved extension data.
