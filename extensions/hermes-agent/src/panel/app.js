import { clear, h } from "@/lib/dom";
import { DashboardAgentController } from "@/dashboard-agent";
import { DashboardAuthError, DashboardAuthSession } from "@/dashboard-auth";
import { DashboardGatewayClient, DashboardGatewayError } from "@/dashboard-gateway";
import { DashboardOperationsClient, emptyOperationsSnapshot } from "@/dashboard-operations";
import { normalizeHermesDashboardUrl } from "@/kanban-client";
import { icon } from "@/lib/icons";
import { openProjectBoardTab } from "@/muxy-tabs";
import { SessionBrokerClient } from "@/session-broker";
import { requestConfirmedStop } from "@/stop-confirmation";

const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const OPERATIONS_REFRESH_INTERVAL_MS = 30 * 1000;
const ACTIVE_AGENT_STATES = new Set(["starting", "running", "waiting_for_approval", "stopping"]);
const STARTER_PROMPTS = Object.freeze([
  Object.freeze({
    title: "Review my queue",
    prompt: "Review my Hermes task queue and tell me what needs attention first.",
  }),
  Object.freeze({
    title: "Check scheduled jobs",
    prompt: "Review my Hermes scheduled jobs and help me investigate anything that is failing.",
  }),
]);

function emptyAuthSnapshot() {
  return Object.freeze({ state: "disconnected", providers: Object.freeze([]), identity: null, label: "" });
}

function emptyAgentSnapshot() {
  return Object.freeze({
    status: "idle",
    connectionState: "disconnected",
    request: "",
    assistant: "",
    activity: Object.freeze([]),
    pendingApproval: null,
    error: "",
    actionPending: false,
  });
}

function authErrorCopy(error) {
  if (error instanceof DashboardAuthError && error.code === "invalid_credentials") return "Hermes rejected those credentials. Check them and try again.";
  if (error instanceof DashboardAuthError && error.code === "login_rate_limited") return "Too many sign-in attempts. Wait a moment, then try again.";
  if (error instanceof DashboardAuthError && error.code === "session_expired") return "Your Hermes sign-in expired. Sign in again to continue.";
  if (error instanceof DashboardAuthError && error.code === "password_login_not_supported") return "This Hermes sign-in method is not available here yet.";
  if (error instanceof DashboardAuthError && error.code === "auth_contract_mismatch") return "This Hermes sign-in setup is not supported by this extension.";
  if (error instanceof DashboardAuthError && error.code === "login_response_unreadable") return "Hermes accepted the sign-in, but the returned session could not be used.";
  if (error instanceof DashboardAuthError && error.code === "session_check_failed") return "Hermes could not verify your sign-in. Try again when it is reachable.";
  if (error instanceof DashboardGatewayError && error.code === "websocket_unavailable") return "This Muxy workspace did not provide the WebSocket support required for live agent work.";
  if (error instanceof DashboardGatewayError && error.code === "operations_setup_failed") return "Muxy could not prepare Hermes operations in this workspace.";
  if (error instanceof DashboardGatewayError && error.code === "agent_setup_failed") return "Muxy could not prepare live Hermes agent controls in this workspace.";
  if (error instanceof DashboardGatewayError && error.code === "panel_subscription_failed") return "Muxy could not attach the Hermes panel to this workspace.";
  if (error instanceof DashboardGatewayError) return "Muxy could not prepare the live Hermes connection in this workspace.";
  if (error?.code === "relay_timeout") return "The Hermes request timed out in this workspace.";
  if (error?.code === "relay_protocol_error") return "Muxy received a Hermes response it could not safely read in this workspace.";
  if (error?.code === "relay_response_too_large") return "Hermes returned more data than this extension can safely accept.";
  if (error?.code === "relay_request_failed") return "The approved Hermes request could not run successfully in this workspace.";
  if (error?.code === "relay_execution_rejected") return "Muxy rejected the approved Hermes command in this workspace.";
  if (error?.code === "relay_launch_failed") return "Muxy approved the Hermes command but could not launch it in this workspace.";
  if (error?.code === "relay_launch_stream_failed") return "Muxy could not attach standard input to the approved Hermes command in this workspace.";
  if (error?.code === "relay_launch_spawn_failed") return "Muxy could not start its SSH process for the approved Hermes command in this workspace.";
  if (error?.code === "relay_launch_spawn_not_permitted") return "macOS did not permit Muxy to start the SSH process for this extension command.";
  if (error?.code === "relay_launch_spawn_missing") return "Muxy SSH workspaces are not supported in this beta. Use a local Muxy workspace with your own SSH forward or a trusted HTTPS Dashboard address.";
  if (error?.code === "relay_launch_spawn_busy") return "Muxy could not start another SSH process right now. Close other work and try again.";
  if (error?.code === "relay_launch_spawn_too_large") return "Muxy rejected the SSH command because its launch arguments were too large.";
  if (error?.code === "relay_launch_arguments_invalid") return "Muxy rejected the approved Hermes command before launching it in this workspace.";
  if (error?.code === "relay_concurrency_limit") return "Muxy’s command limit is busy in this workspace. Close other extension work and try again.";
  if (error?.code === "relay_permission_denied") return "Muxy denied command permission for this extension in this workspace.";
  if (error?.code === "relay_cancelled") return "Muxy cancelled the Hermes command in this workspace.";
  if (error?.code === "relay_result_unavailable") return "Muxy did not return a result for the approved Hermes command in this workspace.";
  if (error?.code === "relay_output_unavailable") return "Muxy did not return readable output from the approved Hermes command in this workspace.";
  if (error?.code === "relay_unavailable") return "Muxy command execution is unavailable in this workspace.";
  if (/^(Enter|Use)/.test(error?.message ?? "")) return error.message;
  return "Hermes could not be reached. Check the address and try again.";
}

function connectionPresentation(snapshot) {
  switch (snapshot?.state) {
    case "connected": return { label: "Connected", busy: false };
    case "connecting": return { label: "Connecting…", busy: true };
    case "reconnecting": return { label: "Reconnecting…", busy: true };
    case "offline": return { label: "Offline — retrying", busy: true };
    case "signed_out": return { label: "Signed out", busy: false };
    default: return { label: "Disconnected", busy: false };
  }
}

function runStatusLabel(status) {
  if (status === "starting") return "Starting…";
  if (status === "waiting_for_approval") return "Needs approval";
  if (status === "stopping") return "Stopping…";
  if (status === "completed") return "Complete";
  if (status === "failed") return "Needs attention";
  if (status === "running") return "Working";
  return "Ready";
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return "under a minute";
  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 24 * 60 * 60) return `${Math.floor(seconds / (60 * 60))}h`;
  return `${Math.floor(seconds / (24 * 60 * 60))}d`;
}

function relativeRunLabel(value, now = Date.now()) {
  if (!value) return "No upcoming run";
  const delta = Date.parse(value) - now;
  if (!Number.isFinite(delta)) return "Schedule unavailable";
  if (delta <= 0) return "Due now";
  const seconds = Math.ceil(delta / 1000);
  if (seconds < 60) return "In under a minute";
  if (seconds < 60 * 60) return `In ${Math.ceil(seconds / 60)}m`;
  if (seconds < 24 * 60 * 60) return `In ${Math.ceil(seconds / (60 * 60))}h`;
  if (seconds < 7 * 24 * 60 * 60) return `In ${Math.ceil(seconds / (24 * 60 * 60))}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function healthLabel(health) {
  if (!health) return { label: "Status unavailable", state: "unknown" };
  if (health.gateway === "degraded" || health.memory === "critical" || health.disk === "critical") {
    return { label: "Hermes needs attention", state: "critical" };
  }
  if (health.memory === "elevated" || health.disk === "elevated") return { label: "Hermes is under pressure", state: "elevated" };
  if (health.gateway === "ok") return { label: "Hermes is online", state: "ok" };
  return { label: "Status unavailable", state: "unknown" };
}

function reconnectCopy(snapshot) {
  if (snapshot.reason === "websocket_ticket_failed") return "Muxy couldn’t request a fresh Hermes connection ticket in this workspace. We’ll keep trying automatically.";
  if (snapshot.reason === "connection_failed") return "Muxy reached Hermes, but the live agent connection could not open. We’ll keep trying automatically.";
  if (snapshot.reason === "connection_timeout") return "Hermes isn’t responding to agent connections yet. We’ll keep trying automatically.";
  if (snapshot.reason === "connection_auth_rejected") return "Hermes rejected the agent connection. We’ll keep trying with a new connection.";
  if (snapshot.reason === "connection_not_allowed") return "This Hermes server isn’t accepting agent connections from Muxy yet.";
  if (snapshot.state === "offline" && snapshot.attempt >= 3) return "Hermes isn’t accepting agent connections yet. We’ll keep trying automatically.";
  return "Trying to reconnect automatically. No action is needed.";
}

export class HermesGatewayPanel {
  constructor(root) {
    this.root = root;
    this.sessionBroker = new SessionBrokerClient();
    this.urlValue = "";
    this.boardValue = null;
    this.providerValue = "";
    this.usernameValue = "";
    this.passwordValue = "";
    this.promptValue = "";
    this.steerValue = "";
    this.state = "restoring";
    this.message = "";
    this.authSession = null;
    this.authSnapshot = emptyAuthSnapshot();
    this.gateway = null;
    this.connectionSnapshot = Object.freeze({ state: "disconnected", attempt: 0, retryInMs: null, reason: null });
    this.agent = null;
    this.agentSnapshot = emptyAgentSnapshot();
    this.operations = null;
    this.operationsSnapshot = emptyOperationsSnapshot();
    this.jobsExpanded = false;
    this.operationsRefreshInFlight = false;
    this.unsubscribeConnection = null;
    this.unsubscribeAgent = null;
    this.sessionCheckTimer = null;
    this.operationsRefreshTimer = null;
    this.sessionCheckInFlight = false;
    this.sessionInvalidating = false;
    this.lastSessionCheckAt = 0;
    this.restorePromise = null;
    this.connectionGeneration = 0;
  }

  start() {
    this.render();
    void this.sessionBroker.clearGateway();
    void this.restoreSavedSession();
    this.sessionCheckTimer = globalThis.setInterval(() => { void this.verifyPrimarySession(); }, SESSION_CHECK_INTERVAL_MS);
    this.operationsRefreshTimer = globalThis.setInterval(() => { void this.refreshOperations(); }, OPERATIONS_REFRESH_INTERVAL_MS);
    window.muxy?.onFocus?.((focused) => {
      if (!focused) return;
      if (!this.authSession) void this.restoreSavedSession();
      else {
        if (Date.now() - this.lastSessionCheckAt >= SESSION_CHECK_INTERVAL_MS) void this.verifyPrimarySession();
        void this.syncSavedBoard().then(() => this.refreshOperations());
      }
      if (["offline", "disconnected"].includes(this.connectionSnapshot.state)) void this.gateway?.reconnectNow().catch(() => {});
      if (this.authSnapshot.state !== "logged_in") this.urlInput?.focus();
      else if (!ACTIVE_AGENT_STATES.has(this.agentSnapshot.status)) this.promptInput?.focus();
    });
    window.muxy?.lifecycle?.onBeforeClose?.(async () => this.release());
    window.addEventListener("pagehide", () => { void this.release(); }, { once: true });
  }

  render() {
    const focused = document.activeElement && this.root.contains(document.activeElement)
      ? {
        id: document.activeElement.id,
        start: document.activeElement.selectionStart,
        end: document.activeElement.selectionEnd,
      }
      : null;
    clear(this.root);
    this.root.appendChild(this.view());
    this.syncForms();
    if (focused?.id) {
      const replacement = this.root.querySelector(`#${CSS.escape(focused.id)}`);
      replacement?.focus?.({ preventScroll: true });
      if (Number.isInteger(focused.start) && Number.isInteger(focused.end)) {
        replacement?.setSelectionRange?.(focused.start, focused.end);
      }
    }
  }

  view() {
    return h("main", { class: "gateway-panel" },
      this.header(),
      this.authSnapshot.state === "logged_in" ? this.agentView() : this.connectionView(),
    );
  }

  header() {
    const connection = connectionPresentation(this.connectionSnapshot);
    return h("header", { class: "gateway-header" },
      h("div", { class: "gateway-title-row" },
        h("div", { class: "gateway-title-group" },
          h("h1", { class: "gateway-title" }, "Hermes"),
          this.authSnapshot.state === "logged_in"
            ? h("span", { class: `gateway-connection gateway-connection-${this.connectionSnapshot.state}`, role: "status", "aria-live": "polite" },
              connection.busy ? h("span", { class: "gateway-reconnect-icon", "aria-hidden": "true" }, "↔") : h("span", { class: "gateway-connection-dot", "aria-hidden": "true" }),
              connection.label,
            )
            : h("span", { class: "gateway-connection gateway-connection-signed_out", role: "status" }, "Signed out"),
        ),
        this.authSnapshot.state === "logged_in" ? h("button", { class: "gateway-link-button", type: "button", onclick: () => void this.logout() }, "Log out") : null,
      ),
      this.authSnapshot.state === "logged_in" ? h("div", { class: "gateway-account-row" },
        h("span", { class: "gateway-account" }, `Signed in as ${this.authSnapshot.label}`),
        h("button", { class: "gateway-secondary", type: "button", onclick: () => void this.openBoard() }, "Open board"),
      ) : h("p", { class: "gateway-purpose" }, "Sign in once to use Hermes and your project boards."),
    );
  }

  connectionView() {
    const url = h("input", {
      id: "dashboard-url",
      class: "gateway-input",
      type: "url",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "http://127.0.0.1:9119",
      oninput: (event) => { this.urlValue = event.target.value; this.message = ""; this.syncForms(); },
    });
    url.value = this.urlValue;
    this.urlInput = url;
    const checking = ["restoring", "discovering", "authenticating"].includes(this.state);
    const check = h("button", { class: "gateway-submit", type: "submit" }, checking ? "Checking…" : "Continue");
    this.checkButton = check;

    let authForm = null;
    if (["logged_out", "session_expired"].includes(this.authSnapshot.state)
      && this.authSnapshot.providers.some((provider) => provider.supportsPassword)) {
      const providers = this.authSnapshot.providers.filter((provider) => provider.supportsPassword);
      if (!providers.some((provider) => provider.name === this.providerValue)) this.providerValue = providers[0].name;
      const provider = h("select", {
        id: "dashboard-provider",
        class: "gateway-select",
        onchange: (event) => { this.providerValue = event.target.value; this.message = ""; },
      }, providers.map((candidate) => h("option", { value: candidate.name, selected: candidate.name === this.providerValue }, candidate.displayName)));
      const username = h("input", {
        id: "dashboard-username",
        class: "gateway-input",
        type: "text",
        autocomplete: "username",
        spellcheck: "false",
        maxlength: "256",
        oninput: (event) => { this.usernameValue = event.target.value; this.message = ""; this.syncForms(); },
      });
      username.value = this.usernameValue;
      const password = h("input", {
        id: "dashboard-password",
        class: "gateway-input",
        type: "password",
        autocomplete: "current-password",
        maxlength: "4096",
        oninput: (event) => { this.passwordValue = event.target.value; this.message = ""; this.syncForms(); },
      });
      password.value = this.passwordValue;
      const signIn = h("button", { class: "gateway-submit", type: "submit" }, this.state === "authenticating" ? "Signing in…" : "Sign in");
      this.providerInput = provider;
      this.usernameInput = username;
      this.passwordInput = password;
      this.signInButton = signIn;
      authForm = h("form", { class: "gateway-form gateway-card", onsubmit: (event) => void this.signIn(event) },
        h("h2", null, this.authSnapshot.state === "session_expired" ? "Sign in again" : "Sign in"),
        h("label", { class: "gateway-label", for: "dashboard-provider" }, "Sign-in method"), provider,
        h("label", { class: "gateway-label", for: "dashboard-username" }, "Username"), username,
        h("label", { class: "gateway-label", for: "dashboard-password" }, "Password"), password,
        h("p", { class: "gateway-footnote" }, "You’ll stay signed in on this Mac until you log out. Use password sign-in only on a trusted network, VPN, or operator-controlled connection."),
        signIn,
      );
    } else if (this.authSnapshot.state === "oauth_required") {
      authForm = h("section", { class: "gateway-card gateway-form" },
        h("h2", null, "OAuth/OIDC not supported"),
        h("p", null, "This beta supports provider-advertised password sign-in only. Use the Hermes Dashboard directly for OAuth or OIDC."),
      );
    } else if (this.authSnapshot.state === "auth_unavailable") {
      authForm = h("section", { class: "gateway-card gateway-form" },
        h("h2", null, "Sign-in unavailable"),
        h("p", null, "This Hermes server does not offer a supported sign-in method."),
      );
    }

    return h("section", { class: "gateway-connect" },
      h("form", { class: "gateway-form gateway-card", onsubmit: (event) => void this.checkAuthentication(event) },
        h("h2", null, "Connect to Hermes"),
        h("p", null, "Enter the address you use to open Hermes."),
        h("label", { class: "gateway-label", for: "dashboard-url" }, "Hermes address"),
        url,
        check,
      ),
      authForm,
      h("p", { class: "gateway-inline-error", role: this.message ? "alert" : null, "aria-live": "polite" }, this.message),
    );
  }

  agentView() {
    const connected = this.connectionSnapshot.state === "connected";
    const active = ACTIVE_AGENT_STATES.has(this.agentSnapshot.status);
    const hasRun = Boolean(this.agentSnapshot.request
      || this.agentSnapshot.assistant
      || this.agentSnapshot.activity.length
      || this.agentSnapshot.status !== "idle");

    return h("section", { class: "gateway-agent" },
      this.message ? h("p", { class: "gateway-error-card", role: "alert", "aria-live": "polite" }, this.message) : null,
      !connected ? h("div", { class: `gateway-connection-note gateway-connection-note-${this.connectionSnapshot.state}`, role: "status", "aria-live": "polite" },
        reconnectCopy(this.connectionSnapshot),
      ) : null,
      h("div", { class: "gateway-agent-scroll" },
        hasRun ? this.runView() : this.operationsView(),
      ),
      active && this.agentSnapshot.status !== "waiting_for_approval" ? this.activeControls() : null,
      !active ? this.composerView(connected) : null,
    );
  }

  operationsView() {
    const snapshot = this.operationsSnapshot;
    const health = healthLabel(snapshot.health);
    return h("section", { class: "gateway-overview", "aria-labelledby": "operations-title" },
      h("div", { class: "gateway-overview-heading" },
        h("div", null,
          h("h2", { id: "operations-title" }, "Operations"),
          h("p", { class: `gateway-health-summary gateway-health-${health.state}`, role: "status" },
            h("span", { class: "gateway-health-dot", "aria-hidden": "true" }),
            health.label,
          ),
        ),
        h("button", {
          class: "gateway-icon-button",
          type: "button",
          title: "Refresh status",
          "aria-label": "Refresh Hermes status",
          disabled: this.operationsRefreshInFlight,
          onclick: () => void this.refreshOperations(),
        }, icon("refresh", 14, this.operationsRefreshInFlight ? "gateway-refreshing" : "", 1.5)),
      ),
      snapshot.state === "idle" || snapshot.state === "loading"
        ? h("section", { class: "gateway-card gateway-loading-card", role: "status" },
          icon("sparkles", 14, "", 1.5),
          h("span", null, "Loading Hermes status…"),
        )
        : [this.attentionView(), this.queueView(), this.scheduleView(), this.healthView()],
      h("div", { class: "gateway-overview-footer" },
        h("span", null, snapshot.state === "partial"
          ? "Some status is unavailable"
          : snapshot.state === "unavailable" ? "Status could not be loaded" : snapshot.updatedAt ? "Updated just now" : ""),
      ),
    );
  }

  attentionView() {
    const attention = this.operationsSnapshot.attention;
    const rows = [
      attention.failedJobs ? [attention.failedJobs, countLabel(attention.failedJobs, "scheduled job failed", "scheduled jobs failed")] : null,
      attention.blocked ? [attention.blocked, countLabel(attention.blocked, "blocked task", "blocked tasks")] : null,
      attention.review ? [attention.review, countLabel(attention.review, "task ready for review", "tasks ready for review")] : null,
      attention.diagnostics ? [attention.diagnostics, countLabel(attention.diagnostics, "board warning", "board warnings")] : null,
    ].filter(Boolean);
    const hasSource = this.operationsSnapshot.available.jobs
      || this.operationsSnapshot.available.queue
      || this.operationsSnapshot.available.diagnostics;
    return h("section", { class: "gateway-card gateway-ops-card", "aria-labelledby": "attention-title" },
      h("div", { class: "gateway-ops-heading" },
        h("h3", { id: "attention-title" }, "Needs attention"),
      ),
      rows.length
        ? h("ul", { class: "gateway-attention-list" }, rows.map(([count, label]) => h("li", null,
          h("span", { class: "gateway-attention-count" }, count),
          h("span", null, label.replace(/^\d+\s+/, "")),
        )))
        : h("p", { class: "gateway-empty-copy" }, hasSource ? "Nothing needs you right now." : "Attention status is unavailable."),
    );
  }

  queueView() {
    const queue = this.operationsSnapshot.queue;
    if (!queue) {
      return h("section", { class: "gateway-card gateway-ops-card", "aria-labelledby": "queue-title" },
        h("div", { class: "gateway-ops-heading" }, h("h3", { id: "queue-title" }, "Queue")),
        h("p", { class: "gateway-empty-copy" }, "Queue status is unavailable."),
      );
    }
    const total = queue.waiting + queue.running;
    const runningWidth = total ? Math.round((queue.running / total) * 100) : 0;
    const waitingWidth = total ? 100 - runningWidth : 0;
    const oldest = queue.waiting && queue.oldestWaitingSeconds !== null
      ? `Oldest wait ${durationLabel(queue.oldestWaitingSeconds)}`
      : queue.waiting ? "Wait age unavailable" : "No work waiting";
    return h("section", { class: "gateway-card gateway-ops-card", "aria-labelledby": "queue-title" },
      h("div", { class: "gateway-ops-heading" },
        h("h3", { id: "queue-title" }, "Queue pressure"),
        h("strong", { class: queue.waiting ? "gateway-key-number" : "" }, `${queue.waiting} waiting`),
      ),
      h("div", {
        class: `gateway-queue-meter${total ? "" : " gateway-queue-meter-empty"}`,
        role: "img",
        "aria-label": `${queue.running} running and ${queue.waiting} waiting`,
      },
      total ? [
        runningWidth ? h("span", { class: "gateway-queue-running", style: `width: ${runningWidth}%` }) : null,
        waitingWidth ? h("span", { class: "gateway-queue-waiting", style: `width: ${waitingWidth}%` }) : null,
      ] : h("span")),
      h("div", { class: "gateway-queue-meta" },
        h("span", null, `${queue.running} running`),
        h("span", null, oldest),
      ),
      queue.activeWorkers && queue.activeWorkers !== queue.running
        ? h("p", { class: "gateway-ops-note" }, countLabel(queue.activeWorkers, "active worker"))
        : null,
    );
  }

  scheduleView() {
    const { jobs, available } = this.operationsSnapshot;
    const hasMore = jobs.length > 4;
    const visibleJobs = this.jobsExpanded ? jobs : jobs.slice(0, 4);
    return h("section", { class: "gateway-card gateway-ops-card", "aria-labelledby": "schedule-title" },
      h("div", { class: "gateway-ops-heading" },
        h("h3", { id: "schedule-title" }, "Scheduled jobs"),
        available.jobs ? h("span", { class: "gateway-count" }, jobs.length) : null,
      ),
      !available.jobs
        ? h("p", { class: "gateway-empty-copy" }, "Scheduled jobs are unavailable.")
        : jobs.length
          ? h("ul", { id: "scheduled-job-list", class: "gateway-job-list" }, visibleJobs.map((job) => {
            const state = job.failed ? "failed" : !job.enabled ? "paused" : job.state === "running" ? "running" : "scheduled";
            const status = job.failed ? "Last run failed" : !job.enabled ? "Paused" : relativeRunLabel(job.nextRunAt);
            return h("li", null,
              h("span", { class: `gateway-job-dot gateway-job-${state}`, "aria-hidden": "true" }),
              h("span", { class: "gateway-job-copy" },
                h("strong", null, job.name),
                h("span", null, `${job.cadence} · ${status}`),
              ),
            );
          }))
          : h("p", { class: "gateway-empty-copy" }, "No scheduled jobs."),
      hasMore ? h("button", {
        class: "gateway-link-button gateway-job-toggle",
        type: "button",
        "aria-expanded": String(this.jobsExpanded),
        "aria-controls": "scheduled-job-list",
        onclick: () => {
          this.jobsExpanded = !this.jobsExpanded;
          this.render();
        },
      }, this.jobsExpanded ? "Show fewer" : `Show all ${jobs.length}`) : null,
    );
  }

  healthView() {
    const health = this.operationsSnapshot.health;
    if (!health) return null;
    const items = [
      ["Gateway", health.gateway],
      ["Memory", health.memory],
      ["Disk", health.disk],
    ].filter(([, state]) => state !== "unknown");
    return h("section", { class: "gateway-health-strip", "aria-label": "Hermes health" },
      items.map(([label, state]) => h("span", { class: `gateway-health-chip gateway-health-${state}` },
        h("span", { class: "gateway-health-dot", "aria-hidden": "true" }),
        `${label} ${state === "ok" ? "normal" : state}`,
      )),
    );
  }

  composerView(connected) {
    const prompt = h("textarea", {
      id: "agent-prompt",
      class: "gateway-composer-input",
      rows: "4",
      maxlength: String(64 * 1024),
      placeholder: connected ? "Ask Hermes to work on something…" : "Waiting for Hermes to reconnect…",
      disabled: !connected,
      oninput: (event) => { this.promptValue = event.target.value; this.syncForms(); },
      onkeydown: (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void this.startRequest(event);
      },
    });
    prompt.value = this.promptValue;
    this.promptInput = prompt;
    const submit = h("button", { class: "gateway-submit gateway-composer-submit", type: "submit", "aria-label": "Start request" },
      this.agentSnapshot.status === "completed" ? "Run another" : "Run",
      h("span", { "aria-hidden": "true" }, "↑"),
    );
    this.promptButton = submit;

    return h("form", { class: "gateway-composer", onsubmit: (event) => void this.startRequest(event) },
      this.agentSnapshot.status === "idle" ? h("div", { class: "gateway-starters", "aria-label": "Request starters" },
        STARTER_PROMPTS.map((starter) => h("button", {
          class: "gateway-starter",
          type: "button",
          disabled: !connected,
          onclick: () => this.chooseStarter(starter.prompt),
        }, starter.title)),
      ) : null,
      h("label", { class: "gateway-sr-only", for: "agent-prompt" }, "Request"),
      prompt,
      h("div", { class: "gateway-composer-footer" },
        h("span", { class: "gateway-composer-hint" }, connected ? "⌘↵ to run" : "Waiting for Hermes"),
        submit,
      ),
    );
  }

  runView() {
    const working = ["starting", "running", "stopping"].includes(this.agentSnapshot.status);
    return h("section", { class: "gateway-run", "aria-labelledby": "agent-title" },
      h("div", { class: "gateway-run-heading" },
        h("div", null,
          h("h2", { id: "agent-title" }, "Current request"),
          h("span", { class: `gateway-run-status gateway-run-status-${this.agentSnapshot.status}`, "aria-live": "polite" }, runStatusLabel(this.agentSnapshot.status)),
        ),
        !working && this.agentSnapshot.status !== "waiting_for_approval" ? h("button", {
          class: "gateway-link-button",
          type: "button",
          onclick: () => this.agent?.reset(),
        }, "Overview") : null,
      ),
      this.agentSnapshot.request ? h("section", { class: "gateway-message gateway-message-user", "aria-labelledby": "request-title" },
        h("h3", { id: "request-title", class: "gateway-message-role" }, "You"),
        h("p", null, this.agentSnapshot.request),
      ) : null,
      this.agentSnapshot.assistant ? h("section", { class: "gateway-message gateway-message-hermes", "aria-labelledby": "assistant-title" },
        h("h3", { id: "assistant-title", class: "gateway-message-role" }, "Hermes"),
        h("p", { class: "gateway-assistant", "aria-live": "polite" }, this.agentSnapshot.assistant),
      ) : working ? h("div", { class: "gateway-working", role: "status", "aria-live": "polite" },
        h("span", { class: "gateway-working-mark", "aria-hidden": "true" }, "✦"),
        h("span", null, this.agentSnapshot.status === "starting" ? "Preparing your request…" : "Hermes is working…"),
      ) : null,
      this.agentSnapshot.activity.length ? h("section", { class: "gateway-card gateway-run-activity", "aria-labelledby": "activity-title" },
        h("h3", { id: "activity-title" }, "Activity"),
        h("ol", { class: "gateway-activity-list" }, this.agentSnapshot.activity.map((item) => h("li", { class: `gateway-activity gateway-activity-${item.kind}` },
          h("strong", null, item.label), item.detail ? h("span", null, item.detail) : null,
        ))),
      ) : null,
      this.approvalView(),
      this.agentSnapshot.error ? h("p", { class: "gateway-error-card", role: "alert" }, this.agentSnapshot.error) : null,
    );
  }

  approvalView() {
    const approval = this.agentSnapshot.pendingApproval;
    if (!approval) return null;
    return h("section", { class: "gateway-card gateway-approval", "aria-labelledby": "approval-title" },
      h("h3", { id: "approval-title" }, "Approval required"),
      h("p", null, approval.tool),
      approval.command ? h("pre", { class: "gateway-command" }, approval.command) : null,
      h("div", { class: "gateway-control-row" }, approval.choices.map((choice) => h("button", {
        class: choice === "deny" ? "gateway-danger" : "gateway-secondary",
        type: "button",
        disabled: this.agentSnapshot.actionPending || this.connectionSnapshot.state !== "connected",
        onclick: () => void this.agent?.approve(choice).catch(() => {}),
      }, choice === "once" ? "Allow once" : choice === "session" ? "Allow for session" : choice === "always" ? "Always allow" : "Deny"))),
    );
  }

  activeControls() {
    const steer = h("input", {
      id: "agent-steer",
      class: "gateway-input",
      type: "text",
      maxlength: String(64 * 1024),
      placeholder: "Add guidance…",
      disabled: this.agentSnapshot.actionPending || this.connectionSnapshot.state !== "connected",
      oninput: (event) => { this.steerValue = event.target.value; this.syncForms(); },
    });
    steer.value = this.steerValue;
    const steerButton = h("button", { class: "gateway-secondary", type: "submit" }, "Send guidance");
    this.steerInput = steer;
    this.steerButton = steerButton;
    return h("section", { class: "gateway-card gateway-run-controls", "aria-labelledby": "controls-title" },
      h("div", { class: "gateway-run-controls-heading" },
        h("h3", { id: "controls-title" }, "Guide this run"),
        h("button", {
          class: "gateway-danger",
          type: "button",
          disabled: this.agentSnapshot.actionPending || this.connectionSnapshot.state !== "connected",
          onclick: () => void this.confirmStop(),
        }, this.agentSnapshot.status === "stopping" ? "Stopping…" : "Stop"),
      ),
      h("form", { class: "gateway-steer-form", onsubmit: (event) => void this.steer(event) }, steer, steerButton),
    );
  }

  chooseStarter(prompt) {
    this.promptValue = prompt;
    this.render();
    this.promptInput?.focus();
    this.promptInput?.setSelectionRange?.(this.promptValue.length, this.promptValue.length);
  }

  syncForms() {
    if (this.checkButton) {
      let valid = false;
      try { normalizeHermesDashboardUrl(this.urlValue); valid = true; } catch { /* validation is rendered on submit */ }
      this.checkButton.disabled = ["restoring", "discovering", "authenticating"].includes(this.state) || !valid;
    }
    if (this.signInButton) this.signInButton.disabled = this.state === "authenticating" || !this.usernameValue.trim() || !this.passwordValue;
    if (this.promptButton) this.promptButton.disabled = this.connectionSnapshot.state !== "connected" || !this.promptValue.trim();
    if (this.steerButton) this.steerButton.disabled = this.connectionSnapshot.state !== "connected" || this.agentSnapshot.actionPending || !this.steerValue.trim();
  }

  async checkAuthentication(event) {
    event.preventDefault();
    if (["restoring", "discovering", "authenticating"].includes(this.state)) return;
    await this.releaseConnection();
    this.state = "discovering";
    this.message = "";
    this.render();
    try {
      const baseUrl = normalizeHermesDashboardUrl(this.urlValue);
      this.authSession = new DashboardAuthSession({ baseUrl });
      this.authSnapshot = await this.authSession.discover();
      this.state = "signed_out";
    } catch (error) {
      this.authSession = null;
      this.authSnapshot = emptyAuthSnapshot();
      this.state = "signed_out";
      this.message = authErrorCopy(error);
    }
    this.render();
    if (this.authSnapshot.providers.some((provider) => provider.supportsPassword)) this.usernameInput?.focus();
  }

  async signIn(event) {
    event.preventDefault();
    if (!this.authSession || this.state === "authenticating") return;
    this.state = "authenticating";
    this.message = "";
    this.render();
    try {
      this.authSnapshot = await this.authSession.login({
        provider: this.providerValue,
        username: this.usernameValue,
        password: this.passwordValue,
      });
      this.lastSessionCheckAt = Date.now();
      await this.persistDashboardSession();
      await this.connectAgent();
    } catch (error) {
      this.authSnapshot = this.authSession.snapshot;
      this.state = "signed_out";
      this.message = authErrorCopy(error);
      if (error instanceof DashboardAuthError && error.code === "session_expired") await this.sessionBroker.clearDashboard();
    } finally {
      this.clearCredentials();
    }
    this.render();
    if (this.authSnapshot.state !== "logged_in") this.usernameInput?.focus();
  }

  restoreSavedSession() {
    if (this.restorePromise) return this.restorePromise;
    const operation = this.performSavedSessionRestore();
    this.restorePromise = operation;
    void operation.finally(() => {
      if (this.restorePromise === operation) this.restorePromise = null;
    });
    return operation;
  }

  async performSavedSessionRestore() {
    this.state = "restoring";
    this.render();
    const saved = await this.sessionBroker.readDashboard();
    if (!saved) {
      this.state = "signed_out";
      this.render();
      this.urlInput?.focus();
      return;
    }
    this.urlValue = saved.baseUrl;
    this.boardValue = saved.board;
    try {
      this.authSession = DashboardAuthSession.fromSession({ baseUrl: saved.baseUrl, session: saved.auth });
      this.authSnapshot = await this.authSession.verify();
      this.lastSessionCheckAt = Date.now();
      await this.persistDashboardSession();
      await this.connectAgent();
    } catch (error) {
      this.authSnapshot = this.authSession?.snapshot ?? emptyAuthSnapshot();
      this.state = "signed_out";
      this.message = authErrorCopy(error);
      if (error instanceof DashboardAuthError && error.code === "session_expired") await this.sessionBroker.clearDashboard();
    }
    this.render();
  }

  async connectAgent() {
    const generation = ++this.connectionGeneration;
    await this.releaseConnection({ preserveGeneration: true });
    if (generation !== this.connectionGeneration || this.authSnapshot.state !== "logged_in") return;
    this.state = "authenticated";
    this.gateway = new DashboardGatewayClient({
      authSession: this.authSession,
      persistSession: async () => this.persistDashboardSession(),
    });
    try {
      this.operations = new DashboardOperationsClient({
        baseUrl: this.authSession.baseUrl,
        session: this.authSession,
        board: this.boardValue,
      });
    } catch {
      throw new DashboardGatewayError("operations_setup_failed");
    }
    this.operationsSnapshot = Object.freeze({ ...emptyOperationsSnapshot(), state: "loading" });
    try {
      this.agent = new DashboardAgentController({ gateway: this.gateway });
    } catch {
      throw new DashboardGatewayError("agent_setup_failed");
    }
    try {
      this.unsubscribeConnection = this.gateway.subscribe((snapshot) => {
        if (generation !== this.connectionGeneration) return;
        this.connectionSnapshot = snapshot;
        if (snapshot.state === "signed_out") queueMicrotask(() => { void this.invalidateSession(); });
        this.render();
      });
      this.unsubscribeAgent = this.agent.subscribe((snapshot) => {
        if (generation !== this.connectionGeneration) return;
        this.agentSnapshot = snapshot;
        this.render();
      });
    } catch {
      throw new DashboardGatewayError("panel_subscription_failed");
    }
    this.render();
    void this.refreshOperations();
    await this.gateway.connect().catch(() => {});
  }

  async refreshOperations() {
    if (!this.operations || this.authSnapshot.state !== "logged_in" || this.operationsRefreshInFlight) return;
    this.operationsRefreshInFlight = true;
    if (!this.operationsSnapshot.updatedAt) {
      this.operationsSnapshot = Object.freeze({ ...this.operationsSnapshot, state: "loading" });
    }
    this.render();
    try {
      this.operationsSnapshot = await this.operations.load();
      await this.persistDashboardSession();
    } catch (error) {
      if (error instanceof DashboardAuthError && error.code === "session_expired") {
        await this.invalidateSession();
        return;
      }
      this.operationsSnapshot = Object.freeze({
        ...this.operationsSnapshot,
        state: this.operationsSnapshot.updatedAt ? "partial" : "unavailable",
        updatedAt: Date.now(),
      });
    } finally {
      this.operationsRefreshInFlight = false;
    }
    this.render();
  }

  async verifyPrimarySession() {
    if (!this.authSession || this.authSnapshot.state !== "logged_in" || this.sessionCheckInFlight) return;
    this.sessionCheckInFlight = true;
    try {
      this.authSnapshot = await this.authSession.verify();
      this.lastSessionCheckAt = Date.now();
      await this.persistDashboardSession();
    } catch (error) {
      this.authSnapshot = this.authSession.snapshot;
      if (error instanceof DashboardAuthError && error.code === "session_expired") await this.invalidateSession();
    } finally {
      this.sessionCheckInFlight = false;
    }
    this.render();
  }

  async invalidateSession() {
    if (this.sessionInvalidating) return;
    this.sessionInvalidating = true;
    try {
      await this.releaseConnection();
      await this.sessionBroker.clearDashboard();
      this.authSnapshot = this.authSession?.snapshot ?? Object.freeze({ ...emptyAuthSnapshot(), state: "session_expired" });
      this.state = "signed_out";
      this.message = "Your Hermes sign-in expired. Sign in again to continue.";
    } finally {
      this.sessionInvalidating = false;
    }
    this.render();
  }

  async persistDashboardSession() {
    const auth = this.authSession?.exportSession();
    if (!auth) return false;
    return this.sessionBroker.saveDashboard({ baseUrl: this.authSession.baseUrl, board: this.boardValue, auth });
  }

  async syncSavedBoard() {
    if (!this.authSession) return;
    const saved = await this.sessionBroker.readDashboard();
    if (!saved || saved.baseUrl !== this.authSession.baseUrl || saved.board === this.boardValue) return;
    this.boardValue = saved.board;
    this.operations?.setBoard(saved.board);
    this.render();
  }

  clearCredentials() {
    this.usernameValue = "";
    this.passwordValue = "";
    if (this.usernameInput) this.usernameInput.value = "";
    if (this.passwordInput) this.passwordInput.value = "";
  }

  async startRequest(event) {
    event.preventDefault();
    const prompt = this.promptValue;
    if (!prompt.trim() || !this.agent) return;
    this.promptValue = "";
    this.render();
    await this.agent.start(prompt).catch(() => {});
  }

  async steer(event) {
    event.preventDefault();
    const guidance = this.steerValue;
    if (!guidance.trim() || !this.agent) return;
    this.steerValue = "";
    this.render();
    await this.agent.steer(guidance).catch(() => {});
  }

  async confirmStop() {
    if (!this.agent || this.agentSnapshot.actionPending || this.connectionSnapshot.state !== "connected") return;
    const agent = this.agent;
    const runGeneration = agent.runGeneration;
    const confirm = window.muxy?.dialog?.confirm;
    const result = await requestConfirmedStop({
      confirm,
      canStop: () => this.agent === agent
        && agent.runGeneration === runGeneration
        && !this.agentSnapshot.actionPending
        && this.connectionSnapshot.state === "connected"
        && ["starting", "running"].includes(this.agentSnapshot.status),
      stop: () => agent.stop(),
    });
    if (["confirmation_unavailable", "confirmation_failed"].includes(result)) {
      this.message = "Muxy could not open the stop confirmation. Reload the extension, then try again.";
      this.render();
      return;
    }
    if (result === "stale") this.render();
  }

  async openBoard() {
    try {
      await openProjectBoardTab(window.muxy);
    } catch {
      await window.muxy?.dialog?.alert?.({
        title: "Couldn’t open board",
        message: "Reload the Hermes extension, then try again.",
      });
    }
  }

  async logout() {
    const auth = this.authSession;
    await this.releaseConnection();
    try { await auth?.logout(); } catch { /* logout always clears local cookies */ }
    await this.sessionBroker.clearDashboard();
    this.authSnapshot = auth?.snapshot ?? emptyAuthSnapshot();
    this.state = "signed_out";
    this.message = "Signed out.";
    this.clearCredentials();
    this.render();
    this.urlInput?.focus();
  }

  async releaseConnection({ preserveGeneration = false } = {}) {
    if (!preserveGeneration) this.connectionGeneration += 1;
    this.operations?.release();
    this.operations = null;
    this.operationsRefreshInFlight = false;
    this.operationsSnapshot = emptyOperationsSnapshot();
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.agent?.release();
    this.agent = null;
    const gateway = this.gateway;
    this.gateway = null;
    if (gateway) await gateway.disconnect();
    this.connectionSnapshot = Object.freeze({ state: "disconnected", attempt: 0, retryInMs: null, reason: null });
  }

  async release() {
    if (this.sessionCheckTimer) globalThis.clearInterval(this.sessionCheckTimer);
    this.sessionCheckTimer = null;
    if (this.operationsRefreshTimer) globalThis.clearInterval(this.operationsRefreshTimer);
    this.operationsRefreshTimer = null;
    this.clearCredentials();
    await this.releaseConnection();
  }
}
