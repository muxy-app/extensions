// Presentation helpers for envelopes.

// A concise, locale-aware date label: time for today, "Mon 12" for this year,
// "Jan 2024" otherwise.
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// Best display label for a list of {email, name} addresses.
export function formatFrom(addresses) {
  const list = addresses || [];
  if (list.length === 0) return "(unknown sender)";
  const first = list[0];
  const label = first.name || first.email || "(unknown)";
  return list.length > 1 ? `${label} +${list.length - 1}` : label;
}

// Does the envelope carry the given IANA flag (e.g. "Seen", "Flagged")?
export function hasFlag(envelope, iana) {
  const flags = envelope?.flags || [];
  return flags.some((f) => f.iana === iana || f.raw === `\\${iana}`);
}
