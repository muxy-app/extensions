import { GitPullRequest, Loader2 } from "lucide-react";
import type { PrInfo, PrListItem } from "@/lib/gh";
import type { PrsState } from "@/hooks/use-prs";
import { EmptyState } from "./empty-state";
import { PrRow } from "./pr-row";

interface PrListProps {
  state: PrsState;
  busy: number | null;
  loadDetail: (number: number) => Promise<PrInfo | null>;
  onCheckoutHere: (pr: PrListItem) => void;
  onCheckoutWorktree: (pr: PrListItem) => void;
  onViewDiff: (pr: PrListItem) => void;
}

export function PrList({
  state,
  busy,
  loadDetail,
  onCheckoutHere,
  onCheckoutWorktree,
  onViewDiff,
}: PrListProps) {
  if (state.kind === "loading") {
    return (
      <EmptyState>
        <Loader2 size={18} className="animate-spin" />
        Loading pull requests…
      </EmptyState>
    );
  }

  if (state.kind === "no_gh") {
    return (
      <EmptyState>
        <GitPullRequest size={20} strokeWidth={1.5} />
        <span>
          GitHub CLI not found. Install <span className="font-mono">gh</span> and run{" "}
          <span className="font-mono">gh auth login</span> to see pull requests.
        </span>
      </EmptyState>
    );
  }

  if (state.prs.length === 0) {
    return <EmptyState>No open pull requests.</EmptyState>;
  }

  return (
    <ul className="divide-y divide-border">
      {state.prs.map((pr) => (
        <PrRow
          key={pr.number}
          pr={pr}
          busy={busy === pr.number}
          loadDetail={loadDetail}
          onCheckoutHere={() => onCheckoutHere(pr)}
          onCheckoutWorktree={() => onCheckoutWorktree(pr)}
          onViewDiff={() => onViewDiff(pr)}
        />
      ))}
    </ul>
  );
}
