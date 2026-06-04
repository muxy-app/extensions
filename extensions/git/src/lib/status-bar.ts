import type { GitStatus } from "@/lib/git-status";

export function sync_status_bar(status: GitStatus | null) {
  void muxy.statusbar.set({ id: "branch", text: status?.branch ?? null });
  void muxy.statusbar.set({
    id: "pr-info",
    text: status?.pullRequest ? `#${status.pullRequest.number}` : null,
  });
}
