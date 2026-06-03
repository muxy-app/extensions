import { useState } from "react";
import { toast, exec_git, active_worktree_path } from "@/lib/git";
import { use_git_panel } from "@/hooks/use-git-panel";
import { use_prs } from "@/hooks/use-prs";
import { NoRepo } from "@/components/no-repo";
import { LoadingOverlay } from "@/components/loading-overlay";
import { SourceControlPanel } from "@/views/source-control-panel";
import type { PanelTab } from "@/components/panel-tabs";

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
    get_branches,
    checkout,
    delete_branch,
    cleanup,
  } = use_git_panel();
  const [tab, set_tab] = useState<PanelTab>("changes");
  const {
    state: prsState,
    refreshing: prsRefreshing,
    busy,
    refresh: refreshPrs,
    checkout_here,
    checkout_worktree,
    merge,
    close: closePr,
    create,
  } = use_prs(tab === "prs", refresh);

  async function init() {
    if (await exec_git(await active_worktree_path(), ["init"], "Could not initialize repository")) {
      toast("Initialized empty repository");
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
    <SourceControlPanel
      tab={tab}
      onTabChange={set_tab}
      status={state.status}
      switching={switching}
      refresh={refresh}
      stage={stage}
      unstage={unstage}
      stage_all={stage_all}
      unstage_all={unstage_all}
      commit={commit}
      sync={sync}
      get_branches={get_branches}
      checkout={checkout}
      delete_branch={delete_branch}
      cleanup={cleanup}
      prs={{
        state: prsState,
        refreshing: prsRefreshing,
        busy,
        refresh: refreshPrs,
        checkout_here,
        checkout_worktree,
        merge,
        close: closePr,
        create,
      }}
    />
  );
}
