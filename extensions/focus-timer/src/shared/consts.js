// ── Consent contract ────────────────────────────────────────────────────────
// Shell-form exec consent is remembered by EXACT string (shellExact). These
// three commands are frozen, versioned constants — never edit casually.
// Changing a single byte re-prompts every user on upgrade: bump to _V2 and
// note it in the release notes instead.
//
// HB_V1 — the heartbeat probe. Read-only: HID idle nanoseconds + the
// frontmost app's bundle id. `lsappinfo` is a macOS built-in that needs no
// TCC prompt; its output is a multi-line blob parsed by probe.js.
export const HB_V1 =
  "ioreg -c IOHIDSystem -d 4 | awk '/HIDIdleTime/ {print $NF; exit}'; " +
  "echo @@; lsappinfo info -only bundleid $(lsappinfo front)";

// READ_V1 / WRITE_V1 — the local state file (background scripts have no
// muxy.storage; see README). Both embed a locality guard: `lsappinfo front`
// only succeeds in a local GUI session, so a probe or flush that lands on a
// remote (SSH) workspace refuses to touch that host's filesystem.
// The read prints @@LOCAL@@ first when local, then the file (or nothing).
export const READ_V1 =
  'lsappinfo front >/dev/null 2>&1 && echo "@@LOCAL@@"; ' +
  'cat "$HOME/Library/Application Support/muxy-focus-timer/state.json" 2>/dev/null; exit 0';

// The write takes the JSON on stdin (stdin is not part of the consent
// pattern) and lands it atomically via tmp + mv. Exit 90 = not a local GUI
// session — the caller holds the data and retries later.
export const WRITE_V1 =
  'lsappinfo front >/dev/null 2>&1 || exit 90; ' +
  'FT="$HOME/Library/Application Support/muxy-focus-timer"; ' +
  'mkdir -p "$FT" && cat > "$FT/state.json.tmp" && mv -f "$FT/state.json.tmp" "$FT/state.json"';

// ── Cadence ─────────────────────────────────────────────────────────────────
export const HB_INTERVAL_MS = 30_000; // heartbeat period
export const SLEEP_GAP_MS = 3 * HB_INTERVAL_MS; // beat gap → machine slept
export const FLUSH_INTERVAL_MS = 60_000; // periodic persistence
export const FLUSH_MIN_GAP_MS = 15_000; // throttle for close-triggered flushes
export const DENIED_RETRY_MS = 10 * 60_000; // consent denied → recheck cadence
export const FAILURE_BACKOFF_MS = 60_000; // 3 probe failures → back off
export const POPOVER_TTL_MS = 30_000; // hello/keepalive freshness window
export const KEEP_DAYS = 400; // rollup retention
export const POMOLOG_MAX = 200; // pomodoro history ring buffer
export const SILENT_EXPIRY_MS = 90_000; // phase ended this long ago → no alarm

// Muxy's bundle id is com.muxy.app; match the prefix so beta builds count.
export const MUXY_BUNDLE_PREFIX = "com.muxy.";

export const STATE_FILE_VERSION = 1;
