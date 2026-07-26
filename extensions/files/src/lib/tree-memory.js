import { worktree_root } from "@/lib/worktree-root";

const STORAGE_PREFIX = "muxy.files.tree-memory:";
const MAX_EXPANDED = 500;

function storage_key(root) {
  return `${STORAGE_PREFIX}${root || ""}`;
}

export async function load_tree_memory() {
  const root = await worktree_root();
  try {
    const raw = localStorage.getItem(storage_key(root));
    if (!raw) return { expanded: [], selected: null };
    const parsed = JSON.parse(raw);
    const expanded = Array.isArray(parsed?.expanded)
      ? parsed.expanded.filter((p) => typeof p === "string")
      : [];
    const selected = typeof parsed?.selected === "string" ? parsed.selected : null;
    return { expanded, selected };
  } catch {
    return { expanded: [], selected: null };
  }
}

export async function save_tree_memory(expandedDirs, selected) {
  const root = await worktree_root();
  const expanded = Array.from(expandedDirs).slice(-MAX_EXPANDED);
  try {
    localStorage.setItem(
      storage_key(root),
      JSON.stringify({ expanded, selected: selected ?? null }),
    );
  } catch {
  }
}
