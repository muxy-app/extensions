// Shared panel state plus the navigation hooks main.js fills in, so views and
// action handlers never import the controller back.

export const state = {
  view: "runs", // runs | envs | sources
  cwd: "", // selected project path; "" follows the active project
  repoRoot: "", // config key: the repository this panel is configured for
  branch: "", // "" means all branches
  branches: [],
  currentBranch: "",
  config: { sources: [], detectionDismissed: false },
  detection: { native: [], hints: [] },
  runs: [],
  errors: [],
  environments: [],
  envErrors: [],
  run: null, // run shown in the detail view
  loading: false,
};

export const nav = {
  runs: () => {},
  detail: () => {},
  envs: () => {},
  sources: () => {},
  reload: () => {},
};

export const sourceById = (id) => (state.config.sources || []).find((s) => s.id === id) || null;

export const enabledSources = () => (state.config.sources || []).filter((s) => s.enabled !== false);
