// {{variable}} substitution. Values come from the globals and the active
// environment; names starting with $ are generated on every send.
import { esc } from "./ui.js";

export const VAR_RE = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

export const DYNAMIC = {
  $guid: "A random UUID",
  $uuid: "A random UUID",
  $timestamp: "Unix time in seconds",
  $isoTimestamp: "The current time, ISO 8601",
  $randomInt: "A random integer from 0 to 999",
};

function uuid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function dynamicValue(name) {
  switch (name) {
    case "$guid":
    case "$uuid":
      return uuid();
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomInt":
      return String(Math.floor(Math.random() * 1000));
    default:
      return undefined;
  }
}

export function isKnown(name, vars) {
  return vars.has(name) || name in DYNAMIC;
}

export function resolve(text, vars, depth = 0) {
  const s = String(text ?? "");
  if (!s.includes("{{")) return s;
  return s.replace(VAR_RE, (m, name) => {
    if (name.startsWith("$")) {
      const v = dynamicValue(name);
      if (v !== undefined) return v;
    }
    if (vars.has(name)) return depth < 5 ? resolve(vars.get(name), vars, depth + 1) : vars.get(name);
    return m;
  });
}

export function usedVars(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(VAR_RE)) out.push(m[1]);
  return out;
}

export function unresolved(texts, vars) {
  const missing = new Set();
  for (const t of texts) for (const name of usedVars(t)) if (!isKnown(name, vars)) missing.add(name);
  return [...missing];
}

// HTML for a line of text with variables marked. `escapeFn` lets callers
// highlight the rest of the text themselves.
export function markVars(text, vars, escapeFn = esc) {
  const s = String(text ?? "");
  let out = "";
  let last = 0;
  for (const m of s.matchAll(VAR_RE)) {
    out += escapeFn(s.slice(last, m.index));
    out += `<span class="var ${isKnown(m[1], vars) ? "known" : "unknown"}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeFn(s.slice(last));
}
