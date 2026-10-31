export function baseOptions(branches, current, defaultBranch) {
  const keep = (name) => name && (name !== current || name === defaultBranch);
  return [...new Set([defaultBranch, ...branches].filter(keep))];
}
