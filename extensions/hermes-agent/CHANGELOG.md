# Changelog

All notable changes to Hermes Agent are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning while it is below 1.0.

## [Unreleased]

## [0.2.0] - 2026-10-18

### Added

- Muxy 2 Open Agent Panel command, alongside the existing toggle command.
- Cancellable Dashboard requests through Muxy `execAsync` when available, with the existing `exec` fallback.

### Fixed

- Board selection and card creation controls remain readable beside the Agent panel and in narrow tabs.
- Cancel pending and queued requests on logout, connection replacement, and surface teardown so late responses cannot restore a released session.
- Update the build dependency `source-map-js` to 1.2.2 to address GHSA-68fv-2mgg-jv7q.

## [0.1.0] - 2026-08-21

### Added

- Initial Hermes Agent marketplace beta for Muxy.
- Agent work, explicit approval controls, operations, and Kanban board surfaces.
- A deterministic marketplace package and supported-connection qualification harness.
