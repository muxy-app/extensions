import type { GitStatus } from "@/lib/git-status";
import type { CreatePrInput } from "@/hooks/use-create-pr";
import type { use_git_graph } from "@/hooks/use-git-graph";
import type { use_pr_actions } from "@/hooks/use-pr-actions";
import { RefreshCw } from "lucide-react";
import { use_persistent_value } from "@/hooks/use-persistent-value";
import { BranchSwitcher } from "@/components/branch-switcher";
import { PanelTabs, type TabId } from "@/components/panel-tabs";
import { BranchTab } from "@/views/tabs/branch-tab";
import { PrsTab } from "@/views/tabs/prs-tab";
import { HistoryTab } from "@/views/tabs/history-tab";

interface SourceControlPanelProps {
  status: GitStatus;
  stage: (path: string) => Promise<boolean>;
  unstage: (path: string) => Promise<boolean>;
  stage_all: () => Promise<boolean>;
  unstage_all: () => Promise<boolean>;
  discard: (path: string) => Promise<boolean>;
  discard_all: () => Promise<boolean>;
  commit: (message: string) => Promise<boolean>;
  sync: (op: "push" | "pull") => Promise<boolean>;
  create_pr: (input: CreatePrInput) => Promise<boolean>;
  pr_actions: ReturnType<typeof use_pr_actions>;
  graph: ReturnType<typeof use_git_graph>;
  message: string;
  on_message: (message: string) => void;
  refresh_all: () => void;
  on_refresh: () => void;
}

export function SourceControlPanel(props: SourceControlPanelProps) {
  const { status, graph, message, on_message, refresh_all, on_refresh } = props;
  const [tab, set_tab] = use_persistent_value<TabId>("muxy.git.panel.tab", "branch");
  const changes = status.staged.length + status.unstaged.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center border-b border-border pr-1">
        <div className="min-w-0 flex-1">
          <BranchSwitcher branch={status.branch} ahead={status.ahead} behind={status.behind} />
        </div>
        <button
          type="button"
          title="Refresh"
          onClick={on_refresh}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
        >
          <RefreshCw size={13} strokeWidth={2} />
        </button>
      </header>
      <PanelTabs value={tab} onChange={set_tab} changes={changes} />

      {tab === "branch" && (
        <BranchTab
          status={status}
          stage={props.stage}
          unstage={props.unstage}
          stage_all={props.stage_all}
          unstage_all={props.unstage_all}
          discard={props.discard}
          discard_all={props.discard_all}
          commit={props.commit}
          sync={props.sync}
          message={message}
          on_message={on_message}
        />
      )}
      {tab === "prs" && (
        <PrsTab
          status={status}
          create_pr={props.create_pr}
          pr_actions={props.pr_actions}
          refresh_all={refresh_all}
        />
      )}
      {tab === "history" && (
        <HistoryTab graph={graph} on_message={on_message} refresh_all={refresh_all} />
      )}
    </div>
  );
}
