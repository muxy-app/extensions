import { run_git } from "@/lib/git";

export interface BranchList {
  current: string | null;
  branches: string[];
}

export async function list_branches(cwd: string | undefined): Promise<BranchList> {
  const res = await run_git(
    cwd,
    ["for-each-ref", "--format=%(HEAD)%(refname:short)", "refs/heads"],
    { quiet: true },
  );
  if (!res.ok) return { current: null, branches: [] };

  let current: string | null = null;
  const branches: string[] = [];
  for (const line of res.stdout.split("\n")) {
    if (!line) continue;
    const is_current = line[0] === "*";
    const name = line.slice(1);
    if (is_current) current = name;
    branches.push(name);
  }
  return { current, branches };
}
