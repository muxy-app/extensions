import { useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  ExternalLink,
  GitBranch,
  Loader2,
  MoreHorizontal,
  SplitSquareHorizontal,
  SquareStack,
  XOctagon,
} from "lucide-react";
import type { PrInfo, PrListItem } from "@/lib/gh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PrStatusPopover } from "./pr-status-popover";
import { PrStateIcon } from "./pr-state-icon";

interface PrRowProps {
  pr: PrListItem;
  busy: boolean;
  loadDetail: (number: number) => Promise<PrInfo | null>;
  onCheckoutHere: () => void;
  onCheckoutWorktree: () => void;
  onViewDiff: () => void;
}

export function PrRow({
  pr,
  busy,
  loadDetail,
  onCheckoutHere,
  onCheckoutWorktree,
  onViewDiff,
}: PrRowProps) {
  return (
    <li className="group flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent">
      <PrStatusPopover pr={pr} loadDetail={loadDetail}>
        <button type="button" className="shrink-0 outline-none" title="PR status">
          <PrStateIcon pr={pr} />
        </button>
      </PrStatusPopover>

      <button
        type="button"
        onClick={onCheckoutHere}
        className="flex min-w-0 flex-1 flex-col items-start gap-px text-left outline-none"
        title={`Checkout PR #${pr.number}`}
      >
        <span className="flex w-full items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-foreground">{pr.title}</span>
          <span className="shrink-0 font-mono text-[10px] font-semibold text-muted-foreground">
            #{pr.number}
          </span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <span className="shrink-0">{pr.author}</span>
          <span className="text-muted-foreground/50">•</span>
          <GitBranch size={9} strokeWidth={2} className="shrink-0" />
          <span className="truncate font-mono">
            {pr.headBranch} → {pr.baseBranch}
          </span>
        </span>
      </button>

      <ChecksBadge pr={pr} />
      <Actions
        busy={busy}
        onCheckoutHere={onCheckoutHere}
        onCheckoutWorktree={onCheckoutWorktree}
        onViewDiff={onViewDiff}
        url={pr.url}
      />
    </li>
  );
}

function ChecksBadge({ pr }: { pr: PrListItem }) {
  switch (pr.checks.status) {
    case "pending":
      return <Clock size={12} strokeWidth={2} className="shrink-0 text-muted-foreground" />;
    case "success":
      return <CheckCircle2 size={12} strokeWidth={2} className="shrink-0 text-diff-add" />;
    case "failure":
      return <XOctagon size={12} strokeWidth={2} className="shrink-0 text-diff-remove" />;
    default:
      return null;
  }
}

interface ActionsProps {
  busy: boolean;
  url: string;
  onCheckoutHere: () => void;
  onCheckoutWorktree: () => void;
  onViewDiff: () => void;
}

function Actions({ busy, url, onCheckoutHere, onCheckoutWorktree, onViewDiff }: ActionsProps) {
  const [open, set_open] = useState(false);

  if (busy) {
    return (
      <span className="flex size-[22px] shrink-0 items-center justify-center">
        <Loader2 size={13} className="animate-spin text-muted-foreground" />
      </span>
    );
  }

  function run(fn: () => void) {
    set_open(false);
    fn();
  }

  return (
    <Popover open={open} onOpenChange={set_open}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="More actions"
          className="flex size-[22px] shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal size={14} strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <MenuItem icon={ArrowDownToLine} label="Checkout here" onClick={() => run(onCheckoutHere)} />
        <MenuItem
          icon={SquareStack}
          label="Checkout in new worktree"
          onClick={() => run(onCheckoutWorktree)}
        />
        <MenuItem icon={SplitSquareHorizontal} label="View diff" onClick={() => run(onViewDiff)} />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={() => set_open(false)}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-foreground outline-none hover:bg-accent"
        >
          <ExternalLink size={13} strokeWidth={2} className="text-muted-foreground" />
          Open on GitHub
        </a>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ArrowDownToLine;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground outline-none hover:bg-accent"
    >
      <Icon size={13} strokeWidth={2} className="text-muted-foreground" />
      {label}
    </button>
  );
}
