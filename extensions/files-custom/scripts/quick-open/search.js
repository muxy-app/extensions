// Fuzzy file matching for Go to File. Pure and synchronous (unit-tested in
// tests/quick-open.test.mjs).
//
// Lower scores rank higher: a match inside the file name beats one in the
// folder path, a contiguous match beats a scattered one, and shorter paths
// break ties. Typing usually extends the previous query, so each query only
// re-scans the previous query's matches.

export const MAX_RESULTS = 200;

export class FileIndex {
  constructor(paths) {
    this.paths = paths;
    this.lower = paths.map((path) => path.toLowerCase());
    this.nameStart = paths.map((path) => path.lastIndexOf("/") + 1);
    this.last = { query: "", matches: null };
  }

  search(raw, limit = MAX_RESULTS) {
    const query = raw.toLowerCase().replace(/\s+/g, "");
    if (!query) return [];
    const pool = this.last.matches && query.startsWith(this.last.query) ? this.last.matches : null;
    const scored = [];
    const consider = (i) => {
      const score = score_path(this.lower[i], this.nameStart[i], query);
      if (score >= 0) scored.push({ i, score });
    };
    if (pool) for (const i of pool) consider(i);
    else for (let i = 0; i < this.paths.length; i += 1) consider(i);
    this.last = { query, matches: scored.map((m) => m.i) };
    scored.sort((a, b) => a.score - b.score || this.paths[a.i].length - this.paths[b.i].length || (this.paths[a.i] < this.paths[b.i] ? -1 : 1));
    return scored.slice(0, limit).map((m) => this.paths[m.i]);
  }
}

function is_boundary(text, i) {
  if (i === 0) return true;
  const prev = text.charCodeAt(i - 1);
  // "/", "-", "_", ".", " "
  return prev === 47 || prev === 45 || prev === 95 || prev === 46 || prev === 32;
}

/** Score of `query` against a lowercased path, or -1 when it doesn't match. */
export function score_path(lower, nameStart, query) {
  const inName = lower.indexOf(query, nameStart);
  if (inName !== -1) return (inName === nameStart ? 0 : 10) + (inName - nameStart);
  const inPath = lower.indexOf(query);
  if (inPath !== -1) return 1000 + (is_boundary(lower, inPath) ? 0 : 50) + Math.min(inPath, 500);

  // Subsequence: every query character in order. Count how scattered it is,
  // and prefer matches whose last part lands in the file name.
  let at = 0;
  let gaps = 0;
  let boundaries = 0;
  let prev = -1;
  for (let q = 0; q < query.length; q += 1) {
    const found = lower.indexOf(query[q], at);
    if (found === -1) return -1;
    if (prev !== -1 && found !== prev + 1) gaps += 1;
    if (is_boundary(lower, found)) boundaries += 1;
    prev = found;
    at = found + 1;
  }
  return 2000 + gaps * 20 - boundaries * 5 + (prev >= nameStart ? 0 : 300);
}
