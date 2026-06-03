import { CircleDashed, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { pr_state } from "@/lib/git-prs";

export function PrStateIcon({
  pr,
  size = 14,
}: {
  pr: { state: string; isDraft: boolean };
  size?: number;
}) {
  if (pr.isDraft) return <CircleDashed size={size} strokeWidth={2} className="shrink-0 text-muted-foreground" />;
  const state = pr_state(pr);
  if (state === "merged") return <GitMerge size={size} strokeWidth={2} className="shrink-0 text-primary" />;
  if (state === "closed")
    return <GitPullRequestClosed size={size} strokeWidth={2} className="shrink-0 text-diff-remove" />;
  return <GitPullRequest size={size} strokeWidth={2} className="shrink-0 text-diff-add" />;
}
