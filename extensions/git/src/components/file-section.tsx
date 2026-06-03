import { ChevronDown, Minus, Plus } from "lucide-react";
import type { FileEntry } from "@/lib/git-status";
import { use_persistent_toggle } from "@/hooks/use-persistent-toggle";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileRow } from "./file-row";

interface FileSectionProps {
  id: string;
  title: string;
  entries: FileEntry[];
  staged: boolean;
  bulkLabel: string;
  onBulk: () => void;
  onAction: (path: string) => void;
  onOpen: (path: string) => void;
}

export function FileSection({
  id,
  title,
  entries,
  staged,
  bulkLabel,
  onBulk,
  onAction,
  onOpen,
}: FileSectionProps) {
  const [open, toggle] = use_persistent_toggle(id, true);

  if (entries.length === 0) return null;
  const Bulk = staged ? Minus : Plus;

  return (
    <section className="flex shrink-0 flex-col">
      <header className="group sticky top-0 z-10 flex h-[26px] shrink-0 items-center bg-background pl-2 pr-2">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <span className="flex w-4 shrink-0 justify-center">
            <ChevronDown
              className={cn("transition-transform", !open && "-rotate-90")}
              size={ICON_SIZE.caret}
              strokeWidth={ICON_STROKE}
            />
          </span>
          <span className="truncate text-[12px] font-semibold">{title}</span>
        </button>
        <span className="ml-1.5 rounded-full bg-muted-foreground px-1.5 py-px text-[10px] font-bold leading-none text-background">
          {entries.length}
        </span>
        <div className="ml-auto flex items-center text-muted-foreground opacity-0 group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" className="size-[18px]" title={bulkLabel} onClick={onBulk}>
            <Bulk size={ICON_SIZE.row} strokeWidth={ICON_STROKE} />
          </Button>
        </div>
      </header>
      {open && (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <FileRow
              key={entry.path}
              path={entry.path}
              label={entry.label}
              added={entry.added}
              removed={entry.removed}
              staged={staged}
              onAction={onAction}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
