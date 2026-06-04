export function pr_state(pr: { state: string }): "open" | "closed" | "merged" {
  const s = pr.state.toLowerCase();
  if (s === "merged") return "merged";
  if (s === "closed") return "closed";
  return "open";
}

export type MergeMethod = "merge" | "squash" | "rebase";

export function merge_pr(
  number: number,
  method: MergeMethod,
  deleteBranch: boolean,
): Promise<void> {
  return muxy.git.pr.merge({ number, method, deleteBranch });
}

export function close_pr(number: number): Promise<void> {
  return muxy.git.pr.close({ number });
}

export function create_pr(
  title: string,
  body: string,
  baseBranch: string | undefined,
  draft: boolean,
): Promise<MuxyGitPR> {
  return muxy.git.pr.create({ title, body, baseBranch, draft });
}
