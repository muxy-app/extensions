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

Retain `panel/`, `assets/`, `src/`, `scripts/`, `demo/`, `test/fixtures/`, reviewer-useful tests, `package.json`, `package-lock.json`, Vite configuration, documentation, `.gitignore`, and the nested `.github/workflows/ci.yml`. The nested workflow is review evidence only; GitHub does not activate it from below the repository-root workflow directory.

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

## Muxy 2.x compatibility decisions

The 2.x [API reference](https://muxy.app/docs/2.x/extensions/api), [Files](https://muxy.app/docs/2.x/extensions/files), and [Git](https://muxy.app/docs/2.x/extensions/git) document project/worktree ID selectors. Version 0.3.0 uses each registered worktree's ID for both planning and Git reads, while respecting the fact that parent selectors still follow the preferred active worktree. Inventory still comes from top-level projects and their registered children. The root worktree also has a project ID in Muxy 2, but that selector resolves to its preferred child. Native testing confirmed this; the official `extension_project` implementation in `crates/muxy-app/src/model/extensions/mod.rs` calls `preferred_worktree` for parents. Primary reads are guarded by `git.repoInfo().root` before and after loading. A mismatch clears the primary snapshot and shows an explicit unavailable row; fixed child IDs continue to load independently. No project switches or broader permissions are used to work around it.

The new [openPanel action](https://muxy.app/docs/2.x/extensions/commands) provides a palette command that always shows the panel. Existing toggle behavior remains available. Search uses the page focus callback. These changes require no additional permissions.

Other features were reviewed and deferred: `homeViews` and `remoteMethods` are accepted legacy fields but do nothing in Muxy 2; declared Settings values cannot yet be read at runtime, so preferences stay in extension storage. Background processing, shell execution, notifications, project mutations, and Git writes do not serve this read-only panel. The optional marketplace shared UI package would duplicate the existing token-based stylesheet without fixing a compatibility issue. Remote server APIs are documented, but connected remote servers and Linux remain unqualified.

The current official manifest schema is vendored at `scripts/manifest.schema.json`. Release validation checks the 0.3.0 manifest and reproducible distributions against it. The public Harbor Notes generator and walkthrough are the repeatable local demo; generated repositories and native qualification data stay outside the source and distribution.

Muxy [2.2.0 release notes](https://github.com/muxy-app/muxy/releases/tag/v2.2.0) were also reviewed: the integrated browser, Linux desktop, native agent panel, new `omp` provider, SSH commands, and terminal preferences do not require new authority in Control Tower. Provider names are already handled as strings. The local app used for this release is 2.1.0; 2.2.0, Linux, and remote servers are not claimed as native-tested.

### 0.3.0 local qualification (2026-10-18)

Native checks on Muxy 2.1.0 passed with the Harbor Notes demo: unpacked loading and enablement, palette open/toggle behavior, repeated `openPanel` leaving the panel open, independent child planning and Git reads, primary selector mismatch and recovery, paused handoff and failed verification, expanded phase artifacts, search, project exclusion/reinclusion, manual/5-minute preference persistence across panel recreation, live planning-file edits, branch-change events, and diagnostics. File changes and temporary branch changes were restored after testing. The demo remains registered for reuse. Agent event routing is covered by automated tests and the native `agents.list` capability worked; no paid agent session was launched to manufacture activity.

The two marketplace images and two README images use direct native panel crops from the sanitized demo. `artwork/render-listing-assets.py` composes the public graphics; it never redraws application content. Raw native captures and generated Git repositories are not shipped.
