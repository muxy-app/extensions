# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- No unreleased changes yet.

## [0.1.0] - 2026-08-23

### Added
- Control Tower panel with a ranked attention queue (waiting > blocked > unknown > stale > ready > working > idle), per-workstream detail, search + status/provider filters, diagnostics, and preferences.
- Panel now **opens inside the active project** by default (Preferences > Open on active project) and shows a per-project view: milestone progress, next action, blockers vs concerns, agent activity, git context, provenance.
- **Phase pipeline**: every phase from .planning/phases/ + ROADMAP with rollup status (Complete / In progress / Underway / Queued / Paused / Blocked) and stage chips - discuss / research / ui spec / patterns / plan / execute n/m / verify / review / security / validation; rows expand for goal and details.
- Breadcrumb navigation with explicit Back affordances on every non-list surface.
- GSD parsers: STATE.md (blockers-vs-concerns classification, freshest-timestamp activity), ROADMAP checklist + decimal phases, phase directories, VERIFICATION/HANDOFF/.continue-here/MILESTONES layouts.
- Status-bar attention item + background hub; palette commands and Cmd+Shift+G.

### Fixed
- Project detail view crashed on projects with evidence entries (spread of a number), leaving the panel blank with no way back; render is now fail-safe.
- Deferred concern notes under Blockers/Concerns no longer mark a workstream Blocked; only an explicit blocked status or failed verification does.
- Activity timestamps prefer full ISO last_updated over date-only values; undated evidence no longer resets staleness.
- Mid-flight workflows (executing/planning/...) no longer surface as Ready merely because a next action exists.

### Changed
- Agent activity is now explicitly labeled as covering **Muxy-hosted agents only**; external terminal CLIs (Codex CLI outside Muxy, DeepSeek Harness, plain Claude Code in Terminal) are invisible to Muxy's agent APIs, and the panel says so instead of showing an unexplained empty block.

### Security
- Read-first permission posture enforced by build validation; forbidden permissions fail the build.
- Release validation now freezes the marketplace surface, rejects secrets and personal paths, proves clean-copy deterministic builds, and requires zero high/critical dependency vulnerabilities.
