const PREFIX = "muxy.git.prs.";

export function read_pr_cache(key: string | undefined): MuxyGitPRListItem[] | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MuxyGitPRListItem[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function write_pr_cache(key: string | undefined, prs: MuxyGitPRListItem[]): void {
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(prs));
  } catch {
    void 0;
  }
}
