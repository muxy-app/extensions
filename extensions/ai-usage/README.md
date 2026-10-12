# AI Usage

Status bar and popover usage view for common AI coding providers.

## Permissions

- `commands:exec` reads local provider credentials and sends read-only usage requests through `/usr/bin/curl --config -`.
- `panels:write` resizes the popover and updates the status bar item icon and text.
- A background script restores the last cached status bar badge when Muxy reloads the extension and keeps refreshing every cached provider through the same collectors as the popover, so the badge stays current while the popover is closed.

## Network access

Live usage refreshes call provider quota endpoints for Antigravity, Claude Code, Codex, Amp, Copilot, Cursor, Devin, Factory, Grok, OpenRouter, OpenCode Go, Kimi, MiniMax, Z.ai, and Alibaba Token Plan. Requests send only the provider credential already present on the local machine plus the provider-required usage request body. Usage snapshots are cached in `~/Library/Application Support/muxy-ai-usage/status-cache.json` so the status bar can restore immediately after reload; nothing is written to the opened project folder.

## Providers

The extension reads existing local credentials for Antigravity, Claude Code, Codex, Amp, Copilot, Cursor, Devin, Factory, Grok, OpenRouter, OpenCode Go, Kimi, MiniMax, Z.ai, and Alibaba Token Plan.

OpenRouter, Z.ai, and MiniMax use API keys. When no key is found, the provider card shows an **Add API key** button with a masked input. Saved keys stay on this Mac only, in `~/Library/Application Support/muxy-ai-usage/api-keys.json` (folder `700`, file `600`), are written through stdin so they never appear in command arguments, and are sent only to that provider's usage endpoint. A saved key takes priority over environment variables and CLI config files, and can be changed or removed from the same card.

Alibaba Token Plan usage is only available through the Bailian console, so it reads the console access token from the active profile in `~/.bailian/config.json` (or `$BAILIAN_CONFIG_DIR/config.json`). Run `bl auth login --console` with the [Bailian CLI](https://github.com/modelstudioai/cli) first; Token Plan API keys (`sk-sp-…`) cannot read usage.

## Fixture

Append `?fixture=` with encoded JSON or set localStorage key `ai-usage.fixture` to JSON with a `providers` array. Each provider can include `id`, `name`, `icon`, `state`, `fetchedAt`, and `rows`.

## Build

```sh
npm install
npm run build
```
