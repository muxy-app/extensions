import { parseFixture } from "./fixture.mjs";
import { providerFetchers } from "./live-providers.mjs";
import { makeRuntimeContext } from "./live-runtime.mjs";

export async function fetchLiveSnapshots({ exec, fixture = "", providerIDs = null } = {}) {
  if (fixture) return parseFixture(fixture);
  if (!exec) return [];
  const context = await makeRuntimeContext(exec);
  const allowed = providerIDs ? new Set(providerIDs) : null;
  const fetchers = allowed ? providerFetchers.filter((entry) => allowed.has(entry.id)) : providerFetchers;
  return (await Promise.all(fetchers.map((entry) => entry.fetch(context)))).filter(Boolean);
}
