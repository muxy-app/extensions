---
applyTo: "extensions/**"
excludeAgent: "cloud-agent"
---

# Muxy extension code review

Use these instructions only when reviewing a pull request that changes a Muxy
extension. Muxy extensions are npm and Vite projects under `extensions/<name>/`.
Their manifest is the `muxy` object in `package.json`, authored code normally
lives in `src/`, and the marketplace publishes only `dist/`.

Focus review feedback on the checks below. Report only concrete violations.
Keep each finding terse, identify the relevant check, explain the impact, and
suggest the smallest useful fix. Do not add generic praise or restate checks
that passed.

## Safe

- Reject destructive shell or filesystem operations, credential or private-data
  exfiltration, obfuscated behavior, and network requests to unexpected hosts.
- Inspect command construction and user-controlled input for injection risks.
- Enforce least privilege: every declared Muxy permission must be required by
  an API the extension actually uses, and every privileged API call must have
  its required permission.

## Quality

- Flag heavy or needless dependencies, dead or duplicated code, minified
  authored source, and hardcoded `~/.config/muxy` paths.
- Require a build script that produces `dist/` and copies `package.json` into
  it. Manifest entry points and marketplace assets must exist in `dist/`.
- Prefer the structured `window.muxy` APIs over shell commands for supported
  operations. Code must work in the active local or remote workspace instead
  of assuming paths or tools on the reviewer's computer.
- Require `package-lock.json` and readable source. Do not treat generated
  `dist/` bundles or lockfile churn as authored-code style problems.

## Design

- UI chrome colors must use `var(--muxy-*)`; do not allow hardcoded colors
  except for theme-independent decorative artwork or provider brand colors.
- Spacing, font sizes, icon sizes, control sizes, and radii must use the Muxy
  scale. Body text is 12px, UI icons are 12–14px at weight 600, and top bars use
  `--muxy-topbar-height`.
- Use `--muxy-accent` sparingly and use Muxy surface, border, hover, and diff
  variables for their intended roles.

## Version and listing

- A pull request may version only one extension. Its title must be
  `<extension-name> <version>`.
- For an existing extension, require a version bump. For a new extension,
  require a simple kebab-case directory and package name with no `muxy-` or
  `extension-` prefix.
- The directory name and top-level package name must match. Require a README,
  lockfile, valid manifest fields, a marketplace icon, and at least one
  marketplace screenshot.
- New or renamed marketplace screenshots must use `screenshot-1.png`,
  `screenshot-2.png`, and so on.
