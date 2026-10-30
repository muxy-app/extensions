# System Monitor

CPU, memory, network, battery and disk in the Muxy status bar, with a popover
for the details: sparklines, memory breakdown, top processes. Zero-config,
always-on, and cheap: one shell snapshot every few seconds, no daemons, no
sudo. Pairs well with [`ports`](https://github.com/muxy-app/extensions/tree/main/extensions/ports)
for the "what's listening" half of the picture.

## Exactly three commands

The extension runs **three read-only shell commands**, and only these — each
one shows up verbatim in Muxy's consent prompt on first run (the first
command was bumped from V1 to V2 pre-release, when the GPU `ioreg` block was
added — consent is remembered per exact string, so a bump re-prompts once):

```
uname -s; echo @@; top -l 1 -n 0 -s 0; echo @@; vm_stat; echo @@; sysctl -n hw.pagesize hw.memsize vm.loadavg vm.swapusage; echo @@; netstat -ibn; echo @@; ioreg -r -d 1 -w 0 -c IOAccelerator
```

```
pmset -g batt; echo @@; df -kP /
```

```
ps -Areo pid,pcpu,pmem,rss,comm -r | head -40
```

The first (CPU/memory/network) runs every 3 s by default, the second
(battery/disk) every 45 s, and the third (top processes) only while the
popover is open. Approve each prompt with **Allow & remember** and you will
never be asked again — consent is remembered for the exact command string,
which is why these are frozen, versioned constants in the source. If you deny
one, that metric degrades gracefully (the status bar shows `⚠`) and the
extension retries at most once every 10 minutes.

## Permissions

- `commands:exec` — the three read-only snapshots above, nothing else.
- `panels:write` — status-bar text updates and popover resizing.
- `notifications:write` — optional (off by default) threshold alerts.
- `storage:read` / `storage:write` — your settings, the one-time first-run
  note, and a once-a-minute snapshot so the popover has data right after a
  restart. All three are written by the popover: Muxy's background host has no
  `muxy.storage`, so anything that must persist lives on the webview side.

## Honest numbers

- **Memory** follows Activity Monitor's math: *used* = app memory
  (anonymous − purgeable pages) + wired + compressed, from `vm_stat` ×
  `hw.pagesize` (never hardcoded — 4 K on Intel, 16 K on Apple Silicon).
  It tracks Activity Monitor's "Memory Used" closely, not exactly.
- **CPU** comes from a single `top -l 1` sample, an instantaneous
  approximation — approximate by design; it's a glanceable meter, not a
  profiler.
- **GPU** is the accelerator's "Device Utilization %" from
  `ioreg -c IOAccelerator` (no root needed) — the busiest GPU on multi-GPU
  machines. The section hides itself when the driver publishes no
  utilization figure.
- **Network** is Δbytes/Δtime across all physical interfaces (`lo0`
  excluded). The first sample after sleep/wake or a counter reset is dropped
  rather than shown wrong.
- **Disk** is the root filesystem, with used = size − available, since APFS
  containers make per-volume "used" numbers misleading.

## No temperatures?

Temperature and fan readings on macOS require `powermetrics`, which needs
root. This extension will not ask for sudo, so they're out of scope. If that
ever changes upstream, it'll be a new versioned snapshot command.

## Status bar

The text is template-driven — configure it in the settings window (⚙ in the
popover, or the "System Monitor: Settings" palette command). The settings
window also controls which sections the popover shows (CPU, GPU, memory,
network, power, disk, top processes).
Tokens: `{cpu}` `{gpu}` `{mem}` `{memPct}` `{down}` `{up}` `{batt}` `{load1}`.
Default: `CPU {cpu} · {mem}`.

The icon switches to a warning triangle when CPU stays above 90 % for three
samples, memory used exceeds 90 %, or the disk passes 92 % — thresholds are
configurable, and optional notifications fire at most once per 15 minutes per
metric.

When the active workspace is remote (SSH), sampling pauses (the snapshot
would run on the remote host) and the status bar shows `—` until a local
workspace is active.

## Development

```bash
npm install
npm run build   # vite build + background bundle + manifest copy → dist/
npm test        # parser unit tests against canned fixtures
```

After rebuilding, click **Reload** in the Muxy Extensions modal. Source
layout:

- `src/background.mjs` — ticks, consent handling, status bar, popover
  protocol; bundled to `dist/background.js`.
- `src/parsers.mjs` — pure functions over the `@@`-delimited snapshot blobs;
  tested in `test/` against fixtures captured from real machines
  (Apple Silicon and Intel, AC/battery/no-battery, remote Linux).
- `popover/` + `src/popover/` — the popover UI (vanilla JS, themed with
  `--muxy-*` variables).

Before publishing (see [contributing](https://muxy.app/docs/extensions/contributing)):
fill in `marketplace.author` / `marketplace.github` in `package.json` and add
a 1600×1000 screenshot at `public/assets/screenshots/1.png`.
