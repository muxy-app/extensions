import { baseName, dirName } from "@/shared/paths";

const CONFLICT_CODES = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);

export function fileCode(status, staged) {
  const raw = String(status ?? "").trim().toUpperCase();
  if (raw === "?" || raw === "??") return "U";
  if (CONFLICT_CODES.has(raw)) return "!";
  if (raw.length === 2) {
    const letter = staged ? raw[0] : raw[1];
    return letter && letter !== " " && letter !== "." ? letter : raw.replace(/[ .]/g, "")[0] || "M";
  }
  if (raw === "U") return "!";
  return raw.charAt(0) || "M";
}

export function makeEntry({ path, oldPath = null, code, additions = null, deletions = null, binary = false }) {
  return {
    path,
    oldPath: oldPath && oldPath !== path ? oldPath : null,
    code,
    name: baseName(path),
    dir: dirName(path),
    additions: Number.isFinite(additions) ? additions : null,
    deletions: Number.isFinite(deletions) ? deletions : null,
    binary: !!binary,
  };
}

function fromApiFile(file, staged) {
  return makeEntry({
    path: String(file.path ?? ""),
    oldPath: file.oldPath ?? null,
    code: fileCode(file.status, staged),
    additions: file.additions,
    deletions: file.deletions,
    binary: file.isBinary,
  });
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function split(stagedRaw, unstagedRaw) {
  const conflicts = new Map();
  const staged = [];
  const unstaged = [];
  for (const entry of stagedRaw) {
    if (entry.code === "!") conflicts.set(entry.path, entry);
    else staged.push(entry);
  }
  for (const entry of unstagedRaw) {
    if (entry.code === "!") conflicts.set(entry.path, entry);
    else unstaged.push(entry);
  }
  return {
    conflicts: [...conflicts.values()].sort(byPath),
    staged: staged.filter((entry) => !conflicts.has(entry.path)).sort(byPath),
    unstaged: unstaged.filter((entry) => !conflicts.has(entry.path)).sort(byPath),
  };
}

export function normalizeStatus(raw) {
  const lists = split(
    (raw?.stagedFiles ?? []).filter((file) => file?.path).map((file) => fromApiFile(file, true)),
    (raw?.unstagedFiles ?? []).filter((file) => file?.path).map((file) => fromApiFile(file, false)),
  );
  return {
    branch: raw?.branch || null,
    defaultBranch: raw?.defaultBranch || null,
    ahead: Number(raw?.aheadBehind?.ahead) || 0,
    behind: Number(raw?.aheadBehind?.behind) || 0,
    ...lists,
    limited: false,
  };
}

function parseBranchLine(line) {
  const head = line.slice(3);
  const out = { branch: null, ahead: 0, behind: 0 };
  if (head.startsWith("No commits yet on ")) out.branch = head.slice(18).trim();
  else if (head.startsWith("Initial commit on ")) out.branch = head.slice(18).trim();
  else if (!head.startsWith("HEAD (no branch)")) out.branch = head.split("...")[0].split(" ")[0] || null;
  out.ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
  out.behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  return out;
}

export function parsePorcelain(text) {
  const parts = String(text ?? "").split("\0");
  const staged = [];
  const unstaged = [];
  let head = { branch: null, ahead: 0, behind: 0 };
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith("## ")) {
      head = parseBranchLine(part);
      continue;
    }
    if (part.length < 4) continue;
    const x = part[0];
    const y = part[1];
    const path = part.slice(3);
    let oldPath = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") oldPath = parts[++i] || null;
    const pair = `${x}${y}`;
    if (pair === "??") {
      unstaged.push(makeEntry({ path, code: "U" }));
      continue;
    }
    if (pair === "!!") continue;
    if (CONFLICT_CODES.has(pair)) {
      unstaged.push(makeEntry({ path, code: "!" }));
      continue;
    }
    if (x !== " ") staged.push(makeEntry({ path, oldPath, code: x }));
    if (y !== " ") unstaged.push(makeEntry({ path, oldPath: y === "R" ? oldPath : null, code: y }));
  }
  return { ...head, defaultBranch: null, ...split(staged, unstaged), limited: true };
}

export function changeCount(status) {
  if (!status) return 0;
  const paths = new Set();
  for (const list of [status.conflicts, status.staged, status.unstaged]) for (const entry of list) paths.add(entry.path);
  return paths.size;
}

function listKey(list) {
  let out = "";
  for (const entry of list) out += `${entry.code}${entry.path}\u0001${entry.oldPath ?? ""}\u0001${entry.additions ?? ""}\u0001${entry.deletions ?? ""}\n`;
  return out;
}

export function statusKey(status) {
  if (!status) return "";
  return [
    status.branch ?? "",
    status.defaultBranch ?? "",
    status.ahead,
    status.behind,
    status.limited ? 1 : 0,
    listKey(status.conflicts),
    listKey(status.staged),
    listKey(status.unstaged),
  ].join("\u0002");
}
