import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type SyncOp = "pull" | "push";

interface CommitBoxProps {
  canCommit: boolean;
  onCommit: (message: string) => Promise<boolean>;
  onPull: () => Promise<unknown>;
  onPush: () => Promise<unknown>;
}

export function CommitBox({ canCommit, onCommit, onPull, onPush }: CommitBoxProps) {
  const [message, set_message] = useState("");
  const [busy, set_busy] = useState<SyncOp | null>(null);
  const disabled = !canCommit || message.trim() === "";

  async function commit() {
    if (disabled) return;
    if (await onCommit(message.trim())) set_message("");
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

  function SyncButton({ op, label, icon: Icon, action }: {
    op: SyncOp;
    label: string;
    icon: typeof ArrowDown;
    action: () => Promise<unknown>;
  }) {
    const ActiveIcon = busy === op ? Loader2 : Icon;
    return (
      <Button
        variant="secondary"
        className="h-7 gap-1 rounded-md px-2.5 text-[11px] font-medium"
        disabled={busy !== null}
        onClick={() => void run(op, action)}
      >
        <ActiveIcon
          className={busy === op ? "animate-spin" : undefined}
          size={10}
          strokeWidth={2.5}
        />
        {label}
      </Button>
    );
  }

  return (
    <section className="flex flex-col gap-2 border-b border-border p-2.5">
      <Textarea
        rows={1}
        placeholder="Commit message (⌘↩ to commit on branch)"
        value={message}
        onChange={(e) => set_message(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
        className="min-h-[48px] text-[12px]"
      />
      <div className="flex gap-1.5">
        <Button
          variant={disabled ? "secondary" : "default"}
          className="h-7 flex-1 gap-1 rounded-md text-[11px] font-medium"
          disabled={disabled}
          onClick={() => void commit()}
        >
          <Check size={10} strokeWidth={3} />
          Commit
        </Button>
        <SyncButton op="pull" label="Pull" icon={ArrowDown} action={onPull} />
        <SyncButton op="push" label="Push" icon={ArrowUp} action={onPush} />
      </div>
    </section>
  );
}
