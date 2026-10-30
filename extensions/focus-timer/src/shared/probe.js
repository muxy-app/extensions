// Parsers over the heartbeat probe's `@@`-delimited output. Pure and
// fixture-tested — if parsing fails the tick degrades exactly like a probe
// failure, never crashes the loop.

import { MUXY_BUNDLE_PREFIX } from "./consts.js";

// HB_V1 output:
//   <HIDIdleTime ns>\n@@\n<lsappinfo blob containing bundleID="…">
// Returns { idleNs, frontmost } with null for any section that failed.
export function parseProbe(stdout) {
  const result = { idleNs: null, frontmost: null };
  if (typeof stdout !== "string" || !stdout) return result;
  const at = stdout.indexOf("@@");
  const head = at >= 0 ? stdout.slice(0, at) : stdout;
  const tail = at >= 0 ? stdout.slice(at + 2) : "";

  const idleMatch = head.match(/\d+/);
  if (idleMatch) {
    const n = Number(idleMatch[0]);
    if (Number.isFinite(n) && n >= 0) result.idleNs = n;
  }

  // lsappinfo prints a multi-line record; the id is in `bundleID="com.…"`.
  const bundleMatch = tail.match(/bundleID="([^"]+)"/);
  if (bundleMatch) result.frontmost = bundleMatch[1];

  return result;
}

export function isMuxyFrontmost(bundleID) {
  return typeof bundleID === "string" && bundleID.startsWith(MUXY_BUNDLE_PREFIX);
}

// READ_V1 output: optional "@@LOCAL@@" line, then the state file (or nothing).
// Returns { local, state } — `state` is the parsed JSON or null.
export function parseStateRead(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  const local = text.includes("@@LOCAL@@");
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return { local, state: null };
  try {
    const state = JSON.parse(text.slice(jsonStart));
    return { local, state: state && typeof state === "object" ? state : null };
  } catch {
    return { local, state: null };
  }
}
