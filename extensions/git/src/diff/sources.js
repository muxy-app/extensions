import * as git from "@/core/git";
import { forgeFor } from "@/core/forge";
import { binaryPatch, looksBinary, untrackedPatch } from "@/diff/patch";

const UNTRACKED_LIMIT = 300;
const UNTRACKED_MAX_BYTES = 1024 * 1024;

async function readUntracked(path) {
  try {
    const file = await muxy.files.read(path);
    const content = typeof file === "string" ? file : file?.content ?? "";
    const size = typeof file === "object" ? Number(file?.size) || content.length : content.length;
    if (size > UNTRACKED_MAX_BYTES || looksBinary(content)) return binaryPatch(path);
    return untrackedPatch(path, content);
  } catch {
    return binaryPatch(path);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function working() {
  const [patches, status] = await Promise.all([git.workingPatches(), git.readStatus({ fresh: true })]);
  const untracked = status.unstaged.filter((entry) => entry.code === "U").map((entry) => entry.path);
  const extra = await mapLimit(untracked.slice(0, UNTRACKED_LIMIT), 12, readUntracked);
  const notes = [];
  if (untracked.length > UNTRACKED_LIMIT) notes.push(`${untracked.length - UNTRACKED_LIMIT} more untracked files aren't shown.`);
  if (patches.truncated) notes.push("The diff is too large and was cut short.");
  if (status.conflicts.length) notes.push(`${status.conflicts.length} conflicted file${status.conflicts.length === 1 ? "" : "s"}: open ${status.conflicts.length === 1 ? "it" : "them"} in the editor to resolve.`);
  return {
    title: "Changes",
    icon: "file",
    groups: [
      { id: "staged", label: "Staged Changes", patch: patches.staged },
      { id: "unstaged", label: "Changes", patch: patches.unstaged + extra.join("") },
    ],
    notes,
    empty: "Your working tree is clean.",
    status,
  };
}

async function commit(hash) {
  const details = await git.commitDetails(hash);
  const patch = await git.commitPatch(details.hash, details.parents);
  return {
    title: `${details.shortHash} ${details.subject}`,
    icon: "history",
    groups: [{ id: "commit", label: "", patch }],
    notes: details.parents.length > 1 ? [`Merge commit: changes against the first parent ${details.parents[0].slice(0, 7)}.`] : [],
    info: { kind: "commit", details },
    empty: "This commit has no file changes.",
  };
}

async function pr(root, number) {
  const forge = await forgeFor(root);
  const [details, patch] = await Promise.all([forge.api.details(number).catch(() => null), forge.api.diff(number)]);
  return {
    title: details ? `#${number} ${details.title}` : `#${number}`,
    icon: "pr",
    groups: [{ id: "pr", label: "", patch }],
    notes: [],
    info: details ? { kind: "pr", details, forge: forge.kind } : null,
    empty: "This pull request has no changes against its base branch.",
  };
}

async function range(spec, title) {
  const patch = await git.rangePatch(spec);
  return { title: title || spec, icon: "history", groups: [{ id: "range", label: "", patch }], notes: [], empty: "There are no changes in this range." };
}

export function loadSource(root, data) {
  if (data.source === "commit" && data.hash) return commit(data.hash);
  if (data.source === "pr" && data.number) return pr(root, Number(data.number));
  if (data.source === "range" && data.range) return range(data.range, data.title);
  return working();
}
