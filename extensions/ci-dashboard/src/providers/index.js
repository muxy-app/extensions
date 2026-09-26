// Provider registry and fan-out.
//
// Every source is loaded independently and failures are collected rather than
// thrown: one unreachable build server must never blank out the pipelines the
// other sources can still report.

import * as github from "./github.js";
import * as gitlab from "./gitlab.js";
import * as cctray from "./cctray.js";
import { sortRuns } from "../model.js";

const REGISTRY = { github, gitlab, cctray };

export const providerFor = (source) => REGISTRY[source?.kind] || null;

export const capabilitiesFor = (source) => providerFor(source)?.capabilities || {
  jobs: false, logs: false, retry: false, cancel: false, environments: false,
};

export const KIND_LABELS = {
  github: "GitHub Actions",
  gitlab: "GitLab CI",
  cctray: "CCTray",
};

/** The CLI a source needs, or "" when it only needs curl. */
export const KIND_CLI = { github: "gh", gitlab: "glab", cctray: "curl" };

/**
 * Loads runs from every enabled source.
 * Returns `{ runs, errors: [{ sourceId, label, error }] }`.
 */
export async function loadAll(sources, cwd, { branch = "", limit = 30 } = {}) {
  const enabled = (sources || []).filter((s) => s.enabled !== false);
  const settled = await Promise.all(enabled.map(async (source) => {
    const provider = providerFor(source);
    if (!provider) return { source, runs: [], error: new Error(`Unknown source type '${source.kind}'.`) };
    try {
      // Only providers that can filter server-side get the branch; the rest are
      // filtered locally so a CCTray feed without branch data still shows up.
      const runs = await provider.loadRuns(source, cwd, { branch, limit });
      return { source, runs, error: null };
    } catch (error) {
      return { source, runs: [], error };
    }
  }));

  const runs = [];
  const errors = [];
  for (const result of settled) {
    runs.push(...result.runs);
    if (result.error) {
      errors.push({
        sourceId: result.source.id,
        label: labelFor(result.source),
        error: result.error,
      });
    }
  }
  return { runs: sortRuns(runs), errors };
}

export function labelFor(source) {
  return source?.label || KIND_LABELS[source?.kind] || source?.kind || "Source";
}

export async function loadRun(source, cwd, id) {
  const provider = providerFor(source);
  if (!provider?.loadRun) return null;
  return provider.loadRun(source, cwd, id);
}

export async function loadFailureLog(source, cwd, id, run) {
  const provider = providerFor(source);
  if (!provider?.loadFailureLog) return "";
  return provider.loadFailureLog(source, cwd, id, run);
}

export async function retry(source, cwd, id, opts) {
  const provider = providerFor(source);
  if (!provider?.retry) throw new Error("This source cannot retry builds.");
  return provider.retry(source, cwd, id, opts);
}

export async function cancel(source, cwd, id, opts) {
  const provider = providerFor(source);
  if (!provider?.cancel) throw new Error("This source cannot cancel builds.");
  return provider.cancel(source, cwd, id, opts);
}

/** Environments across every source that reports them. */
export async function loadAllEnvironments(sources, cwd) {
  const enabled = (sources || []).filter((s) => s.enabled !== false && capabilitiesFor(s).environments);
  const settled = await Promise.all(enabled.map(async (source) => {
    try {
      const envs = await providerFor(source).loadEnvironments(source, cwd);
      return { source, envs: envs.map((e) => ({ ...e, source: source.id, sourceLabel: labelFor(source) })), error: null };
    } catch (error) {
      return { source, envs: [], error };
    }
  }));

  const environments = [];
  const errors = [];
  for (const result of settled) {
    environments.push(...result.envs);
    if (result.error) {
      errors.push({ sourceId: result.source.id, label: labelFor(result.source), error: result.error });
    }
  }
  environments.sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0));
  return { environments, errors };
}

export { github, gitlab, cctray };
