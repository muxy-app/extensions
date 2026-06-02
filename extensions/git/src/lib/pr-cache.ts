import type { PrListItem } from "@/lib/gh";

const PREFIX = "muxy.git.prs.";

export function read_pr_cache(cwd: string | undefined): PrListItem[] | null {
  if (!cwd) return null;
  try {
    const raw = localStorage.getItem(PREFIX + cwd);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrListItem[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function write_pr_cache(cwd: string | undefined, prs: PrListItem[]): void {
  if (!cwd) return;
  try {
    localStorage.setItem(PREFIX + cwd, JSON.stringify(prs));
  } catch {
    void 0;
  }
}
