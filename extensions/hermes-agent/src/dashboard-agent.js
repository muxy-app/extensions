import { DashboardGatewayError } from "./dashboard-gateway.js";

const SESSION_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);
const MAX_ASSISTANT_CHARS = 128 * 1024;
const MAX_ACTIVITY = 100;
const ACTIVE_STATES = new Set(["starting", "running", "waiting_for_approval", "stopping"]);

function safeText(value, max = 512) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function safeSession(result) {
  const runtimeId = safeText(result?.session_id, 256);
  const storedId = safeText(result?.stored_session_id ?? result?.session_key, 256) || null;
  if (!SESSION_ID.test(runtimeId) || (storedId !== null && !SESSION_ID.test(storedId))) {
    throw new DashboardGatewayError("rpc_contract_mismatch");
  }
  return { runtimeId, storedId };
}

function approvalFrom(payload) {
  const rawChoices = Array.isArray(payload?.choices)
    ? payload.choices
    : payload?.smart_denied === true
      ? ["once", "deny"]
      : [
        "once",
        ...(payload?.allow_session === false ? [] : ["session"]),
        ...(payload?.allow_permanent === false ? [] : ["always"]),
        "deny",
      ];
  const choices = [...new Set(rawChoices.filter((choice) => APPROVAL_CHOICES.has(choice)))];
  if (!choices.includes("deny")) choices.push("deny");
  return Object.freeze({
    tool: safeText(payload?.description ?? payload?.tool_name ?? payload?.name, 128) || "Hermes tool",
    command: safeText(payload?.command ?? payload?.args?.command, 4_096),
    choices: Object.freeze(choices),
  });
}

export class DashboardAgentController {
  constructor({ gateway } = {}) {
    if (!gateway?.request || !gateway?.onEvent || !gateway?.subscribe) throw new Error("gateway_required");
    this.gateway = gateway;
    this.runGeneration = 0;
    this.listeners = new Set();
    this.session = null;
    this.gatewaySnapshot = gateway.snapshot;
    this.snapshot = Object.freeze({
      status: "idle",
      connectionState: gateway.snapshot?.state ?? "disconnected",
      request: "",
      assistant: "",
      activity: Object.freeze([]),
      pendingApproval: null,
      error: "",
      actionPending: false,
    });
    this.unsubscribeGateway = gateway.subscribe((next) => {
      this.gatewaySnapshot = next;
      this.#publish({ connectionState: next.state });
    });
    this.unsubscribeEvents = gateway.onEvent((event) => this.#handleEvent(event));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  #publish(patch) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener(this.snapshot);
    return this.snapshot;
  }

  #activity(kind, label, detail = "") {
    const activity = [...this.snapshot.activity, Object.freeze({ kind, label: safeText(label, 128), detail: safeText(detail, 1_024) })]
      .slice(-MAX_ACTIVITY);
    this.#publish({ activity: Object.freeze(activity) });
  }

  async start(input) {
    const text = typeof input === "string" ? input.trim() : "";
    if (!text || text.length > 64 * 1024) throw new Error("invalid_prompt");
    if (this.gatewaySnapshot.state !== "connected") throw new DashboardGatewayError("not_connected", { retryable: true });
    this.runGeneration += 1;
    this.#publish({
      status: "starting",
      request: text,
      assistant: "",
      activity: Object.freeze([]),
      pendingApproval: null,
      error: "",
      actionPending: true,
    });
    try {
      if (!this.session) {
        const created = safeSession(await this.gateway.request("session.create", { close_on_disconnect: false }));
        this.session = created;
        this.gateway.setActiveSession(created);
      }
      this.#publish({ status: "running", actionPending: false });
      await this.gateway.request("prompt.submit", { session_id: this.session.runtimeId, text });
    } catch (error) {
      this.#publish({ status: "failed", actionPending: false, error: "Hermes could not start this request." });
      throw error;
    }
  }

  #handleEvent(event) {
    if (event.type === "gateway.session_lost") {
      this.session = null;
      this.#publish({
        status: "idle",
        request: "",
        assistant: "",
        activity: Object.freeze([]),
        pendingApproval: null,
        actionPending: false,
        error: "The previous Hermes session ended. You can start a new request.",
      });
      return;
    }
    if (event.type === "gateway.reattached") {
      const active = this.gateway.getActiveSession();
      if (active) this.session = active;
      this.#publish({ status: event.payload.running ? "running" : this.snapshot.status === "running" ? "completed" : this.snapshot.status });
      return;
    }
    if (!this.session || event.sessionId !== this.session.runtimeId) return;
    const payload = event.payload ?? {};
    switch (event.type) {
      case "message.delta": {
        const delta = safeText(payload.text, 16 * 1024);
        if (delta) this.#publish({ assistant: `${this.snapshot.assistant}${delta}`.slice(0, MAX_ASSISTANT_CHARS) });
        break;
      }
      case "message.complete": {
        const response = safeText(payload.text ?? payload.response, MAX_ASSISTANT_CHARS);
        this.#publish({
          status: "completed",
          assistant: this.snapshot.assistant || response,
          pendingApproval: null,
          actionPending: false,
        });
        break;
      }
      case "tool.start":
        this.#activity("tool", safeText(payload.name, 128) || "Tool started");
        break;
      case "tool.progress":
        this.#activity("tool", safeText(payload.name, 128) || "Tool working", safeText(payload.preview, 1_024));
        break;
      case "tool.complete":
        this.#activity("tool", safeText(payload.name, 128) || "Tool finished", safeText(payload.summary, 1_024));
        break;
      case "approval.request":
        this.#publish({ status: "waiting_for_approval", pendingApproval: approvalFrom(payload), actionPending: false });
        break;
      case "error":
        this.#publish({ status: "failed", pendingApproval: null, actionPending: false, error: "Hermes could not complete this request." });
        break;
      default:
        break;
    }
  }

  async approve(choice) {
    if (!this.session || !this.snapshot.pendingApproval || !APPROVAL_CHOICES.has(choice)) throw new Error("invalid_approval_choice");
    this.#publish({ actionPending: true });
    try {
      await this.gateway.request("approval.respond", { session_id: this.session.runtimeId, choice });
      this.#publish({ status: "running", pendingApproval: null, actionPending: false });
    } catch (error) {
      this.#publish({ actionPending: false, error: "Hermes could not send that approval response." });
      throw error;
    }
  }

  async steer(input) {
    const text = typeof input === "string" ? input.trim() : "";
    if (!this.session || !text || text.length > 64 * 1024) throw new Error("invalid_steer");
    this.#publish({ actionPending: true });
    try {
      await this.gateway.request("session.steer", { session_id: this.session.runtimeId, text });
      this.#activity("steer", "Guidance queued", text);
      this.#publish({ actionPending: false });
    } catch (error) {
      this.#publish({ actionPending: false, error: "Hermes could not add that guidance." });
      throw error;
    }
  }

  async stop() {
    if (!this.session) return null;
    this.#publish({ status: "stopping", actionPending: true });
    try {
      const result = await this.gateway.request("session.interrupt", { session_id: this.session.runtimeId });
      this.#publish({ actionPending: false });
      return result;
    } catch (error) {
      this.#publish({ status: "running", actionPending: false, error: "Hermes could not stop this request." });
      throw error;
    }
  }

  reset() {
    if (ACTIVE_STATES.has(this.snapshot.status)) return false;
    this.#publish({
      status: "idle",
      request: "",
      assistant: "",
      activity: Object.freeze([]),
      pendingApproval: null,
      error: "",
      actionPending: false,
    });
    return true;
  }

  release() {
    this.unsubscribeGateway?.();
    this.unsubscribeEvents?.();
    this.listeners.clear();
  }
}
