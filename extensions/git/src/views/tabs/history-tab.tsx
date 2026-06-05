import type { use_git_graph } from "@/hooks/use-git-graph";
import { Button } from "@/components/ui/button";
import { CommitRow } from "@/components/commit-row";
import { EmptyState } from "@/components/empty-state";

interface HistoryTabProps {
  graph: ReturnType<typeof use_git_graph>;
  on_message: (message: string) => void;
  refresh_all: () => void;
}

export function HistoryTab({ graph, on_message, refresh_all }: HistoryTabProps) {
  if (graph.rows.length === 0) {
    return <EmptyState>{graph.loading ? "Loading…" : "No commits."}</EmptyState>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <ul className="divide-y divide-border">
        {graph.rows.map((row) => (
          <CommitRow
            key={row.commit.hash}
            row={row}
            onPrefillMessage={on_message}
            onRefresh={refresh_all}
          />
        ))}
      </ul>
      {graph.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="m-1 h-7 justify-center text-[12px]"
          disabled={graph.loading}
          onClick={graph.load_more}
        >
          {graph.loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
