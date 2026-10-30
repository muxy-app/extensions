// Shared panel state, plus the navigation hooks main.js fills in. Views and
// action panels call `nav.*` instead of importing main.js, which keeps the
// module graph acyclic.

export const state = {
  mode: "issues", // issues | mrs
  filter: "opened", // opened | closed | merged | all
  cwd: "", // selected project path; "" follows the active project
  project: null, // GitLab project object for `cwd`
  host: "", // instance hostname, from the git remote
  labels: [], // project labels, for colors and the label picker
  members: [], // project members, for the assignee picker
  currentUser: null, // signed-in glab user for this host, for the "Mine" filter
  mineOnly: false, // MR list filter: only merge requests authored by currentUser
  item: null, // item shown in the detail view
  loading: false,
};

export const nav = {
  list: () => {},
  detail: () => {},
  create: () => {},
};

export const isMR = () => state.mode === "mrs";

/** The glab subcommand group and REST collection for the current mode. */
export const noun = () => (isMR() ? "mr" : "issue");
export const collection = () => (isMR() ? "merge_requests" : "issues");

/** "Merge Request" / "Issue", for user-facing copy. */
export const thing = (capital = true) => {
  const word = isMR() ? "Merge Request" : "Issue";
  return capital ? word : word.toLowerCase();
};
