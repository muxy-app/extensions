# Ollama

Manage Ollama servers and launch coding agents against local models, without leaving Muxy.

The panel lists your Ollama servers with live status and model counts, lets you pick a
model, and launches any `ollama launch` integration (Claude Code, Codex, OpenCode, Cline,
Qwen Code, and the rest) in a **new terminal tab in the current project** with
`OLLAMA_HOST` pointed at the server you selected.

The launched command is exactly what you would type yourself:

```sh
OLLAMA_HOST='http://192.168.1.49:11434' ollama launch 'claude' --model 'qwen3.8-128k:latest'
```

## Requirements

- [`ollama`](https://ollama.com) on your `PATH` (`ollama launch` needs v0.12 or newer).
- At least one reachable Ollama server. A `Local` entry for `http://127.0.0.1:11434` is
  created the first time the panel opens.

## Using it

- **Toggle the panel** — ⌘⇧O, the topbar brain icon, or `Ollama: Toggle Panel` in the palette.
- **Add a server** — the `Add` button in the panel header, or `Ollama: Add Server…`. Enter a
  base URL (the scheme is optional, so `192.168.1.49:11434` works) and a display name.
- **Rename / remove** — the pencil and trash buttons on each server row.
- **Launch** — select a server, pick a model from the searchable list, choose an integration,
  then press **Launch in new terminal**. Anything typed in the extra-args field is passed
  through after a `--` separator, e.g. `--sandbox workspace-write`. The model you pick is
  remembered **per server**, so switching back to a server restores its last model.
- **Quick launch** — `Ollama: Launch Agent…` opens a single overlay where you choose the server,
  integration, model, and extra args together, with a live preview of the exact command that will
  run. Model suggestions are fetched live from the chosen server, but you can also type any model
  name. It launches with the panel's current selection as the default and remembers your pick for
  next time. Open the panel at least once first so the extension knows your servers.

The status bar shows how many servers are online (`2/3`) whenever at least one is reachable.

## Permissions and consent

| Permission | Why |
| --- | --- |
| `commands:exec` | `curl` the Ollama HTTP API and read `ollama launch --help` |
| `storage:read` / `storage:write` | Remember your server list and last selection |
| `tabs:write` | Open the agent in a new terminal tab |
| `notifications:write` | Report quick-launch results |
| `panels:write` | Keep the status bar indicator current |

Two runtime consent prompts appear the first time:

- **`curl`** — the status poll. Choose *Allow & remember* so polling does not prompt again.
- **Run a command in a terminal** — shown with the full command before every launch. Muxy
  remembers a granted command exactly, so a new model or integration prompts again. That is
  intentional: you always see the command that is about to run.

Choosing *Block all from this extension* permanently disables launching; clear it in
Settings → Extensions → Permissions.

## Notes

- Servers are polled every 10 seconds. If a server goes offline the last known model list is
  kept and marked *Showing last-known models*.
- Muxy blocks extension `http.fetch` to loopback and private addresses, so all Ollama API
  calls go through `muxy.exec(["curl", ...])`. That is why `commands:exec` is required.
- Values passed to the shell (server URL, integration, model) are single-quoted, so tags
  containing `:` or other punctuation are safe.

## Development

```sh
npm install
npm run build   # emits dist/ and copies package.json into it
npm test        # parser + launch-command unit tests
```

Load the checkout with **Load Unpacked** in Settings → Extensions, then press **Reload**
after each rebuild.
