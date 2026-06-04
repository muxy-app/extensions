import { useEffect, useState } from "react";
import { exec_git, active_worktree_path } from "@/lib/git";
import { use_git_panel } from "@/hooks/use-git-panel";
import { use_create_pr } from "@/hooks/use-create-pr";
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
    commit,
    sync,
  } = use_git_panel();
  const create = use_create_pr(refresh);
  const [refreshing, set_refreshing] = useState(false);

  useEffect(() => {
    const off = muxy.events.subscribe("command.refresh-scm", () => {
      set_refreshing(true);
      void Promise.all([refresh(), new Promise((r) => setTimeout(r, 400))]).finally(() =>
        set_refreshing(false),
      );
    });
    return () => off?.();
  }, [refresh]);

  async function init() {
    if (await exec_git(await active_worktree_path(), ["init"], "Could not initialize repository")) {
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
        commit={commit}
        sync={sync}
        create_pr={create}
      />
    </div>
  );
}
