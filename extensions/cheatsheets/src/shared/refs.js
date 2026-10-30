// A ref identifies one page: { source: 'tldr'|'man', name, section?, platform?, lang? }.
// String ids (used as modal row ids) have three colon-separated fields:
// source : qualifier : name — the qualifier is the man section or the tldr
// platform. The name is everything after the second colon, so names containing
// ':' (real tldr pages exist for '!', '((', etc.) round-trip.

export function refToId(ref) {
  const qualifier = ref.source === "man" ? ref.section : ref.platform;
  return `${ref.source}:${qualifier ?? ""}:${ref.name}`;
}

export function refFromId(id) {
  const first = id.indexOf(":");
  const second = id.indexOf(":", first + 1);
  if (first < 0 || second < 0) return null;
  const source = id.slice(0, first);
  const qualifier = id.slice(first + 1, second);
  const name = id.slice(second + 1);
  if ((source !== "tldr" && source !== "man") || !name) return null;
  const ref = { source, name };
  if (qualifier) ref[source === "man" ? "section" : "platform"] = qualifier;
  return ref;
}

// Display title for a ref: 'tar' or 'open(2)'.
export function refTitle(ref) {
  return ref.source === "man" && ref.section ? `${ref.name}(${ref.section})` : ref.name;
}

export function sameRef(a, b) {
  return !!a && !!b && a.source === b.source && a.name === b.name &&
    (a.section ?? "") === (b.section ?? "");
}

// A page name is passed to exec as a standalone argv element after '--', so
// shell metacharacters are harmless; reject only strings that could not be a
// page name at all (empty, embedded whitespace/control characters).
export function validName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 128 &&
    !/[\s\x00-\x1f\x7f]/.test(name);
}

export function validSection(section) {
  return typeof section === "string" && /^[0-9ln][a-zA-Z0-9]{0,8}$/.test(section);
}
