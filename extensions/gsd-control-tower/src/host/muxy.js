/**
 * Feature-detecting access to the injected Muxy bridge.
 * Every call is guarded so an older/limited host degrades gracefully
 * instead of throwing deep in the UI (NFR-032).
 */

/** Resolve the bridge on webview pages or the background host. */
export function bridge() {
  return globalThis.muxy ?? null;
}

/** Deep feature check, e.g. hasCapability("files.read"). */
export function hasCapability(path) {
  const m = bridge();
  if (!m) return false;
  let node = m;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object" || !(part in node)) return false;
    node = node[part];
  }
  return typeof node === "function";
}

/**
 * Call a bridge method, normalizing outcomes into `{ ok, value, error }`.
 * Permission failures surface as `error.kind = "permission"` so the UI can
 * name the exact missing capability without asking for broader grants (NFR-025).
 */
export async function call(capabilityPath, fn) {
  if (!hasCapability(capabilityPath)) {
    return { ok: false, value: null, error: { kind: "unavailable", message: `Muxy API "${capabilityPath}" is not available in this host` } };
  }
  try {
    const value = await fn();
    return { ok: true, value, error: null };
  } catch (e) {
    const message = String(e?.message ?? e);
    const kind = /permission denied/i.test(message)
      ? "permission"
      : /not found|does not exist/i.test(message)
        ? "missing"
        : "error";
    return { ok: false, value: null, error: { kind, message } };
  }
}

/** Extract the permission name from a `permission denied (<perm>)` message. */
export function deniedPermission(message) {
  const m = /permission denied \(([^)]+)\)/i.exec(String(message));
  return m ? m[1] : null;
}

/**
 * Build a GSD {@link FileSource} over `muxy.files` for one project.
 * Paths stay relative to that project's active worktree root.
 * @param {string} project project id/name/path selector
 */
export function fileSource(project) {
  return {
    /** @returns {Promise<string|null>} */
    async read(path) {
      const res = await call("files.read", () => bridge().files.read(path, { project }));
      if (res.ok) return res.value?.content ?? null;
      // Missing files are a normal outcome during artifact probing.
      if (res.error.kind === "missing" || /no such file|-enoent|not found/i.test(res.error.message)) return null;
      if (/is a directory|illegal operation on a directory/i.test(res.error.message)) return null;
      throw Object.assign(new Error(res.error.message), { kind: res.error.kind });
    },
    /** @returns {Promise<Array<{name:string,path:string,isDirectory:boolean}>|null>} */
    async list(path) {
      const res = await call("files.list", () => bridge().files.list(path === "" ? "." : path, { project }));
      if (res.ok) return Array.isArray(res.value) ? res.value : [];
      if (res.error.kind === "missing" || /no such file|-enoent|not found/i.test(res.error.message)) return null;
      throw Object.assign(new Error(res.error.message), { kind: res.error.kind });
    },
  };
}

/**
 * Normalize an `agents.list()` response into items regardless of wrapper shape.
 * @returns {Array<Record<string, any>>}
 */
export function normalizeAgentItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.agents)) return response.agents;
  if (Array.isArray(response?.items)) return response.items;
  return [];
}
