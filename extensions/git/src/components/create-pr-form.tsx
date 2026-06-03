import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, GitPullRequest, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CreatePrInput } from "@/hooks/use-prs";

interface CreatePrFormProps {
  baseBranch: string | null;
  onSubmit: (input: CreatePrInput) => Promise<boolean>;
  onBack: () => void;
}

export function CreatePrForm({ baseBranch, onSubmit, onBack }: CreatePrFormProps) {
  const [title, set_title] = useState("");
  const [body, set_body] = useState("");
  const [newBranch, set_new_branch] = useState("");
  const [advanced, set_advanced] = useState(false);
  const [busy, set_busy] = useState(false);

  const disabled = busy || title.trim() === "";

  async function submit() {
    if (disabled) return;
    set_busy(true);
    try {
      const ok = await onSubmit({
        title: title.trim(),
        body: body.trim(),
        baseBranch: baseBranch ?? undefined,
        newBranch: newBranch.trim() || undefined,
      });
      if (ok) onBack();
    } finally {
      set_busy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-border p-2.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title="Back to commit"
          onClick={onBack}
          className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={13} strokeWidth={2} />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          New pull request{baseBranch ? ` → ${baseBranch}` : ""}
        </span>
      </div>

      <Textarea
        rows={1}
        placeholder="Title"
        value={title}
        onChange={(e) => set_title(e.target.value)}
        className="min-h-[32px] text-[12px]"
      />
      <Textarea
        rows={2}
        placeholder="Summary (optional)"
        value={body}
        onChange={(e) => set_body(e.target.value)}
        className="min-h-[48px] text-[12px]"
      />

      <button
        type="button"
        onClick={() => set_advanced((v) => !v)}
        className="flex items-center gap-1 self-start text-[11px] text-muted-foreground outline-none hover:text-foreground"
      >
        {advanced ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
        Advanced
      </button>
      {advanced && (
        <Textarea
          rows={1}
          placeholder="New branch name (commit current changes here, then open PR)"
          value={newBranch}
          onChange={(e) => set_new_branch(e.target.value)}
          className="min-h-[32px] font-mono text-[12px]"
        />
      )}

      <Button
        variant={disabled ? "secondary" : "default"}
        className="h-7 gap-1 rounded-md text-[11px] font-medium"
        disabled={disabled}
        onClick={() => void submit()}
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <GitPullRequest size={11} strokeWidth={2.5} />
        )}
        Create pull request
      </Button>
    </section>
  );
}
