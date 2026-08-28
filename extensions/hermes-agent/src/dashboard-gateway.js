import { DashboardAuthError } from "./dashboard-auth.js";
import { normalizeHermesDashboardUrl } from "./kanban-client.js";

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const SESSION_MISSING_CODES = new Set([4001, 4006, 4007]);
const ALLOWED_METHODS = new Set([
  "session.create",
  "session.activate",
  "session.resume",
  "session.history",
  "session.status",
  "prompt.submit",
  "approval.respond",
  "session.steer",
  "session.interrupt",
]);

function safeText(value, max = 256) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

function isSocketOpen(socket, WebSocketImpl) {
  return Boolean(socket) && socket.readyState === (WebSocketImpl.OPEN ?? 1);
}

export class DashboardGatewayError extends Error {
  constructor(code, { rpcCode = null, retryable = false } = {}) {
    super(code);
    this.name = "DashboardGatewayError";
    this.code = code;
    this.rpcCode = rpcCode;
    this.retryable = retryable;
  }
}

export function buildDashboardWebSocketUrl(baseUrl, ticket) {
  const normalized = normalizeHermesDashboardUrl(baseUrl);
  if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(ticket)) {
    throw new DashboardGatewayError("invalid_websocket_ticket");
  }
  const url = new URL(normalized);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/ws";
  url.search = "";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export class DashboardGatewayClient {
  constructor({
    authSession,
    WebSocketImpl = globalThis.WebSocket,
    persistSession = async () => {},
    reconnectDelays = [0, 500, 1_500, 3_000, 5_000],
    connectTimeoutMs = 15_000,
    requestTimeoutMs = 120_000,
    promptTimeoutMs = 30 * 60 * 1000,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
  } = {}) {
    if (!authSession?.requestWebSocketTicket) throw new DashboardGatewayError("dashboard_session_required");
    if (typeof WebSocketImpl !== "function") throw new DashboardGatewayError("websocket_unavailable");
    this.authSession = authSession;
    this.WebSocketImpl = WebSocketImpl;
    this.persistSession = persistSession;
    this.reconnectDelays = reconnectDelays.length ? reconnectDelays.map((value) => Math.max(0, Number(value) || 0)) : [0];
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.promptTimeoutMs = promptTimeoutMs;
    // WebKit's Window timers are host methods. Keep the injected functions
    // callable without rebinding their receiver to this client instance.
    this.setTimer = (...args) => setTimer(...args);
    this.clearTimer = (...args) => clearTimer(...args);
    this.listeners = new Set();
    this.eventListeners = new Set();
    this.pending = new Map();
    this.socket = null;
    this.connectPromise = null;
    this.reconnectTimer = null;
    this.generation = 0;
    this.requestSequence = 0;
    this.reconnectAttempt = 0;
    this.failureGeneration = null;
    this.manualClose = false;
    this.activeSession = null;
    this.snapshot = Object.freeze({ state: "disconnected", attempt: 0, retryInMs: null, reason: null });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  #publish(state, { retryInMs = null, reason = null } = {}) {
    this.snapshot = Object.freeze({ state, attempt: this.reconnectAttempt, retryInMs, reason });
    // A panel render failure must not turn a healthy Gateway connection into a
    // network failure. Subscribers own their presentation errors.
    for (const listener of this.listeners) {
      try { listener(this.snapshot); } catch { /* keep transport ownership here */ }
    }
    return this.snapshot;
  }

  #emit(event) {
    for (const listener of this.eventListeners) {
      try { listener(event); } catch { /* one consumer cannot starve the others */ }
    }
  }

  setActiveSession({ runtimeId, storedId = null } = {}) {
    if (!SESSION_ID.test(runtimeId ?? "") || (storedId !== null && !SESSION_ID.test(storedId))) {
      throw new DashboardGatewayError("invalid_session_id");
    }
    this.activeSession = Object.freeze({ runtimeId, storedId });
  }

  clearActiveSession() {
    this.activeSession = null;
  }

  getActiveSession() {
    return this.activeSession ? { ...this.activeSession } : null;
  }

  async connect() {
    this.manualClose = false;
    if (isSocketOpen(this.socket, this.WebSocketImpl) && this.snapshot.state === "connected") return this.snapshot;
    if (this.connectPromise) return this.connectPromise;
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const generation = ++this.generation;
    this.failureGeneration = null;
    const reconnecting = this.reconnectAttempt > 0;
    this.#publish(reconnecting ? "reconnecting" : "connecting");
    const operation = this.#open(generation);
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) this.connectPromise = null;
    }
  }

  async reconnectNow() {
    if (this.snapshot.state === "signed_out") return this.snapshot;
    if (isSocketOpen(this.socket, this.WebSocketImpl)) return this.snapshot;
    return this.connect();
  }

  async #open(generation) {
    let ticket = "";
    let socket = null;
    try {
      const minted = await this.authSession.requestWebSocketTicket();
      ticket = minted.ticket;
      await Promise.resolve(this.persistSession(this.authSession.exportSession?.() ?? null)).catch(() => {});
      if (generation !== this.generation || this.manualClose) throw new DashboardGatewayError("connection_cancelled");
      let url = buildDashboardWebSocketUrl(this.authSession.baseUrl, ticket);
      socket = new this.WebSocketImpl(url);
      // The URL must contain the one-shot credential for the browser upgrade,
      // but the client retains neither the ticket nor its URL after construction.
      ticket = "";
      url = "";
      this.socket = socket;
      await this.#awaitOpen(socket, generation);
      if (generation !== this.generation || this.manualClose) throw new DashboardGatewayError("connection_cancelled");
      await this.#reattachSession();
      this.reconnectAttempt = 0;
      this.failureGeneration = null;
      return this.#publish("connected");
    } catch (error) {
      ticket = "";
      if (socket && this.socket === socket) {
        this.socket = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState < (this.WebSocketImpl.CLOSING ?? 2)) {
          try { socket.close(1011, "connection failed"); } catch { /* best-effort cleanup */ }
        }
        this.#rejectPending(new DashboardGatewayError("connection_failed", { retryable: true }));
      }
      if (error instanceof DashboardAuthError && error.code === "session_expired") {
        this.manualClose = true;
        this.#rejectPending(new DashboardGatewayError("session_expired"));
        return this.#publish("signed_out", { reason: "session_expired" });
      }
      if (error?.code === "connection_cancelled") return this.snapshot;
      if (!this.manualClose && generation === this.generation && this.failureGeneration !== generation) {
        const reason = error instanceof DashboardAuthError || error instanceof DashboardGatewayError
          ? error.code
          : "connection_failed";
        this.#scheduleReconnect(generation, reason);
      }
      throw error instanceof DashboardGatewayError
        ? error
        : new DashboardGatewayError("connection_failed", { retryable: true });
    }
  }

  #awaitOpen(socket, generation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const listen = (type, listener, options) => {
        if (typeof socket.addEventListener === "function") {
          socket.addEventListener(type, listener, options);
          return () => socket.removeEventListener?.(type, listener, options);
        }
        const property = `on${type}`;
        socket[property] = listener;
        return () => { if (socket[property] === listener) socket[property] = null; };
      };
      let removeOpen = () => {};
      let removeError = () => {};
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeout !== null) this.clearTimer(timeout);
        removeOpen();
        removeError();
        callback(value);
      };
      listen("message", (event) => this.#receive(event?.data));
      listen("close", (event) => {
        settle(reject, new DashboardGatewayError("connection_closed", { retryable: true }));
        this.#handleClose(socket, generation, event?.code);
      });
      removeOpen = listen("open", () => settle(resolve), { once: true });
      removeError = listen("error", () => {
        if (!isSocketOpen(socket, this.WebSocketImpl)) {
          settle(reject, new DashboardGatewayError("connection_failed", { retryable: true }));
        }
      }, { once: true });
      timeout = this.setTimer(() => {
        settle(reject, new DashboardGatewayError("connection_timeout", { retryable: true }));
      }, this.connectTimeoutMs);
    });
  }

  #handleClose(socket, generation, closeCode = 0) {
    const ownedSocket = this.socket === socket;
    if (ownedSocket) this.socket = null;
    this.#rejectPending(new DashboardGatewayError("connection_closed", { retryable: true }));
    if (!ownedSocket || this.manualClose || generation !== this.generation || this.snapshot.state === "signed_out") return;
    const reason = closeCode === 4401
      ? "connection_auth_rejected"
      : closeCode === 4403
        ? "connection_not_allowed"
        : "connection_closed";
    this.#scheduleReconnect(generation, reason);
  }

  #scheduleReconnect(generation, reason) {
    if (this.reconnectTimer !== null || this.manualClose || generation !== this.generation) return;
    this.failureGeneration = generation;
    this.reconnectAttempt += 1;
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempt - 1, this.reconnectDelays.length - 1)];
    this.#publish("offline", { retryInMs: delay, reason });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {});
    }, delay);
  }

  async #reattachSession() {
    if (!this.activeSession) return;
    const previous = this.activeSession;
    try {
      const result = await this.#request("session.activate", { session_id: previous.runtimeId }, true);
      this.#acceptReattached(result, previous.storedId);
    } catch (error) {
      if (!(error instanceof DashboardGatewayError) || !SESSION_MISSING_CODES.has(error.rpcCode) || !previous.storedId) throw error;
      try {
        const result = await this.#request("session.resume", {
          session_id: previous.storedId,
          close_on_disconnect: false,
        }, true);
        this.#acceptReattached(result, previous.storedId);
      } catch (resumeError) {
        if (!(resumeError instanceof DashboardGatewayError) || !SESSION_MISSING_CODES.has(resumeError.rpcCode)) throw resumeError;
        this.activeSession = null;
        this.#emit(Object.freeze({ type: "gateway.session_lost", sessionId: previous.runtimeId, payload: Object.freeze({}) }));
      }
    }
  }

  #acceptReattached(result, fallbackStoredId) {
    const runtimeId = safeText(result?.session_id, 256);
    const storedId = safeText(result?.session_key ?? result?.resumed ?? fallbackStoredId, 256) || null;
    if (!SESSION_ID.test(runtimeId) || (storedId !== null && !SESSION_ID.test(storedId))) {
      throw new DashboardGatewayError("rpc_contract_mismatch");
    }
    this.activeSession = Object.freeze({ runtimeId, storedId });
    this.#emit(Object.freeze({
      type: "gateway.reattached",
      sessionId: runtimeId,
      payload: Object.freeze({
        running: result?.running === true || result?.status === "streaming",
        status: safeText(result?.status, 32),
      }),
    }));
  }

  request(method, params = {}) {
    return this.#request(method, params, false);
  }

  #request(method, params, allowConnecting) {
    if (!ALLOWED_METHODS.has(method)) return Promise.reject(new DashboardGatewayError("rpc_method_not_allowed"));
    if (!isSocketOpen(this.socket, this.WebSocketImpl)
      || (!allowConnecting && this.snapshot.state !== "connected")) {
      return Promise.reject(new DashboardGatewayError("not_connected", { retryable: true }));
    }
    const id = `m${++this.requestSequence}`;
    const serialized = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    if (byteLength(serialized) > MAX_REQUEST_BYTES) return Promise.reject(new DashboardGatewayError("rpc_request_too_large"));
    return new Promise((resolve, reject) => {
      const requestTimeoutMs = method === "prompt.submit" ? this.promptTimeoutMs : this.requestTimeoutMs;
      const timer = this.setTimer(() => {
        this.pending.delete(id);
        reject(new DashboardGatewayError("rpc_timeout", { retryable: true }));
      }, requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(serialized);
      } catch {
        this.pending.delete(id);
        this.clearTimer(timer);
        reject(new DashboardGatewayError("connection_closed", { retryable: true }));
      }
    });
  }

  #receive(raw) {
    if (typeof raw !== "string" || byteLength(raw) > MAX_FRAME_BYTES) {
      this.socket?.close?.(1009, "message too large");
      return;
    }
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") return;
    if (typeof message.id === "string" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      this.clearTimer(pending.timer);
      if (message.error && typeof message.error === "object") {
        pending.reject(new DashboardGatewayError("rpc_rejected", {
          rpcCode: Number.isSafeInteger(message.error.code) ? message.error.code : null,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method !== "event" || !message.params || typeof message.params !== "object") return;
    const type = safeText(message.params.type, 128);
    const sessionId = safeText(message.params.session_id, 256);
    if (!/^[a-z0-9._-]{1,128}$/i.test(type) || (sessionId && !SESSION_ID.test(sessionId))) return;
    const payload = message.params.payload && typeof message.params.payload === "object" && !Array.isArray(message.params.payload)
      ? message.params.payload
      : {};
    this.#emit(Object.freeze({ type, sessionId, payload }));
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      this.clearTimer(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async disconnect() {
    this.manualClose = true;
    this.generation += 1;
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.#rejectPending(new DashboardGatewayError("connection_closed"));
    if (socket && socket.readyState < (this.WebSocketImpl.CLOSING ?? 2)) socket.close(1000, "panel closed");
    this.connectPromise = null;
    return this.#publish("disconnected");
  }
}
