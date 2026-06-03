import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { pr_state } from "@/lib/git-prs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PrStateIcon } from "./pr-state-icon";

interface PrStatusPopoverProps {
  pr: MuxyGitPRListItem;
  children: React.ReactNode;
}

export function PrStatusPopover({ pr, children }: PrStatusPopoverProps) {
  const [open, set_open] = useState(false);

  return (
    <Popover open={open} onOpenChange={set_open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <PrStateIcon pr={pr} size={13} />
            <span className="truncate text-[12px] font-semibold text-foreground">{pr.title}</span>
          </div>
          <Row label="PR" value={`#${pr.number}`} />
          <Row label="State" value={state_label(pr)} />
          <Row label="Base" value={pr.baseBranch} />
          <Row label="Mergeable" value={mergeable_label(pr)} tone={mergeable_tone(pr)} />
          <ChecksRow pr={pr} />
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-muted text-[11px] font-medium text-foreground outline-none transition-colors hover:border-primary hover:bg-accent"
          >
            <ExternalLink size={12} strokeWidth={2} />
            Open on GitHub
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChecksRow({ pr }: { pr: MuxyGitPRListItem }) {
  const c = pr.checks;
  if (c.status === "none") return <Row label="Checks" value="—" />;
  if (c.status === "success")
    return <Row label="Checks" value={`${c.passing}/${c.total} passing`} tone="positive" />;
  if (c.status === "pending")
    return <Row label="Checks" value={`${c.pending} running`} />;
  return <Row label="Checks" value={`${c.failing} failing`} tone="negative" />;
}

type Tone = "positive" | "negative" | "muted" | "default";

function Row({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  const color =
    tone === "positive"
      ? "text-diff-add"
      : tone === "negative"
        ? "text-diff-remove"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={`truncate font-mono text-[11px] font-medium ${color}`}>{value}</span>
    </div>
  );
}

function state_label(pr: MuxyGitPRListItem): string {
  const state = pr_state(pr);
  if (state === "open") return pr.isDraft ? "Draft · Open" : "Open";
  if (state === "merged") return "Merged";
  return "Closed";
}

function mergeable_label(pr: MuxyGitPRListItem): string {
  if (pr.mergeable === false) return "Conflicts";
  switch (pr.mergeStateStatus) {
    case "DIRTY":
      return "Conflicts";
    case "BEHIND":
      return "Behind base";
    case "BLOCKED":
      return "Blocked";
    case "DRAFT":
      return "Draft";
    default:
      break;
  }
  if (pr.checks.status === "failure") return "Yes (checks failing)";
  if (pr.checks.status === "pending") return "Yes (checks running)";
  return "Yes";
}

function mergeable_tone(pr: MuxyGitPRListItem): Tone {
  if (pr.mergeable === false) return "negative";
  switch (pr.mergeStateStatus) {
    case "DIRTY":
    case "BEHIND":
    case "BLOCKED":
      return "negative";
    case "DRAFT":
      return "muted";
    default:
      break;
  }
  if (pr.checks.status === "failure") return "negative";
  return "positive";
}
