// Repository facts the dashboard needs: which branch to filter on, and which
// commits landed between the last green run and the one that broke.
//
// Reads go through muxy.git where it has a method (cached, structured). The
// commit-range query has no muxy.git equivalent, so that one shells out.

import { exec } from "./exec.js";

const projectOpts = (cwd) => (cwd ? { project: cwd } : undefined);

export async function currentBranch(cwd = "") {
  try {
    const branch = await window.muxy?.git?.currentBranch?.(projectOpts(cwd));
    return typeof branch === "string" ? branch : "";
  } catch (e) {
    console.warn("[ci-dashboard] could not read the current branch:", e);
    return "";
  }
}

export async function branches(cwd = "") {
  try {
    const local = await window.muxy?.git?.branches?.(projectOpts(cwd));
    return Array.isArray(local) ? local : [];
  } catch (e) {
    console.warn("[ci-dashboard] could not list branches:", e);
    return [];
  }
}

/**
 * Commits reachable from `head` but not from `base` — the change set that
 * turned a green pipeline red. Returns [] when either SHA is unknown locally,
 * which is common when the runner built a commit that was never fetched here.
 */
export async function commitsBetween(base, head, cwd = "") {
  if (!base || !head || base === head) return [];
  // %x1f is git's own unit separator escape, so subjects containing any
  // printable delimiter still split correctly.
  const { stdout, code } = await exec(
    ["git", "log", "--no-merges", "--max-count=25", "--pretty=format:%h%x1f%an%x1f%s", `${base}..${head}`],
    cwd,
  );
  if (code !== 0) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, author, subject] = line.split("\u001f");
      return { hash, author, subject };
    });
}

/** True when every SHA resolves to a commit in the local object database. */
export async function hasCommits(shas, cwd = "") {
  const wanted = shas.filter(Boolean);
  if (!wanted.length) return false;
  for (const sha of wanted) {
    const { code } = await exec(["git", "cat-file", "-e", `${sha}^{commit}`], cwd);
    if (code !== 0) return false;
  }
  return true;
}
