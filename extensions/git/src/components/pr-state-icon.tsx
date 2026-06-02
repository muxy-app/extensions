import { CircleDashed, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import type { PrListItem } from "@/lib/gh";

export function PrStateIcon({ pr, size = 14 }: { pr: PrListItem; size?: number }) {
  if (pr.isDraft) return <CircleDashed size={size} strokeWidth={2} className="shrink-0 text-muted-foreground" />;
  if (pr.state === "merged") return <GitMerge size={size} strokeWidth={2} className="shrink-0 text-primary" />;
  if (pr.state === "closed")
    return <GitPullRequestClosed size={size} strokeWidth={2} className="shrink-0 text-diff-remove" />;
  return <GitPullRequest size={size} strokeWidth={2} className="shrink-0 text-diff-add" />;
}
