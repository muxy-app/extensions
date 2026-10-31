export function prRef(number) {
  return `refs/muxy/pr/${number}`;
}

export function fetchStep(number) {
  return ["git", "fetch", "origin", `+refs/pull/${number}/head:${prRef(number)}`];
}

export function branchSteps(number, currentBranch) {
  const branch = `pr/${number}`;
  const steps = [currentBranch === branch ? ["git", "merge", "--ff-only", prRef(number)] : ["git", "branch", "-f", branch, prRef(number)]];
  steps.push(["git", "config", `branch.${branch}.muxy-pr-number`, String(number)]);
  return { branch, steps };
}
