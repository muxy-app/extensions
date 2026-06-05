import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type SyncOp = "pull" | "push";

interface CommitBoxProps {
  canCommit: boolean;
  message: string;
  onMessage: (message: string) => void;
  onCommit: (message: string) => Promise<boolean>;
  onPull: () => Promise<unknown>;
  onPush: () => Promise<unknown>;
}

export function CommitBox({ canCommit, message, onMessage, onCommit, onPull, onPush }: CommitBoxProps) {
  const [busy, set_busy] = useState<SyncOp | "commit" | null>(null);
  const commitDisabled = !canCommit || message.trim() === "" || busy !== null;

  async function commit() {
    if (commitDisabled) return;
    set_busy("commit");
    try {
      if (await onCommit(message.trim())) onMessage("");
    } finally {
      set_busy(null);
    }
  }

  async function run(op: SyncOp, action: () => Promise<unknown>) {
    if (busy) return;
    set_busy(op);
    try {
      await action();
    } finally {
      set_busy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        rows={1}
        placeholder="Commit message (⌘↩ to commit on branch)"
        value={message}
        onChange={(e) => onMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
        className="min-h-[48px] text-[12px]"
      />
      <SplitButton
        disabled={commitDisabled}
        busy={busy}
        onPrimary={() => void commit()}
        onPull={() => void run("pull", onPull)}
        onPush={() => void run("push", onPush)}
      />
    </div>
  );
}

function SplitButton({
  disabled,
  busy,
  onPrimary,
  onPull,
  onPush,
}: {
  disabled: boolean;
  busy: SyncOp | "commit" | null;
  onPrimary: () => void;
  onPull: () => void;
  onPush: () => void;
}) {
  const [open, set_open] = useState(false);

  function pick(action: () => void) {
    set_open(false);
    action();
  }

  const label = busy === "pull" ? "Pulling…" : busy === "push" ? "Pushing…" : "Commit";
  const Icon = busy === "pull" ? ArrowDown : busy === "push" ? ArrowUp : Check;

  return (
    <div className="flex">
      <Button
        variant={disabled ? "secondary" : "default"}
        className="h-7 flex-1 gap-1 rounded-l-md rounded-r-none text-[11px] font-medium"
        disabled={disabled || busy !== null}
        onClick={onPrimary}
      >
        {busy ? (
          <Loader2 size={10} strokeWidth={3} className="animate-spin" />
        ) : (
          <Icon size={11} strokeWidth={3} />
        )}
        {label}
      </Button>
      <Popover open={open} onOpenChange={set_open}>
        <PopoverTrigger asChild>
          <Button
            variant={disabled ? "secondary" : "default"}
            title="Pull / Push"
            className="h-7 w-6 rounded-l-none rounded-r-md border-l border-border/40 px-0"
          >
            <ChevronDown size={12} strokeWidth={2.5} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          <MenuItem
            icon={ArrowDown}
            label="Pull"
            busy={busy === "pull"}
            onClick={() => pick(onPull)}
          />
          <MenuItem
            icon={ArrowUp}
            label="Push"
            busy={busy === "push"}
            onClick={() => pick(onPush)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  active,
  busy,
  onClick,
}: {
  icon: typeof Check;
  label: string;
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground outline-none hover:bg-accent"
    >
      {busy ? (
        <Loader2 size={13} className="animate-spin text-muted-foreground" />
      ) : (
        <Icon size={13} strokeWidth={2} className="text-muted-foreground" />
      )}
      <span className="flex-1">{label}</span>
      {active && <Check size={13} strokeWidth={2.5} className="text-primary" />}
    </button>
  );
}
