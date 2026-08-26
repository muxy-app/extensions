import { clear, h } from "@/lib/dom";
import { DashboardAuthError, DashboardAuthSession } from "@/dashboard-auth";
import { KANBAN_STATUSES, KanbanClient, KanbanClientError, normalizeHermesDashboardUrl, selectBoardSlug } from "@/kanban-client";
import { resolveActiveProject } from "@/muxy-tabs";
import { SessionBrokerClient } from "@/session-broker";
import { restoreProjectBoardMapping } from "./mapping-restore";

const STATUS_LABELS = Object.freeze({
  triage: "Triage",
  todo: "Todo",
  scheduled: "Scheduled",
  ready: "Ready",
  running: "Running",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
});
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const BOARD_REFRESH_INTERVAL_MS = 3_000;

function errorCopy(error) {
  if (error instanceof DashboardAuthError && error.code === "invalid_credentials") return "Hermes rejected those credentials. Check the username and password, then try again.";
  if (error instanceof DashboardAuthError && error.code === "login_rate_limited") return "Hermes temporarily limited sign-in attempts. Wait a moment, then try again.";
  if (error instanceof DashboardAuthError && error.code === "session_expired") return "Your sign-in expired. Sign in again to choose a board.";
  if (error instanceof DashboardAuthError && error.code === "password_login_not_supported") return "This Dashboard needs a sign-in method this extension cannot open yet.";
  if (error instanceof DashboardAuthError && error.code === "auth_contract_mismatch") return "This Dashboard’s sign-in setup is not supported by this extension.";
  if (error instanceof DashboardAuthError && error.code === "login_response_unreadable") return "Hermes accepted the sign-in, but the extension could not use the returned session. Try again after updating the extension.";
  if (error instanceof DashboardAuthError && error.code === "session_check_failed") return "Hermes could not verify your sign-in. Try again when the Dashboard is reachable.";
  if (error instanceof KanbanClientError && error.code === "kanban_not_available") {
    return "Boards are not enabled for this Hermes Dashboard. Ask its administrator to enable them.";
  }
  if (error?.message === "kanban_contract_mismatch" || error?.code === "kanban_contract_mismatch") {
    return "This Dashboard returned an unsupported board response.";
  }
  if (error?.code === "relay_launch_spawn_missing") {
    return "Muxy SSH workspaces are not supported in this beta. Use a local Muxy workspace with your own SSH forward or a trusted HTTPS Dashboard address.";
  }
  if (/^(Enter|Use|Choose|Board slug|Task title|Task instructions|Invalid)/.test(error?.message ?? "")) return error.message;
  return "The Hermes board could not be reached. Check the Dashboard address and sign-in, then try again.";
}

export class HermesProjectBoard {
  constructor(root) {
    this.root = root;
    this.sessionBroker = new SessionBrokerClient();
    this.urlValue = "";
    this.boardValue = null;
    this.viewedBoardValue = null;
    this.mappedBoardValue = null;
    this.activeProject = null;
    this.catalog = Object.freeze({ boards: Object.freeze([]), current: null });
    this.providerValue = "";
    this.usernameValue = "";
    this.passwordValue = "";
    this.createTitle = "";
    this.createBody = "";
    this.createAssignee = null;
    this.createInTriage = true;
    this.state = "disconnected";
    this.authSnapshot = Object.freeze({ state: "disconnected", providers: [], identity: null, label: "" });
    this.message = "";
    this.board = null;
    this.client = null;
    this.authSession = null;
    this.pendingTaskId = null;
    this.sessionCheckInFlight = false;
    this.lastSessionCheckAt = 0;
    this.sessionCheckTimer = null;
    this.boardRefreshInFlight = false;
    this.boardRefreshTimer = null;
    this.released = false;
  }

  start() {
    this.released = false;
    this.render();
    void this.restoreSavedSession();
    this.sessionCheckTimer = globalThis.setInterval(() => { void this.verifySavedSession(); }, SESSION_CHECK_INTERVAL_MS);
    this.boardRefreshTimer = globalThis.setInterval(() => { void this.refresh({ silent: true }); }, BOARD_REFRESH_INTERVAL_MS);
    window.muxy?.onFocus?.((focused) => {
      if (focused && Date.now() - this.lastSessionCheckAt >= SESSION_CHECK_INTERVAL_MS) void this.verifySavedSession();
      if (focused && this.state === "disconnected") this.urlInput?.focus();
    });
    window.muxy?.lifecycle?.onBeforeClose?.(async () => this.release());
    window.addEventListener("pagehide", () => this.release(), { once: true });
  }

  release() {
    this.released = true;
    this.client?.release();
    this.client = null;
    if (this.sessionCheckTimer) globalThis.clearInterval(this.sessionCheckTimer);
    this.sessionCheckTimer = null;
    if (this.boardRefreshTimer) globalThis.clearInterval(this.boardRefreshTimer);
    this.boardRefreshTimer = null;
    this.usernameValue = "";
    this.passwordValue = "";
    if (this.usernameInput) this.usernameInput.value = "";
    if (this.passwordInput) this.passwordInput.value = "";
  }

  render() {
    clear(this.root);
    this.root.appendChild(this.view());
    this.syncForms();
  }

  view() {
    const sessionLabel = this.authSnapshot.state === "logged_in"
      ? `Signed in as ${this.authSnapshot.label}`
      : this.authSnapshot.state === "session_expired" ? "Sign-in expired"
        : this.state === "restoring" || this.authSnapshot.state === "checking" ? "Checking your sign-in"
          : "Not signed in";
    return h("main", { class: "board-app" },
      h("header", { class: "board-topbar" },
        h("div", { class: "board-title-group" },
          h("h1", null, "Hermes Project Board"),
          h("span", { class: `board-connection board-connection-${this.state}` }, this.state === "ready" ? this.viewedBoardValue : this.state === "board_picker" ? "choose a board" : this.state.replaceAll("_", " ")),
          h("span", { class: `board-session board-session-${this.authSnapshot.state}`, role: "status" }, sessionLabel),
        ),
        ["ready", "board_picker", "opening_board"].includes(this.state) ? h("div", { class: "board-topbar-actions" },
          this.state === "ready" ? h("button", { class: "board-button board-button-secondary", type: "button", disabled: this.state === "loading", onclick: () => void this.refresh() }, "Refresh") : null,
          h("button", { class: "board-button board-button-secondary", type: "button", onclick: () => void this.logout() }, "Log out"),
        ) : null,
      ),
      this.connectionView(),
      this.state === "ready" ? this.boardView() : null,
    );
  }

  connectionView() {
    if (this.state === "ready") return null;
    if (["board_picker", "opening_board"].includes(this.state)) return this.boardPickerView();
    const url = h("input", {
      id: "dashboard-url", class: "board-input", type: "url", autocomplete: "off", spellcheck: "false",
      placeholder: "https://hermes.example",
      oninput: (event) => { this.urlValue = event.target.value; this.message = ""; this.syncForms(); },
    });
    url.value = this.urlValue;
    this.urlInput = url;
    const discovering = ["discovering", "authenticating", "restoring"].includes(this.state);
    const check = h("button", { class: "board-button board-button-primary", type: "submit" }, discovering ? "Checking…" : "Check sign-in");
    this.checkButton = check;

    let authForm = null;
    if (["logged_out", "session_expired"].includes(this.authSnapshot.state) && this.authSnapshot.providers.some((provider) => provider.supportsPassword)) {
      const providers = this.authSnapshot.providers.filter((provider) => provider.supportsPassword);
      if (!providers.some((provider) => provider.name === this.providerValue)) this.providerValue = providers[0].name;
      const provider = h("select", {
        id: "dashboard-provider", class: "board-select",
        onchange: (event) => { this.providerValue = event.target.value; this.message = ""; },
      }, providers.map((candidate) => h("option", { value: candidate.name, selected: candidate.name === this.providerValue }, candidate.displayName)));
      const username = h("input", {
        id: "dashboard-username", class: "board-input", type: "text", autocomplete: "username", spellcheck: "false", maxlength: "256",
        oninput: (event) => { this.usernameValue = event.target.value; this.message = ""; this.syncForms(); },
      });
      username.value = this.usernameValue;
      const password = h("input", {
        id: "dashboard-password", class: "board-input", type: "password", autocomplete: "current-password", maxlength: "4096",
        oninput: (event) => { this.passwordValue = event.target.value; this.message = ""; this.syncForms(); },
      });
      password.value = this.passwordValue;
      const signIn = h("button", { class: "board-button board-button-primary", type: "submit" }, this.state === "authenticating" ? "Signing in…" : "Sign in and choose a board");
      this.providerInput = provider;
      this.usernameInput = username;
      this.passwordInput = password;
      this.signInButton = signIn;
      authForm = h("form", { class: "board-connect-form", onsubmit: (event) => void this.signIn(event) },
        h("p", { class: "board-auth-state", role: "status" }, this.authSnapshot.state === "session_expired" ? "Sign-in expired" : "Sign in"),
        h("label", { for: "dashboard-provider" }, "Sign-in provider"), provider,
        h("label", { for: "dashboard-username" }, "Username"), username,
        h("label", { for: "dashboard-password" }, "Password"), password,
        h("p", { class: "board-help" }, "You’ll stay signed in on this Mac until you log out. Use password sign-in only on a trusted network, VPN, or operator-controlled connection."),
        signIn,
      );
    } else if (this.authSnapshot.state === "oauth_required") {
      authForm = h("section", { class: "board-connect-form" },
        h("p", { class: "board-auth-state", role: "status" }, "Unsupported sign-in provider"),
        h("strong", null, "OAuth/OIDC not supported"),
        h("p", { class: "board-help" }, "This beta supports provider-advertised password sign-in only. Use the Hermes Dashboard directly for OAuth or OIDC."),
      );
    } else if (this.authSnapshot.state === "auth_unavailable") {
      authForm = h("section", { class: "board-connect-form" },
        h("p", { class: "board-auth-state", role: "status" }, "Sign in unavailable"),
        h("p", { class: "board-help" }, "This Dashboard does not offer a sign-in method this extension can use."),
      );
    }
    return h("section", { class: "board-connect-shell" },
      h("div", { class: "board-connect-copy" },
        h("p", { class: "board-eyebrow" }, "Hermes board"),
        h("h2", null, "Connect to Hermes"),
        h("p", null, "Start by choosing the Dashboard you want to sign in to."),
      ),
      h("div", { class: "board-auth-stack" },
      h("form", { class: "board-connect-form", onsubmit: (event) => void this.checkAuthentication(event) },
        h("label", { for: "dashboard-url" }, "Dashboard address"), url,
        h("p", { class: "board-help" }, "Use the address your team uses for Hermes."),
        check,
      ),
      authForm,
      h("p", { class: "board-message", role: this.message ? "alert" : null, "aria-live": "polite" }, this.message),
      ),
    );
  }

  boardPickerView() {
    const hasBoards = this.catalog.boards.length > 0;
    const choices = this.catalog.boards.map((board) => {
      const count = `${board.total} ${board.total === 1 ? "card" : "cards"}`;
      const label = board.description ? `${board.name} — ${board.description} (${count})` : `${board.name} (${count})`;
      return h("option", { value: board.slug, selected: board.slug === this.boardValue }, label);
    });
    const select = h("select", {
      id: "board-picker", class: "board-select", disabled: !hasBoards || this.state === "opening_board",
      onchange: (event) => {
        this.boardValue = event.target.value;
        this.message = "";
        this.syncForms();
      },
    }, choices);
    select.value = this.boardValue ?? "";
    const open = h("button", { class: "board-button board-button-primary", type: "submit", disabled: !hasBoards || this.state === "opening_board" }, this.state === "opening_board" ? "Opening…" : "View board");
    this.boardPickerInput = select;
    this.openButton = open;
    return h("section", { class: "board-connect-shell" },
      h("div", { class: "board-connect-copy" },
        h("p", { class: "board-eyebrow" }, "Hermes board"),
        h("h2", null, "Choose a board"),
        h("p", null, hasBoards ? "Choose a board, then open it when you’re ready." : "No boards are available for this Dashboard."),
        this.projectMappingState(),
      ),
      h("div", { class: "board-auth-stack" },
        h("form", { class: "board-connect-form", onsubmit: (event) => void this.openBoard(event) },
          h("p", { class: "board-auth-state", role: "status" }, hasBoards ? "Choose a board" : "No boards are available"),
          hasBoards ? [h("label", { for: "board-picker" }, "Available boards"), select, open] : null,
        ),
        h("p", { class: "board-message", role: this.message ? "alert" : null, "aria-live": "polite" }, this.message),
      ),
    );
  }

  boardView() {
    const assignees = this.board.assignees;
    if (this.createAssignee === null || (this.createAssignee && !assignees.includes(this.createAssignee))) {
      this.createAssignee = assignees[0] ?? "";
    }
    const title = h("input", {
      id: "new-card-title", class: "board-input board-task-title", type: "text", maxlength: "1000", placeholder: "Task title…", "aria-label": "Task title",
      oninput: (event) => { this.createTitle = event.target.value; this.syncForms(); },
    });
    title.value = this.createTitle;
    const body = h("input", {
      id: "new-card-body", class: "board-input board-task-instructions", type: "text", maxlength: "20000", placeholder: "Task instructions (optional)…", "aria-label": "Task instructions",
      oninput: (event) => { this.createBody = event.target.value; },
    });
    body.value = this.createBody;
    const assignee = h("select", {
      id: "new-card-assignee", class: "board-select", "aria-label": "Hermes assignee",
      onchange: (event) => { this.createAssignee = event.target.value; },
    },
    h("option", { value: "", selected: !this.createAssignee }, "Unassigned"),
    assignees.map((name) => h("option", { value: name, selected: name === this.createAssignee }, name)));
    const triage = h("select", { id: "new-card-column", class: "board-select", "aria-label": "Starting status", onchange: (event) => { this.createInTriage = event.target.value === "triage"; } },
      h("option", { value: "triage", selected: this.createInTriage }, "Triage"),
      h("option", { value: "todo", selected: !this.createInTriage }, "Todo"),
    );
    const submit = h("button", { class: "board-button board-button-primary", type: "submit" }, "Add card");
    this.createInput = title;
    this.createButton = submit;
    const total = this.board.columns.reduce((sum, column) => sum + column.tasks.length, 0);
    const choices = this.catalog.boards.map((candidate) => h("option", { value: candidate.slug, selected: candidate.slug === this.boardValue }, candidate.name));
    const selector = h("select", {
      id: "board-picker", class: "board-select", "aria-label": "Available boards",
      onchange: (event) => { this.boardValue = event.target.value; this.message = ""; this.syncForms(); },
    }, choices);
    selector.value = this.boardValue ?? "";
    return h("section", { class: "board-workspace" },
      h("div", { class: "board-toolbar" },
        h("div", null,
          h("strong", null, `${total} ${total === 1 ? "card" : "cards"}`),
          this.projectMappingState(),
        ),
        h("form", { class: "board-create-form", onsubmit: (event) => void this.openBoard(event) },
          selector,
          h("button", { class: "board-button board-button-secondary", type: "submit", disabled: !this.boardValue }, "View board"),
          h("button", { class: "board-button board-button-primary", type: "button", disabled: !this.viewedBoardValue, onclick: () => void this.mapViewedBoard() }, "Map to this project"),
        ),
        h("form", { class: "board-create-form", onsubmit: (event) => void this.createCard(event) }, title, assignee, triage, submit, body),
      ),
      h("p", { class: "board-message", role: this.message ? "alert" : null, "aria-live": "polite" }, this.message),
      h("div", { class: "board-columns", "aria-label": "Hermes Kanban board", "aria-busy": Boolean(this.pendingTaskId) }, this.board.columns.map((column) => this.columnView(column))),
    );
  }

  columnView(column) {
    return h("section", { class: `board-column board-column-${column.name}${column.tasks.length ? "" : " board-column-empty"}`, "aria-labelledby": `column-${column.name}` },
      h("header", { class: "board-column-header" },
        h("h2", { id: `column-${column.name}` }, h("span", { class: "board-status-dot" }), STATUS_LABELS[column.name] ?? column.name),
        h("span", { class: "board-count" }, column.tasks.length),
      ),
      h("div", { class: "board-card-list" },
        column.tasks.length ? column.tasks.map((task) => this.cardView(task)) : h("p", { class: "board-empty" }, `No ${STATUS_LABELS[column.name] ?? column.name} cards. Add one or move a card here.`),
      ),
    );
  }

  cardView(task) {
    const status = h("select", {
      class: "board-select board-card-status", "aria-label": `Move ${task.title}`,
      disabled: Boolean(this.pendingTaskId),
      onchange: (event) => void this.moveCard(task, event.target.value),
    }, KANBAN_STATUSES.map((name) => h("option", { value: name, selected: name === task.status }, STATUS_LABELS[name])));
    const chips = [
      task.assignee ? h("span", { class: "board-chip" }, task.assignee) : null,
      task.tenant ? h("span", { class: "board-chip" }, task.tenant) : null,
      task.priority ? h("span", { class: "board-chip" }, `P${task.priority}`) : null,
      task.progress ? h("span", { class: "board-chip" }, `${task.progress.done}/${task.progress.total}`) : null,
      task.commentCount ? h("span", { class: "board-chip" }, `${task.commentCount} comments`) : null,
    ];
    return h("article", { class: "board-card" },
      h("h3", null, task.title),
      task.summary ? h("p", { class: "board-card-summary" }, task.summary) : null,
      h("div", { class: "board-card-meta" }, chips),
      status,
    );
  }

  syncForms() {
    if (this.checkButton) {
      let valid = false;
      try { normalizeHermesDashboardUrl(this.urlValue); valid = true; } catch { /* rendered on submit */ }
      this.checkButton.disabled = ["discovering", "authenticating", "restoring"].includes(this.state) || !valid;
    }
    if (this.signInButton) this.signInButton.disabled = this.state === "authenticating" || !this.usernameValue.trim() || !this.passwordValue;
    if (this.openButton) this.openButton.disabled = this.state === "opening_board" || !this.boardValue;
    if (this.createButton) this.createButton.disabled = !this.createTitle.trim() || Boolean(this.pendingTaskId);
  }

  async checkAuthentication(event) {
    event.preventDefault();
    if (["discovering", "authenticating", "restoring"].includes(this.state)) return;
    this.state = "discovering";
    this.message = "Checking sign-in options…";
    this.client?.release();
    this.client = null;
    this.board = null;
    this.authSession?.release();
    this.authSession = null;
    this.render();
    try {
      const auth = new DashboardAuthSession({ baseUrl: this.urlValue });
      this.authSnapshot = await auth.discover();
      this.authSession = auth;
      this.providerValue = this.authSnapshot.providers.find((provider) => provider.supportsPassword)?.name ?? "";
      this.state = this.authSnapshot.state;
      this.message = this.authSnapshot.state === "logged_out" ? "Sign in to continue." : "";
    } catch (error) {
      this.authSession?.release();
      this.authSession = null;
      this.authSnapshot = Object.freeze({ state: "disconnected", providers: [], identity: null, label: "" });
      this.state = "disconnected";
      this.message = errorCopy(error);
    }
    this.render();
  }

  async signIn(event) {
    event.preventDefault();
    if (!this.authSession || this.state === "authenticating") return;
    this.state = "authenticating";
    this.message = "Signing in…";
    this.render();
    const username = this.usernameValue;
    const password = this.passwordValue;
    this.usernameValue = "";
    this.passwordValue = "";
    try {
      this.authSnapshot = await this.authSession.login({ provider: this.providerValue, username, password });
      const client = new KanbanClient({ baseUrl: this.urlValue, session: this.authSession });
      this.client?.release();
      this.client = client;
      const project = await this.resolveProject();
      await this.loadBoardCatalog();
      const mappedBoard = await this.restoreProjectMapping(project);
      this.board = null;
      this.state = "board_picker";
      this.message = "";
      await this.persistSession();
      await window.muxy?.tabs?.setTitle?.("Hermes Board");
      if (mappedBoard) {
        this.boardValue = mappedBoard;
        await this.openBoard();
        return;
      }
    } catch (error) {
      this.client?.release();
      this.client = null;
      this.board = null;
      this.authSnapshot = this.authSession.snapshot;
      this.state = this.authSnapshot.state === "logged_in" ? "board_picker" : this.authSnapshot.state === "session_expired" ? "session_expired" : "logged_out";
      this.message = errorCopy(error);
      if (this.state === "session_expired") await this.sessionBroker.clearDashboard();
    } finally {
      this.usernameValue = "";
      this.passwordValue = "";
    }
    this.render();
  }

  async loadBoardCatalog(preferred = null) {
    if (!this.client) throw new Error("Sign in to the Hermes dashboard first.");
    this.catalog = await this.client.listBoards();
    this.boardValue = selectBoardSlug(this.catalog, preferred);
  }

  async openBoard(event) {
    event?.preventDefault();
    if (!this.client || !this.boardValue || this.state === "opening_board") return;
    this.state = "opening_board";
    this.message = "Opening board…";
    this.render();
    try {
      this.client.setBoard(this.boardValue);
      this.board = await this.client.loadBoard();
      this.viewedBoardValue = this.boardValue;
      this.state = "ready";
      this.message = "";
      await this.persistSession();
      await window.muxy?.tabs?.setTitle?.(`Hermes Board · ${this.viewedBoardValue}`);
    } catch (error) {
      this.board = null;
      const recovered = await this.recoverMissingMappedBoard(error);
      if (!recovered) this.handleActionError(error);
      if (this.state !== "session_expired" && this.state !== "board_picker") this.state = "board_picker";
    }
    this.render();
  }

  async logout() {
    this.client?.release();
    this.client = null;
    this.board = null;
    this.catalog = Object.freeze({ boards: Object.freeze([]), current: null });
    this.boardValue = null;
    this.viewedBoardValue = null;
    try {
      if (this.authSession) this.authSnapshot = await this.authSession.logout();
    } catch {
      this.authSession?.release();
      this.authSnapshot = this.authSession?.snapshot ?? Object.freeze({ state: "logged_out", providers: [], identity: null, label: "" });
    }
    this.usernameValue = "";
    this.passwordValue = "";
    this.state = "logged_out";
    this.message = "Logged out.";
    await this.sessionBroker.clearDashboard();
    void window.muxy?.tabs?.setTitle?.("");
    this.render();
  }

  async refresh({ silent = false } = {}) {
    if (this.released || !this.client || this.state !== "ready" || this.pendingTaskId || this.boardRefreshInFlight || this.sessionCheckInFlight) return;
    this.boardRefreshInFlight = true;
    if (!silent) {
      this.message = "Refreshing…";
      this.render();
    }
    let shouldRender = !silent;
    try {
      const board = await this.client.loadBoard();
      if (!this.released) {
        shouldRender ||= JSON.stringify(board) !== JSON.stringify(this.board);
        this.board = board;
      }
      if (!silent) {
        this.message = "";
        await this.persistSession();
      }
    } catch (error) {
      const recovered = await this.recoverMissingMappedBoard(error);
      if (!recovered) this.handleActionError(error);
      shouldRender = true;
    } finally {
      this.boardRefreshInFlight = false;
    }
    if (!this.released && shouldRender) this.render();
  }

  async createCard(event) {
    event.preventDefault();
    if (!this.client || !this.createTitle.trim() || this.pendingTaskId) return;
    this.pendingTaskId = "creating";
    this.message = "Creating card…";
    this.render();
    try {
      await this.client.createTask({
        title: this.createTitle,
        body: this.createBody,
        assignee: this.createAssignee || null,
        triage: this.createInTriage,
        idempotencyKey: `muxy-${globalThis.crypto.randomUUID()}`,
      });
      this.createTitle = "";
      this.createBody = "";
      this.board = await this.client.loadBoard();
      this.message = "Card created.";
      await this.persistSession();
    } catch (error) {
      this.handleActionError(error);
    }
    this.pendingTaskId = null;
    this.render();
  }

  async moveCard(task, nextStatus) {
    if (!this.client || this.pendingTaskId || nextStatus === task.status) return;
    if (["blocked", "done"].includes(nextStatus)) {
      const confirmed = await window.muxy?.dialog?.confirm?.({
        title: `Move card to ${STATUS_LABELS[nextStatus]}?`,
        message: task.title,
        buttons: ["Cancel", "Move"],
        default: "Cancel",
        cancel: "Cancel",
        style: "warning",
      });
      if (confirmed !== "Move") {
        this.render();
        return;
      }
    }
    this.pendingTaskId = task.id;
    this.message = `Moving card to ${STATUS_LABELS[nextStatus]}…`;
    this.render();
    try {
      await this.client.updateStatus(task.id, nextStatus);
      this.board = await this.client.loadBoard();
      this.message = "Card moved.";
      await this.persistSession();
    } catch (error) {
      this.handleActionError(error);
    }
    this.pendingTaskId = null;
    this.render();
  }

  async resolveProject() {
    this.activeProject = await resolveActiveProject(window.muxy);
    return this.activeProject;
  }

  projectMappingState() {
    const projectName = this.activeProject?.name ?? "Current project";
    const mappedBoard = this.catalog.boards.find((candidate) => candidate.slug === this.mappedBoardValue);
    const boardName = mappedBoard?.name ?? this.mappedBoardValue;
    return h("p", { class: "board-project-mapping", role: "status" },
      h("strong", null, `Project: ${projectName}`),
      h("span", null, boardName ? `Mapped board: ${boardName}` : "No board mapped to this project"),
    );
  }

  async restoreProjectMapping(project) {
    const restored = await restoreProjectBoardMapping({
      sessionBroker: this.sessionBroker,
      projectID: project.id,
      baseUrl: this.urlValue,
      boards: this.catalog.boards,
    });
    this.mappedBoardValue = restored.board;
    if (restored.stale) this.message = "That mapped board is no longer available. Choose another board.";
    return restored.board;
  }

  async mapViewedBoard() {
    if (!this.viewedBoardValue || !this.urlValue) return;
    try {
      const project = await this.resolveProject();
      const saved = await this.sessionBroker.saveBoardMapping({
        projectID: project.id,
        baseUrl: this.urlValue,
        board: this.viewedBoardValue,
      });
      if (!saved) throw new Error("Could not save this project board mapping.");
      this.mappedBoardValue = this.viewedBoardValue;
      this.message = `Mapped ${this.viewedBoardValue} to ${project.name}.`;
    } catch (error) {
      this.message = errorCopy(error);
    }
    this.render();
  }

  async recoverMissingMappedBoard(error) {
    if (!(error instanceof KanbanClientError) || error.status !== 404
      || !this.activeProject || this.mappedBoardValue !== this.viewedBoardValue) return false;
    try {
      await this.loadBoardCatalog();
      if (this.catalog.boards.some((candidate) => candidate.slug === this.mappedBoardValue)) return false;
      await this.sessionBroker.clearBoardMapping({ projectID: this.activeProject.id });
      this.mappedBoardValue = null;
      this.viewedBoardValue = null;
      this.board = null;
      this.boardValue = selectBoardSlug(this.catalog);
      this.state = "board_picker";
      this.message = "That mapped board is no longer available. Choose another board.";
      return true;
    } catch { /* retain the original request failure when catalog recovery fails */ }
    return false;
  }

  handleActionError(error) {
    if ((error instanceof DashboardAuthError && error.code === "session_expired") ||
      (error instanceof KanbanClientError && error.code === "dashboard_authentication_failed")) {
      this.client?.release();
      this.client = null;
      this.board = null;
      this.catalog = Object.freeze({ boards: Object.freeze([]), current: null });
      this.authSession?.release();
      this.authSnapshot = Object.freeze({ state: "session_expired", providers: [], identity: null, label: "" });
      this.state = "session_expired";
      void this.sessionBroker.clearDashboard();
      void window.muxy?.tabs?.setTitle?.("");
    }
    this.message = errorCopy(error);
  }

  async restoreSavedSession() {
    const saved = await this.sessionBroker.readDashboard();
    if (!saved || this.state === "ready") return;
    this.urlValue = saved.baseUrl;
    this.state = "restoring";
    this.message = "";
    this.render();
    try {
      const auth = DashboardAuthSession.fromSession({ baseUrl: saved.baseUrl, session: saved.auth });
      this.authSession = auth;
      this.authSnapshot = await auth.verify();
      this.lastSessionCheckAt = Date.now();
      this.providerValue = this.authSnapshot.providers.find((provider) => provider.supportsPassword)?.name ?? "";
      const client = new KanbanClient({ baseUrl: saved.baseUrl, session: auth });
      this.client?.release();
      this.client = client;
      const project = await this.resolveProject();
      await this.loadBoardCatalog();
      const mappedBoard = await this.restoreProjectMapping(project);
      this.board = null;
      this.state = "board_picker";
      await this.persistSession();
      await window.muxy?.tabs?.setTitle?.("Hermes Board");
      if (mappedBoard) {
        this.boardValue = mappedBoard;
        await this.openBoard();
        return;
      }
    } catch (error) {
      this.client?.release();
      this.client = null;
      this.board = null;
      this.authSnapshot = this.authSession?.snapshot ?? Object.freeze({ state: "session_expired", providers: [], identity: null, label: "" });
      this.state = this.authSnapshot.state === "session_expired" ? "session_expired" : "disconnected";
      this.message = errorCopy(error);
      if (this.state === "session_expired") await this.sessionBroker.clearDashboard();
    }
    this.render();
  }

  async persistSession() {
    const auth = this.authSession?.exportSession();
    if (!auth || !this.urlValue) return;
    await this.sessionBroker.saveDashboard({ baseUrl: this.urlValue, auth });
  }

  async verifySavedSession() {
    if (!["ready", "board_picker"].includes(this.state) || !this.authSession || this.sessionCheckInFlight || this.pendingTaskId) return;
    this.sessionCheckInFlight = true;
    try {
      this.authSnapshot = await this.authSession.verify();
      this.lastSessionCheckAt = Date.now();
      await this.persistSession();
    } catch (error) {
      this.lastSessionCheckAt = Date.now();
      this.handleActionError(error);
    } finally {
      this.sessionCheckInFlight = false;
      this.render();
    }
  }
}
