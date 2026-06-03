import { useEffect, useRef } from "react";
import { FileText, Minus, Plus } from "lucide-react";
import { middle_truncate } from "@/lib/file-meta";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import { DiffStat } from "./diff-stat";

interface FileRowProps {
  path: string;
  label: string;
  added?: number | null;
  removed?: number | null;
  active?: boolean;
  staged?: boolean;
  onAction?: (path: string) => void;
  onOpen: (path: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  A: "text-diff-add",
  D: "text-diff-remove",
  M: "text-primary",
  R: "text-primary",
  U: "text-diff-add",
};

export function FileRow({
  path,
  label,
  added,
  removed,
  active,
  staged,
  onAction,
  onOpen,
}: FileRowProps) {
  const Action = staged ? Minus : Plus;
  const color = STATUS_COLOR[label] ?? "text-muted-foreground";
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li
      ref={ref}
      className={cn(
        "group flex h-[34px] cursor-pointer items-center gap-2 pl-2.5 pr-2.5 hover:bg-accent",
        active && "bg-accent",
      )}
      onClick={() => onOpen(path)}
    >
      <StatusBadge label={label} />
      <FileText className={cn("shrink-0", color)} size={11} strokeWidth={1.5} />
      <span
        className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foreground"
        title={path}
      >
        {middle_truncate(path)}
      </span>
      {onAction && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden size-[18px] shrink-0 group-hover:flex"
          title={staged ? "Unstage" : "Stage"}
          onClick={(e) => {
            e.stopPropagation();
            onAction(path);
          }}
        >
          <Action size={ICON_SIZE.row} strokeWidth={ICON_STROKE} />
        </Button>
      )}
      <DiffStat added={added ?? null} removed={removed ?? null} />
    </li>
  );
}
