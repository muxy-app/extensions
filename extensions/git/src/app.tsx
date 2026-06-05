import { useCallback, useEffect, useState } from "react";
import { try_action } from "@/lib/git";
import { use_git_panel } from "@/hooks/use-git-panel";
import { use_git_graph } from "@/hooks/use-git-graph";
import { use_create_pr } from "@/hooks/use-create-pr";
import { use_pr_actions } from "@/hooks/use-pr-actions";
import { NoRepo } from "@/components/no-repo";
import { LoadingOverlay } from "@/components/loading-overlay";
import { SourceControlPanel } from "@/views/source-control-panel";

export function App() {
  const {
    state,
    switching,
    refresh,
    stage,
    unstage,
    stage_all,
    unstage_all,
    discard,
    discard_all,
    commit,
    sync,
  } = use_git_panel();
  const graph = use_git_graph();
  const create = use_create_pr(refresh);
  const pr_actions = use_pr_actions();
  const [refreshing, set_refreshing] = useState(false);
  const [message, set_message] = useState("");

  const commit_and_refresh = async (msg: string) => {
    const ok = await commit(msg);
    if (ok) graph.refresh();
    return ok;
  };

  const refresh_all = () => {
    void refresh();
    graph.refresh();
  };

  const sync_and_refresh = async (op: "push" | "pull") => {
    const ok = await sync(op);
    if (ok) graph.refresh();
    return ok;
  };

  const run_refresh = useCallback(() => {
    set_refreshing(true);
    graph.refresh();
    void Promise.all([refresh(), new Promise((r) => setTimeout(r, 400))]).finally(() =>
      set_refreshing(false),
    );
  }, [refresh, graph]);

  useEffect(() => {
    const off = muxy.events.subscribe("command.refresh-scm", run_refresh);
    return () => off?.();
  }, [run_refresh]);

  async function init() {
    if (await try_action(() => muxy.git.init(), "Could not initialize repository")) {
      void refresh();
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="relative h-screen">
        <LoadingOverlay />
      </div>
    );
  }
  if (state.kind === "no_repo") return <NoRepo onInit={() => void init()} />;

  return (
    <div className="relative flex h-screen flex-col">
      {switching && <LoadingOverlay label="Loading worktree…" />}
      {refreshing && !switching && <LoadingOverlay label="Refreshing…" />}
      <SourceControlPanel
        status={state.status}
        stage={stage}
        unstage={unstage}
        stage_all={stage_all}
        unstage_all={unstage_all}
        discard={discard}
        discard_all={discard_all}
        commit={commit_and_refresh}
        sync={sync_and_refresh}
        create_pr={create}
        pr_actions={pr_actions}
        graph={graph}
        message={message}
        on_message={set_message}
        refresh_all={refresh_all}
        on_refresh={run_refresh}
      />
    </div>
  );
}
