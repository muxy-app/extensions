/** Sanitize untrusted transcript titles for UI display. */
export function oneLine(value, limit = 120) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "\uFFFD")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 3)) + "...";
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Copilot may use shorter hex prefixes; allow alnum/hyphen session ids. */
const SESSION_ID_RE = /^[0-9a-zA-Z][0-9a-zA-Z._-]{5,128}$/;
/** Copilot UI/draft placeholders — never pass to --resume. */
const COPILOT_STUB_PREFIXES = ["optimistic-chat-", "pending-session"];

export function isCopilotStubId(id) {
  if (typeof id !== "string" || !id) return true;
  const lower = id.toLowerCase();
  return COPILOT_STUB_PREFIXES.some((p) => lower.startsWith(p));
}

export function isSafeSessionId(id) {
  if (typeof id !== "string" || !id) return false;
  if (isCopilotStubId(id)) return false;
  if (UUID_RE.test(id)) return true;
  return SESSION_ID_RE.test(id) && !/[\s;'"`$|<>]/.test(id);
}
