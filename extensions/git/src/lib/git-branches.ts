export interface BranchList {
  current: string | null;
  branches: string[];
}

export async function list_branches(): Promise<BranchList> {
  const [branches, current] = await Promise.all([
    muxy.git.branches().catch(() => [] as string[]),
    muxy.git.currentBranch().catch(() => ""),
  ]);
  return { current: current || null, branches };
}
