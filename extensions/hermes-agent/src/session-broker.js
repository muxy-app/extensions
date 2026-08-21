const GATEWAY_STORAGE_KEY = "session.gateway.v1";
const DASHBOARD_STORAGE_KEY = "session.dashboard.v1";
const COOKIE_NAME = /^(?:(?:__Secure-|__Host-)?hermes_session_(?:at|rt|provider))$/;
const COOKIE_VALUE = /^[A-Za-z0-9._~+/%=-]{1,4096}$/;
const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function safeText(value, max = 256) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function baseUrl(value) {
  let parsed;
  try { parsed = new URL(String(value ?? "").trim()); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  return parsed.toString().replace(/\/$/, "");
}

function boardSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) ? slug : null;
}

function provider(value) {
  const name = safeText(value?.name, 64);
  if (!PROVIDER.test(name)) return null;
  return { name, displayName: safeText(value?.displayName, 128) || name, supportsPassword: value.supportsPassword === true };
}

function identity(value) {
  const userId = safeText(value?.userId, 256);
  const providerName = safeText(value?.provider, 64);
  if (!userId || !PROVIDER.test(providerName) || !Number.isSafeInteger(value?.expiresAt) || value.expiresAt <= 0) return null;
  return {
    userId,
    email: safeText(value.email, 320),
    displayName: safeText(value.displayName, 256),
    organizationId: safeText(value.organizationId, 256),
    provider: providerName,
    expiresAt: value.expiresAt,
  };
}

function dashboardSession(value) {
  const dashboardUrl = baseUrl(value?.baseUrl);
  const board = value?.board == null || value?.board === "" ? null : boardSlug(value?.board);
  const auth = value?.auth;
  if (!dashboardUrl || !auth || auth.version !== 1 || !Array.isArray(auth.cookies) || !Array.isArray(auth.providers)) return null;
  const providers = auth.providers.map(provider).filter(Boolean);
  const user = identity(auth.identity);
  const cookies = [];
  for (const entry of auth.cookies) {
    if (!Array.isArray(entry) || entry.length !== 2 || !COOKIE_NAME.test(entry[0]) || !COOKIE_VALUE.test(entry[1])) return null;
    cookies.push([entry[0], entry[1]]);
  }
  if (!providers.length || !user || !cookies.some(([name]) => name.endsWith("hermes_session_at"))) return null;
  return { baseUrl: dashboardUrl, board, auth: { version: 1, providers, identity: user, cookies } };
}

export class PersistentSessionBroker {
  constructor({ storage = globalThis.muxy?.storage } = {}) {
    this.storage = storage;
  }

  async #read(key, validate) {
    if (!this.storage?.get) return null;
    const stored = await Promise.resolve(this.storage.get(key));
    if (stored == null) return null;
    const value = validate(stored);
    if (value) return clone(value);
    await Promise.resolve(this.storage.delete?.(key));
    return null;
  }

  async #save(key, value) {
    if (!this.storage?.set) return false;
    await Promise.resolve(this.storage.set(key, clone(value)));
    return true;
  }

  async #clear(key) {
    if (!this.storage?.delete) return false;
    await Promise.resolve(this.storage.delete(key));
    return true;
  }

  async handle(request) {
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (!requestId) return { requestId, ok: false, data: null };
    switch (request.action) {
      case "gateway.read":
        await this.#clear(GATEWAY_STORAGE_KEY);
        return { requestId, ok: true, data: null };
      case "gateway.clear":
        return { requestId, ok: await this.#clear(GATEWAY_STORAGE_KEY), data: null };
      case "dashboard.read": return { requestId, ok: true, data: await this.#read(DASHBOARD_STORAGE_KEY, dashboardSession) };
      case "dashboard.save": {
        const value = dashboardSession(request.data);
        if (!value) return { requestId, ok: false, data: null };
        return { requestId, ok: await this.#save(DASHBOARD_STORAGE_KEY, value), data: null };
      }
      case "dashboard.clear":
        return { requestId, ok: await this.#clear(DASHBOARD_STORAGE_KEY), data: null };
      default: return { requestId, ok: false, data: null };
    }
  }
}

export class SessionBrokerClient {
  constructor({ storage = globalThis.window?.muxy?.storage ?? globalThis.muxy?.storage, broker, randomId = () => globalThis.crypto.randomUUID() } = {}) {
    this.broker = broker ?? new PersistentSessionBroker({ storage });
    this.randomId = randomId;
  }

  async clearGateway() { return this.#request("gateway.clear"); }
  async readDashboard() { return this.#request("dashboard.read"); }
  async saveDashboard(data) { return this.#request("dashboard.save", data); }
  async clearDashboard() { return this.#request("dashboard.clear"); }

  #request(action, data = null) {
    const requestId = this.randomId();
    return Promise.resolve(this.broker.handle({ requestId, action, data }))
      .then((response) => response?.requestId === requestId && response.ok === true ? clone(response.data) : null)
      .catch(() => null);
  }
}
