import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

export function NoRepo({ onInit }: { onInit: () => void }) {
  return (
    <EmptyState>
      <div>This folder is not a Git repository.</div>
      <Button variant="outline" size="sm" onClick={onInit}>
        Initialize Repository
      </Button>
    </EmptyState>
  );
}
