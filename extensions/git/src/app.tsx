import { toast, resolve_cwd, run_git } from "@/lib/git";
import { use_git_panel } from "@/hooks/use-git-panel";
import { NoRepo } from "@/components/no-repo";
import { SourceControlPanel } from "@/views/source-control-panel";

export function App() {
  const { state, refresh, run_action, stage, unstage, sync, get_branches, checkout, delete_branch } =
    use_git_panel();

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
      status={state.status}
      refresh={refresh}
      run_action={run_action}
      stage={stage}
      unstage={unstage}
      sync={sync}
      get_branches={get_branches}
      checkout={checkout}
      delete_branch={delete_branch}
    />
  );
}
