interface DiffStatProps {
  added: number | null;
  removed: number | null;
}

function format(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function DiffStat({ added, removed }: DiffStatProps) {
  if (added === null && removed === null) return null;
  return (
    <span className="flex shrink-0 items-center gap-2 font-mono text-[12px] font-semibold tabular-nums">
      {added !== null && <span className="text-diff-add">+{format(added)}</span>}
      {removed !== null && <span className="text-diff-remove">-{format(removed)}</span>}
    </span>
  );
}
