import { CurlRelay } from "./curl-relay.js";
import { normalizeHermesDashboardUrl } from "./kanban-client.js";

// Keep the complete cookie family Hermes emits. The prefix varies with the
// Dashboard's transport, and the provider cookie is needed to route a later
// authenticated request to the same sign-in provider.
const SESSION_COOKIE = /^(?:(?:__Secure-|__Host-)?hermes_session_(?:at|rt|provider))$/;
const SESSION_COOKIE_VALUE = /^[A-Za-z0-9._~+/%=-]{1,4096}$/;

export class DashboardAuthError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "DashboardAuthError";
    this.code = code;
    this.status = status;
  }
}

function safeText(value, max = 256) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function relayFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return /^relay_[a-z0-9_]{1,96}$/.test(code) ? new DashboardAuthError(code) : null;
}

function normalizeProviders(payload) {
  if (!payload || !Array.isArray(payload.providers)) throw new DashboardAuthError("auth_contract_mismatch");
  const providers = payload.providers.map((provider) => {
    const name = safeText(provider?.name, 64);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return null;
    return Object.freeze({
      name,
      displayName: safeText(provider.display_name, 128) || name,
      supportsPassword: provider.supports_password === true,
    });
  }).filter(Boolean);
  if (!providers.length) throw new DashboardAuthError("auth_contract_mismatch");
  return Object.freeze(providers);
}

function normalizeIdentity(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new DashboardAuthError("auth_contract_mismatch");
  const userId = safeText(payload.user_id, 256);
  const provider = safeText(payload.provider, 64);
  const expiresAt = Number.isSafeInteger(payload.expires_at) ? payload.expires_at : 0;
  if (!userId || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider) || expiresAt <= 0) {
    throw new DashboardAuthError("auth_contract_mismatch");
  }
  return Object.freeze({
    userId,
    email: safeText(payload.email, 320),
    displayName: safeText(payload.display_name, 256),
    organizationId: safeText(payload.org_id, 256),
    provider,
    expiresAt,
  });
}

function loginLabel(identity) {
  return identity.displayName || identity.email || (identity.userId.length > 18 ? `${identity.userId.slice(0, 18)}…` : identity.userId);
}

function normalizeRestoredSession(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.providers) || !Array.isArray(value.cookies)) {
    throw new DashboardAuthError("auth_contract_mismatch");
  }
  const providers = normalizeProviders({ providers: value.providers.map((provider) => ({
    name: provider?.name,
    display_name: provider?.displayName,
    supports_password: provider?.supportsPassword,
  })) });
  const restoredIdentity = normalizeIdentity({
    user_id: value.identity?.userId,
    email: value.identity?.email,
    display_name: value.identity?.displayName,
    org_id: value.identity?.organizationId,
    provider: value.identity?.provider,
    expires_at: value.identity?.expiresAt,
  });
  const cookies = new Map();
  for (const entry of value.cookies) {
    if (!Array.isArray(entry) || entry.length !== 2 || !SESSION_COOKIE.test(entry[0]) || !SESSION_COOKIE_VALUE.test(entry[1])) {
      throw new DashboardAuthError("auth_contract_mismatch");
    }
    cookies.set(entry[0], entry[1]);
  }
  if (![...cookies.keys()].some((name) => name.endsWith("hermes_session_at"))) throw new DashboardAuthError("auth_contract_mismatch");
  return { providers, identity: restoredIdentity, cookies };
}

export class DashboardAuthSession {
  constructor({ baseUrl, relay = new CurlRelay(), now = () => Date.now() } = {}) {
    this.baseUrl = normalizeHermesDashboardUrl(baseUrl);
    this.relay = relay;
    this.now = now;
    this.cookies = new Map();
    this.providers = Object.freeze([]);
    this.requestQueue = Promise.resolve();
    this.snapshot = Object.freeze({ state: "disconnected", providers: this.providers, identity: null, label: "" });
  }

  #serialize(operation) {
    const queued = this.requestQueue.then(operation, operation);
    this.requestQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  #publish(state, identity = null) {
    this.snapshot = Object.freeze({
      state,
      providers: this.providers,
      identity,
      label: identity ? loginLabel(identity) : "",
    });
    return this.snapshot;
  }

  #clear(state = "logged_out") {
    this.cookies.clear();
    return this.#publish(state);
  }

  #mergeCookies(setCookies = []) {
    for (const cookie of setCookies) {
      if (!cookie || !SESSION_COOKIE.test(cookie.name)) continue;
      if (cookie.expired || !cookie.value) this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
  }

  #cookieHeader() {
    return [...this.cookies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}=${value}`).join("; ");
  }

  static fromSession({ baseUrl, session, relay, now } = {}) {
    const auth = new DashboardAuthSession({ baseUrl, relay, now });
    auth.restore(session);
    return auth;
  }

  cookieHeaderForTest() {
    return this.#cookieHeader();
  }

  exportSession() {
    if (this.snapshot.state !== "logged_in" || !this.snapshot.identity || !this.cookies.size) return null;
    return Object.freeze({
      version: 1,
      providers: Object.freeze(this.providers.map((provider) => Object.freeze({ ...provider }))),
      identity: Object.freeze({ ...this.snapshot.identity }),
      cookies: Object.freeze([...this.cookies.entries()].sort(([a], [b]) => a.localeCompare(b)).map((entry) => Object.freeze([...entry]))),
    });
  }

  restore(session) {
    const restored = normalizeRestoredSession(session);
    this.providers = restored.providers;
    this.cookies = restored.cookies;
    return this.#publish("logged_in", restored.identity);
  }

  discover() {
    return this.#serialize(() => this.#discover());
  }

  async #discover() {
    this.#publish("checking");
    const status = await this.relay.requestSessionJson({ url: `${this.baseUrl}/api/status` });
    if (status.status < 200 || status.status >= 300 || !status.body || typeof status.body !== "object") {
      return this.#publish("auth_unavailable");
    }
    if (status.body.auth_required !== true) {
      this.providers = Object.freeze([]);
      return this.#publish("auth_unavailable");
    }
    const providerResponse = await this.relay.requestSessionJson({ url: `${this.baseUrl}/api/auth/providers` });
    if (providerResponse.status < 200 || providerResponse.status >= 300) return this.#publish("auth_unavailable");
    this.providers = normalizeProviders(providerResponse.body);
    const hasPassword = this.providers.some((provider) => provider.supportsPassword);
    return this.#publish(hasPassword ? "logged_out" : "oauth_required");
  }

  login(credentials) {
    return this.#serialize(() => this.#login(credentials));
  }

  async #login({ provider, username, password }) {
    const supported = this.providers.find((candidate) => candidate.name === provider && candidate.supportsPassword);
    if (!supported) throw new DashboardAuthError("password_login_not_supported");
    const safeUsername = typeof username === "string" ? username.trim() : "";
    if (!safeUsername || safeUsername.length > 256 || typeof password !== "string" || !password || password.length > 4096) {
      throw new DashboardAuthError("credentials_invalid");
    }
    this.#clear("checking");
    let response;
    try {
      response = await this.relay.requestSessionJson({
        url: `${this.baseUrl}/auth/password-login`,
        method: "POST",
        body: { provider: supported.name, username: safeUsername, password },
      });
    } catch (error) {
      this.#clear("logged_out");
      const failure = relayFailure(error);
      if (failure) throw failure;
      throw new DashboardAuthError("login_response_unreadable");
    }
    if (response.status === 401 || response.status === 403) {
      this.#clear("logged_out");
      throw new DashboardAuthError("invalid_credentials", response.status);
    }
    if (response.status === 429) {
      this.#clear("logged_out");
      throw new DashboardAuthError("login_rate_limited", response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      this.#clear("logged_out");
      throw new DashboardAuthError("login_failed", response.status);
    }
    this.#mergeCookies(response.setCookies);
    if (![...this.cookies.keys()].some((name) => name.endsWith("hermes_session_at"))) {
      this.#clear("logged_out");
      throw new DashboardAuthError("auth_contract_mismatch", response.status);
    }
    return this.#verifyUnlocked();
  }

  verify() {
    return this.#serialize(() => this.#verifyUnlocked());
  }

  async #verifyUnlocked() {
    const cookie = this.#cookieHeader();
    if (!cookie) {
      this.#clear("logged_out");
      throw new DashboardAuthError("session_expired", 401);
    }
    const response = await this.relay.requestSessionJson({ url: `${this.baseUrl}/api/auth/me`, cookie });
    this.#mergeCookies(response.setCookies);
    if (response.status === 401 || response.status === 403) {
      this.#clear("session_expired");
      throw new DashboardAuthError("session_expired", response.status);
    }
    if (response.status < 200 || response.status >= 300) throw new DashboardAuthError("session_check_failed", response.status);
    const identity = normalizeIdentity(response.body);
    if (identity.expiresAt * 1000 <= this.now()) {
      this.#clear("session_expired");
      throw new DashboardAuthError("session_expired", 401);
    }
    return this.#publish("logged_in", identity);
  }

  requestJson(request) {
    return this.#serialize(() => this.#requestJson(request));
  }

  async #requestJson({ url, method = "GET", body = null }) {
    // The identity timestamp describes the current access token, but Hermes may
    // rotate that token from the refresh cookie during this request. Let the
    // Dashboard make the authoritative decision instead of logging the user out
    // locally before it has a chance to refresh the session.
    if (this.snapshot.state !== "logged_in" || !this.snapshot.identity || !this.#cookieHeader()) {
      this.#clear("session_expired");
      throw new DashboardAuthError("session_expired", 401);
    }
    const response = await this.relay.requestSessionJson({ url, method, body, cookie: this.#cookieHeader() });
    this.#mergeCookies(response.setCookies);
    if (response.status === 401 || response.status === 403) {
      this.#clear("session_expired");
      throw new DashboardAuthError("session_expired", response.status);
    }
    return response;
  }

  async requestWebSocketTicket() {
    let response;
    try {
      response = await this.requestJson({
        url: `${this.baseUrl}/api/auth/ws-ticket`,
        method: "POST",
      });
    } catch (error) {
      if (error instanceof DashboardAuthError) throw error;
      const failure = relayFailure(error);
      if (failure) throw failure;
      throw new DashboardAuthError("websocket_ticket_failed");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new DashboardAuthError("websocket_ticket_failed", response.status);
    }
    const ticket = safeText(response.body?.ticket, 513);
    const ttlSeconds = response.body?.ttl_seconds;
    if (!/^[A-Za-z0-9_-]{16,512}$/.test(ticket)
      || !Number.isSafeInteger(ttlSeconds)
      || ttlSeconds < 1
      || ttlSeconds > 300) {
      throw new DashboardAuthError("auth_contract_mismatch", response.status);
    }
    return Object.freeze({ ticket, ttlSeconds });
  }

  logout() {
    return this.#serialize(() => this.#logout());
  }

  async #logout() {
    const cookie = this.#cookieHeader();
    try {
      if (cookie) await this.relay.requestSessionJson({ url: `${this.baseUrl}/auth/logout`, cookie, method: "POST" });
    } finally {
      this.#clear("logged_out");
    }
    return this.snapshot;
  }

  release() {
    this.#clear("logged_out");
  }
}
