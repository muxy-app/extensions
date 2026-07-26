# AI Usage

Status bar and popover usage view for common AI coding providers.

## Permissions

- `commands:exec` reads local provider credentials and sends read-only usage requests through `/usr/bin/curl --config -`.
- `panels:write` resizes the popover and updates the status bar item icon and text.
- A background script restores the last cached status bar badge when Muxy reloads the extension.

## Network access

Live usage refreshes call provider quota endpoints for Antigravity, Claude Code, Codex, Amp, Copilot, Cursor, Devin, Factory, Grok, OpenRouter, OpenCode Go, Kimi, MiniMax, and Z.ai. Requests send only the provider credential already present on the local machine plus the provider-required usage request body. Usage snapshots are cached locally in the extension folder so the status bar can restore immediately after reload.

## Providers

The extension reads existing local credentials for Antigravity, Claude Code, Codex, Amp, Copilot, Cursor, Devin, Factory, Grok, OpenRouter, OpenCode Go, Kimi, MiniMax, and Z.ai.

## Fixture

Append `?fixture=` with encoded JSON or set localStorage key `ai-usage.fixture` to JSON with a `providers` array. Each provider can include `id`, `name`, `icon`, `state`, `fetchedAt`, and `rows`.

## Build

```sh
npm install
npm run build
```
