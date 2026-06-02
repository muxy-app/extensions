import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PrInfo, PrListItem } from "@/lib/gh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PrStateIcon } from "./pr-state-icon";

interface PrStatusPopoverProps {
  pr: PrListItem;
  loadDetail: (number: number) => Promise<PrInfo | null>;
  children: React.ReactNode;
}

export function PrStatusPopover({ pr, loadDetail, children }: PrStatusPopoverProps) {
  const [open, set_open] = useState(false);
  const [info, set_info] = useState<PrInfo | null>(null);
  const [loading, set_loading] = useState(false);

  function on_open(next: boolean) {
    set_open(next);
    if (next && !info && !loading) {
      set_loading(true);
      void loadDetail(pr.number)
        .then((res) => set_info(res))
        .finally(() => set_loading(false));
    }
  }

  return (
    <Popover open={open} onOpenChange={on_open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <PrStateIcon pr={pr} size={13} />
            <span className="truncate text-[12px] font-semibold text-foreground">{pr.title}</span>
          </div>
          <Row label="PR" value={`#${pr.number}`} />
          <Row label="State" value={state_label(info, pr)} />
          <Row label="Base" value={info?.baseBranch || pr.baseBranch} />
          {loading && !info ? (
            <Row label="Status" value="loading…" />
          ) : info ? (
            <>
              <Row label="Mergeable" value={mergeable_label(info)} tone={mergeable_tone(info)} />
              <ChecksRow pr={pr} />
            </>
          ) : (
            <ChecksRow pr={pr} />
          )}
          <a
            href={info?.url || pr.url}
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

function ChecksRow({ pr }: { pr: PrListItem }) {
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

function state_label(info: PrInfo | null, pr: PrListItem): string {
  const draft = info?.isDraft ?? pr.isDraft;
  const state = info?.state ?? pr.state;
  if (state === "open") return draft ? "Draft · Open" : "Open";
  if (state === "merged") return "Merged";
  return "Closed";
}

function mergeable_label(info: PrInfo): string {
  if (info.mergeable === false) return "Conflicts";
  switch (info.mergeStateStatus) {
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
  if (info.checks.status === "failure") return "Yes (checks failing)";
  if (info.checks.status === "pending") return "Yes (checks running)";
  return "Yes";
}

function mergeable_tone(info: PrInfo): Tone {
  if (info.mergeable === false) return "negative";
  switch (info.mergeStateStatus) {
    case "DIRTY":
    case "BEHIND":
    case "BLOCKED":
      return "negative";
    case "DRAFT":
      return "muted";
    default:
      break;
  }
  if (info.checks.status === "failure") return "negative";
  return "positive";
}
