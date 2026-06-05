import type { CommitLane, CommitNode, GraphRow } from "@/lib/types";

export const MAX_LANES = 6;

export function toCommitNode(c: MuxyGitCommit): CommitNode {
  return {
    hash: c.hash,
    shortHash: c.shortHash,
    subject: c.subject,
    authorName: c.authorName,
    authorDate: c.authorDate,
    isMerge: c.isMerge,
    parentHashes: c.parentHashes ?? [],
    refs: c.refs ?? [],
  };
}

function claimLane(lanes: Array<string | null>, hash: string): number {
  const existing = lanes.indexOf(hash);
  if (existing !== -1) return existing;
  const free = lanes.indexOf(null);
  if (free !== -1) {
    lanes[free] = hash;
    return free;
  }
  lanes.push(hash);
  return lanes.length - 1;
}

export function computeLanes(commits: CommitNode[]): GraphRow[] {
  const lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const column = claimLane(lanes, commit.hash);
    const before = lanes.map((lane) => lane);
    const first = commit.parentHashes[0] ?? null;
    lanes[column] = first;
    const edges: CommitLane["edges"] = [];
    if (first) edges.push({ fromColumn: column, toColumn: column });

    for (let i = 1; i < commit.parentHashes.length; i += 1) {
      const parent = commit.parentHashes[i];
      const target = claimLane(lanes, parent);
      edges.push({ fromColumn: column, toColumn: target });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const passthrough: number[] = [];
    for (let i = 0; i < before.length; i += 1) {
      if (i !== column && before[i] !== null) passthrough.push(i);
    }

    const width = Math.min(MAX_LANES, Math.max(before.length, lanes.length, column + 1));
    rows.push({ commit, lane: { column, passthrough, edges, width } });
  }

  return rows;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
