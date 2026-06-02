import { useState } from "react";
import { toast, resolve_cwd, run_git } from "@/lib/git";
import { use_git_panel } from "@/hooks/use-git-panel";
import { use_prs } from "@/hooks/use-prs";
import { NoRepo } from "@/components/no-repo";
import { SourceControlPanel } from "@/views/source-control-panel";
import type { PanelTab } from "@/components/panel-tabs";

export function App() {
  const { state, refresh, run_action, stage, unstage, sync, get_branches, checkout, delete_branch } =
    use_git_panel();
  const [tab, set_tab] = useState<PanelTab>("changes");
  const {
    state: prsState,
    refreshing: prsRefreshing,
    busy,
    refresh: refreshPrs,
    detail,
    checkout_here,
    checkout_worktree,
  } = use_prs(tab === "prs", refresh);

  async function init() {
    const cwd = await resolve_cwd();
    if ((await run_git(cwd, ["init"])).ok) {
      toast("Initialized empty repository");
      refresh();
    }
  }

  if (state.kind === "loading") return null;
  if (state.kind === "no_repo") return <NoRepo onInit={() => void init()} />;
  return (
    <SourceControlPanel
      tab={tab}
      onTabChange={set_tab}
      status={state.status}
      refresh={refresh}
      run_action={run_action}
      stage={stage}
      unstage={unstage}
      sync={sync}
      get_branches={get_branches}
      checkout={checkout}
      delete_branch={delete_branch}
      prs={{
        state: prsState,
        refreshing: prsRefreshing,
        busy,
        refresh: refreshPrs,
        detail,
        checkout_here,
        checkout_worktree,
      }}
    />
  );
}
