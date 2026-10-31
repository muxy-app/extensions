export const LOG_FORMAT = "%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1f%D%x1e";

export function refKind(kind, name) {
  const k = String(kind ?? "").toLowerCase();
  if (k.includes("tag")) return "tag";
  if (k.includes("remote")) return "remote";
  if (k === "head" || name === "HEAD") return "head";
  return "branch";
}

function normalizeRef(ref) {
  if (typeof ref === "string") return { name: ref, kind: refKind("", ref) };
  const name = String(ref?.name ?? "");
  return { name, kind: refKind(ref?.kind, name) };
}

export function normalizeCommit(raw) {
  return {
    hash: String(raw.hash ?? ""),
    shortHash: String(raw.shortHash ?? String(raw.hash ?? "").slice(0, 7)),
    subject: String(raw.subject ?? ""),
    authorName: String(raw.authorName ?? ""),
    authorDate: String(raw.authorDate ?? ""),
    parents: Array.isArray(raw.parentHashes) ? raw.parentHashes.map(String) : [],
    refs: (raw.refs ?? []).map(normalizeRef).filter((ref) => ref.name && ref.name !== "HEAD"),
  };
}

function parseDecorations(text) {
  const refs = [];
  for (const piece of String(text ?? "").split(",")) {
    const value = piece.trim();
    if (!value) continue;
    if (value.startsWith("HEAD -> ")) refs.push({ name: value.slice(8), kind: "branch" });
    else if (value === "HEAD") continue;
    else if (value.startsWith("tag: ")) refs.push({ name: value.slice(5), kind: "tag" });
    else if (value.includes("/")) refs.push({ name: value, kind: value.endsWith("/HEAD") ? "skip" : "remote" });
    else refs.push({ name: value, kind: "branch" });
  }
  return refs.filter((ref) => ref.kind !== "skip");
}

export function parseLog(text) {
  const commits = [];
  for (const record of String(text ?? "").split("\x1e")) {
    const line = record.replace(/^\n+/, "");
    if (!line) continue;
    const [hash, shortHash, subject, authorName, authorDate, parents, decorations] = line.split("\x1f");
    if (!hash) continue;
    commits.push({
      hash,
      shortHash,
      subject: subject ?? "",
      authorName: authorName ?? "",
      authorDate: authorDate ?? "",
      parents: (parents ?? "").split(" ").filter(Boolean),
      refs: parseDecorations(decorations),
    });
  }
  return commits;
}

export function parseCommitDetails(text) {
  const [hash, shortHash, authorName, authorEmail, authorDate, parents, ...body] = String(text ?? "").split("\x00");
  const message = body.join("\x00").replace(/\s+$/, "");
  const newline = message.indexOf("\n");
  return {
    hash: hash ?? "",
    shortHash: shortHash ?? "",
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    authorDate: authorDate ?? "",
    parents: (parents ?? "").split(" ").filter(Boolean),
    subject: newline === -1 ? message : message.slice(0, newline),
    body: newline === -1 ? "" : message.slice(newline + 1).trim(),
  };
}

export function parseStashList(text) {
  return String(text ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, subject, when] = line.split("\x1f");
      return { ref, subject: subject ?? "", when: when ?? "" };
    })
    .filter((entry) => entry.ref);
}
