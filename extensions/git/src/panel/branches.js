import * as git from "@/core/git";

const cache = new Map();

export function cachedBranches(root) {
  return cache.get(root) ?? null;
}

export async function loadBranches(root) {
  const [local, remote] = await Promise.all([git.localBranches().catch(() => []), git.remoteBranches()]);
  const data = { local, remote };
  cache.set(root, data);
  return data;
}

export function prefetchBranches(root) {
  if (root) void loadBranches(root).catch(() => undefined);
}

export function forgetBranch(root, name) {
  const data = cache.get(root);
  if (data) cache.set(root, { ...data, local: data.local.filter((branch) => branch !== name) });
}
