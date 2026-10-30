# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-18

### Added

- Muxy 2.x worktree targeting: registered child worktrees now have their own planning snapshots, branches, changed-file counts, and last commits. Primary worktree reads verify the repository root and show an explicit unavailable state when Muxy routes the selector to a child.
- **Control Tower: Open Panel** uses Muxy 2's `openPanel` action to show the panel without toggling it closed.
- Reusable Harbor Notes demo generator with active, paused, and failed-verification worktrees, plus a presentation walkthrough.

### Changed

- Refreshed the manifest schema and moved `$schema` to the package root for editor validation.
- Worktree and project switches refresh inventory; child-worktree file events resolve to the correct parent project.
- Updated marketplace and README screenshots from the local Muxy 2.1 demo.

### Fixed

- Preference switches, expanded phases, and selected rows now expose the correct boolean state to CSS and assistive technology.
- Planning edits now schedule a reparse through the shared path helper, including Muxy 2 watcher rescan events.
- Updated vulnerable build-only `fast-uri` and `source-map-js` dependencies.
- Removed planning snapshots are cleared instead of retaining stale phase details.
- Changed-file counts count paths once when a file has both staged and unstaged edits.
- Returning focus to the All projects view focuses its search field.

## [0.2.0] - 2026-08-27

### Added

- Established `gabeosx/muxy-gsd-control-tower` as the project repository.
- Rewrote the README around the current-project and All projects workflows.
- Replaced synthetic listing artwork with genuine, sanitized native Muxy captures.
- Tightened the marketplace description to the extension's actual read-only scope.

### Changed

- Simplified the panel and documentation around project progress, agent activity, permissions, and limitations.
- Shows one alphabetical workstream list without Control Tower-derived priority or status signals.
- Added a configurable cross-project planning/Git refresh interval (Manual, 1, 5, 15, or 30 minutes; 5 minutes by default). Agent status remains event-driven.
- Raw GSD status text remains display-only; runtime, verification, next action, and parser errors remain separate recorded fields.
- Phase rows now show optional workflow artifacts only when present and expanded; missing stages are never treated as incomplete.
- Phase directories that contain artifacts but are not selected by `STATE.md` now show **Not current** instead of a blank status.
- Progress display now uses roadmap checkboxes or declared phase counts instead of raw percentages.
- Agent activity is now a disclosure that follows live activity until the user explicitly expands or collapses it.
- The panel now hides its pin control so its declared pinned mode remains stable.

### Fixed

- Recognizes plan, verification, and optional workflow artifacts whose filenames use decimal phase prefixes such as `04.1`.

## [0.1.0] - 2026-08-23

### Added
- Control Tower panel with project details, search, diagnostics, and preferences.
- Panel opens inside the active project by default and shows milestone progress, next action, planning notes, agent activity, repository context, and source files.
- **Phase evidence view**: phases from `.planning/phases/` and ROADMAP with explicit Current / Planned / Complete / Paused / Verification failed labels; optional artifact chips appear only in expanded rows.
- Breadcrumb navigation with explicit Back affordances on every non-list surface.
- GSD parsers: STATE.md (display-only Blockers/Concerns notes, freshest-timestamp activity), ROADMAP checklist + decimal phases, phase directories, VERIFICATION/HANDOFF/.continue-here/MILESTONES layouts.
- Static status-bar launcher, palette commands, and Cmd+Shift+G.

### Fixed
- Fixed a blank project detail view when planning sources were present.
- Blockers/Concerns prose and raw STATE status text are never interpreted as priority or completion.
- Activity timestamps prefer full ISO `last_updated` over date-only values; undated evidence is never shown as a file-change time.
- Next-action and completion displays use structured next actions, phase checklists, and counts instead of status words.

### Changed
- Agent activity now clearly indicates when no session is active in Muxy.

### Security
- Build validation enforces the extension's permission policy.
- Automated release checks cover credentials, private paths, vulnerable dependencies, and reproducible builds.
