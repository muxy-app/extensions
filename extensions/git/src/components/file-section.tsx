import { ChevronDown, List, ListTree, Minus, Plus } from "lucide-react";
import { useMemo } from "react";
import type { FileEntry } from "@/lib/git-status";
import { entries_to_git_status } from "@/lib/tree-status";
import { use_persistent_toggle } from "@/hooks/use-persistent-toggle";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileRow } from "./file-row";
import { FileTreeView } from "./file-tree-view";

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
  const [tree, toggleView] = use_persistent_toggle(`${id}.tree`, false);

  const paths = useMemo(() => entries.map((e) => e.path), [entries]);
  const gitStatus = useMemo(() => entries_to_git_status(entries), [entries]);

  if (entries.length === 0) return null;
  const Bulk = staged ? Minus : Plus;
  const View = tree ? List : ListTree;

  const fill = open && tree;

  return (
    <section className={cn("flex flex-col", fill && "min-h-0 flex-1")}>
      <header className="sticky top-0 z-10 flex h-[30px] shrink-0 items-center gap-1.5 bg-background pl-2 pr-1">
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn("shrink-0 transition-transform", !open && "-rotate-90")}
            size={9}
            strokeWidth={2.5}
          />
          <span className="truncate text-[11px] font-semibold">{title}</span>
        </button>
        <span className="rounded-full bg-muted-foreground px-1.5 py-px text-[10px] font-bold leading-none text-background">
          {entries.length}
        </span>
        <div className="ml-auto flex items-center text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-[18px]"
            title={tree ? "View as list" : "View as tree"}
            onClick={toggleView}
          >
            <View size={ICON_SIZE.row} strokeWidth={ICON_STROKE} />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-[18px]" title={bulkLabel} onClick={onBulk}>
            <Bulk size={ICON_SIZE.row} strokeWidth={ICON_STROKE} />
          </Button>
        </div>
      </header>
      {open &&
        (tree ? (
          <div className="min-h-0 flex-1">
            <FileTreeView paths={paths} gitStatus={gitStatus} onSelect={onOpen} fill />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
                staged={staged}
                onAction={onAction}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}
