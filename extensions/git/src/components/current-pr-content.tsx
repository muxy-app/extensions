import { useState } from "react";
import { ExternalLink, GitMerge, Loader2, Trash2, XCircle } from "lucide-react";
import { open_url } from "@/lib/git";
import { pr_state, type MergeMethod } from "@/lib/git-prs";
import { PrStateIcon } from "./pr-state-icon";

interface CurrentPrContentProps {
  pr: MuxyGitPR;
  busy: boolean;
  onMerge: (method: MergeMethod, deleteBranch: boolean) => Promise<boolean>;
  onClose: (number: number) => Promise<boolean>;
  onCleanup: () => Promise<boolean>;
  onDone?: () => void;
}

type Confirm = { kind: "none" } | { kind: "close" };

export function CurrentPrContent({
  pr,
  busy,
  onMerge,
  onClose,
  onCleanup,
  onDone,
}: CurrentPrContentProps) {
  const [confirm, set_confirm] = useState<Confirm>({ kind: "none" });

  async function run(action: Promise<boolean>) {
    const ok = await action;
    set_confirm({ kind: "none" });
    if (ok) onDone?.();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <PrStateIcon pr={pr} size={13} />
        <span className="font-mono text-[12px] font-semibold text-foreground">#{pr.number}</span>
        <span className="text-[11px] text-muted-foreground">{state_label(pr)}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction
            icon={XCircle}
            title="Close PR"
            disabled={busy || pr_state(pr) !== "open"}
            tone="danger"
            onClick={() => set_confirm({ kind: "close" })}
          />
          <IconAction
            icon={Trash2}
            title="Clean up branch"
            disabled={busy}
            onClick={() => void run(onCleanup())}
          />
          <IconAction icon={ExternalLink} title="View on GitHub" onClick={() => open_url(pr.url)} />
        </div>
      </div>
      <Row label="Base" value={pr.baseBranch} />
      <Row label="Mergeable" value={mergeable_label(pr)} tone={mergeable_tone(pr)} />
      <ChecksRow checks={pr.checks} />

      {confirm.kind === "close" ? (
        <ConfirmClose
          number={pr.number}
          onCancel={() => set_confirm({ kind: "none" })}
          onConfirm={() => void run(onClose(pr.number))}
        />
      ) : (
        <Actions pr={pr} busy={busy} onMerge={(method) => void run(onMerge(method, true))} />
      )}
    </div>
  );
}

function IconAction({
  icon: Icon,
  title,
  disabled,
  tone = "default",
  onClick,
}: {
  icon: typeof XCircle;
  title: string;
  disabled?: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  const hover = tone === "danger" ? "hover:text-diff-remove" : "hover:text-foreground";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40 ${hover}`}
    >
      <Icon size={13} strokeWidth={2} />
    </button>
  );
}

function Actions({
  pr,
  busy,
  onMerge,
}: {
  pr: MuxyGitPR;
  busy: boolean;
  onMerge: (method: MergeMethod) => void;
}) {
  if (busy) {
    return (
      <span className="mt-1 flex h-7 items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        Working…
      </span>
    );
  }

  const state = pr_state(pr);
  if (state !== "open") {
    return (
      <span className="mt-1 flex h-7 items-center justify-center rounded-md border border-border text-[11px] text-muted-foreground">
        This PR is {state}.
      </span>
    );
  }

  const blockedReason = merge_blocked_reason(pr);
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <MergeButton label="Merge commit" disabled={!!blockedReason} onClick={() => onMerge("merge")} />
      <MergeButton label="Squash & merge" disabled={!!blockedReason} onClick={() => onMerge("squash")} />
      <MergeButton label="Rebase & merge" disabled={!!blockedReason} onClick={() => onMerge("rebase")} />
      {blockedReason && (
        <span className="text-center text-[10px] text-muted-foreground">{blockedReason}</span>
      )}
    </div>
  );
}

function merge_blocked_reason(pr: MuxyGitPR): string | null {
  if (pr.isDraft) return "Draft PRs can't be merged.";
  if (pr.mergeable === false || pr.mergeStateStatus === "DIRTY") return "Has merge conflicts.";
  if (pr.mergeStateStatus === "BLOCKED") return "Merge is blocked by branch rules.";
  if (pr.mergeStateStatus === "BEHIND") return "Branch is behind the base.";
  return null;
}

function MergeButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-muted text-[11px] font-medium text-foreground outline-none transition-colors hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
    >
      <GitMerge size={12} strokeWidth={2} />
      {label}
    </button>
  );
}

function ConfirmClose({
  number,
  onCancel,
  onConfirm,
}: {
  number: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-border p-2">
      <span className="text-[11px] text-foreground">Close PR #{number}?</span>
      <div className="flex gap-1.5">
        <ConfirmButton label="Cancel" onClick={onCancel} />
        <ConfirmButton label="Close PR" tone="danger" onClick={onConfirm} />
      </div>
    </div>
  );
}

function ConfirmButton({
  label,
  tone = "default",
  onClick,
}: {
  label: string;
  tone?: "default" | "primary" | "danger";
  onClick: () => void;
}) {
  const cls =
    tone === "primary"
      ? "bg-primary text-primary-foreground font-semibold hover:brightness-110"
      : tone === "danger"
        ? "border border-border text-diff-remove hover:bg-accent"
        : "border border-border text-foreground hover:bg-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 flex-1 items-center justify-center rounded-md text-[11px] font-medium outline-none transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}

function ChecksRow({ checks }: { checks: MuxyGitPRChecks }) {
  if (checks.status === "none") return <Row label="Checks" value="—" />;
  const parts = [
    checks.passing > 0 && `${checks.passing} passing`,
    checks.failing > 0 && `${checks.failing} failing`,
    checks.pending > 0 && `${checks.pending} running`,
  ].filter(Boolean) as string[];
  const tone: Tone =
    checks.status === "failure" ? "negative" : checks.status === "success" ? "positive" : "default";
  return <Row label="Checks" value={parts.join(" · ") || "—"} tone={tone} />;
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

function state_label(pr: MuxyGitPR): string {
  const state = pr_state(pr);
  if (state === "open") return pr.isDraft ? "Draft · Open" : "Open";
  if (state === "merged") return "Merged";
  return "Closed";
}

function mergeable_label(pr: MuxyGitPR): string {
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

function mergeable_tone(pr: MuxyGitPR): Tone {
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
