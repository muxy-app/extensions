/**
 * GSD Control Tower — panel application.
 * Owns inventory + GSD parsing (webview-only APIs), renders recorded project
 * state and agent activity, and provides search, diagnostics, and preferences.
 *
 * Navigation model: two base views (`list`, `project`) plus full-body overlays
 * (`settings`, `diagnostics`). The panel defaults into the active project's
 * view once inventory is known; every non-list surface has an explicit way back.
 */
import { h, clear } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import {
  initialState, wsKey,
  applyInventory, applyAgentEvent, applyAgentHydration, applyFileChanged,
  applyHeadChanged, applyWorkstreamData, pushDiagnostic, setDiagnostics,
} from "../core/reducer.js";
import { buildRows, filterRows } from "../core/selectors.js";
import {
  PARSER_VERSION, EXTENSION_VERSION, BOUNDS,
} from "../core/types.js";
import { buildGsdSnapshot } from "../core/gsd/parse-planning.js";
import { bridge, call, hasCapability, fileSource, normalizeAgentItems } from "../host/muxy.js";
import {
  loadPrefs, savePrefs, resetPrefs, REFRESH_INTERVAL_OPTIONS, refreshDue,
} from "../host/prefs.js";

/** Muxy runtime state → semantic CSS custom property (see global.css). */
export function stateColor(runtimeState) {
  return `var(--st-${runtimeState}, var(--st-idle))`;
}

export function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export class ControlTowerApp {
  constructor(root) {
    this.root = root;
    this.state = initialState();
    this.prefs = null;
    this.view = "list"; // base views: list | project
    this.overlay = null; // full-body overlays: null | "settings" | "diagnostics"
    this.selectedKey = null;
    this.didAutoFocus = false;
    this.expandedPhases = new Set();
    this.banner = null;
    this.refreshing = false;
    this.refreshQueued = false;
    this.loaded = false;
    this.reparseTimers = new Map();
    this.savePrefsTimer = null;
    this.searchTimer = null;
    this.maintenanceTimer = null;
    this.scrollPositions = new Map();
  }

  async start() {
    this.prefs = await loadPrefs();
    this.wireEvents();
    this.wireKeyboard();
    this.render();
    this.fullRefresh();
    // Check the user-selected planning/Git refresh interval. Agent state stays
    // event-driven through `agent.status`.
    this.maintenanceTimer = setInterval(() => {
      this.maybeAutoRefresh();
    }, 30_000);
  }

  // ---------------------------------------------------------------- events --

  wireEvents() {
    const m = bridge();
    if (!m?.events) return;
    const sub = (name, handler) => {
      try {
        m.events.subscribe(name, handler);
        this.state.diagnostics.subscriptions.push(name);
      } catch (e) {
        this.banner = { kind: "error", message: `Cannot subscribe to ${name}: ${e.message}` };
      }
    };

    sub("agent.status", (evt) => {
      this.state = applyAgentEvent(this.state, evt);
      this.render();
    });

    sub("file.changed", (evt) => {
      this.state = applyFileChanged(this.state, evt);
      this.scheduleTargetedReparse(evt);
      this.render();
    });

    sub("projects.changed", () => this.debounce("projects.changed", () => this.fullRefresh(), 600));

    sub("project.switched", () => this.debounce("project.switched", () => this.refreshActiveFlags(), 300));

    sub("worktree.switched", (evt) => {
      // The project's active worktree changed → its planning view must be re-read.
      this.debounce(`wt.${evt?.projectID}`, () => this.refreshProjectById(evt?.projectID), 300);
    });

    sub("worktree.headChanged", (evt) => {
      this.state = applyHeadChanged(this.state, evt);
      this.render();
    });

    sub("command.refresh-tower", () => this.fullRefresh());
    sub("command.toggle-diagnostics", () => this.toggleOverlay("diagnostics"));
    if (hasCapability("onFocus")) {
      m.onFocus((focused) => {
        if (!focused) return;
        this.maybeAutoRefresh();
        this.render();
      });
    }
  }

  wireKeyboard() {
    document.addEventListener("keydown", (event) => {
      const key = event.key;
      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "f") {
        if (this.overlay || this.view !== "list") this.goHome();
        event.preventDefault();
        requestAnimationFrame(() => this.root.querySelector("#ct-search")?.focus());
        return;
      }
      if (key === "Escape") {
        if (this.overlay) this.closeOverlay();
        else if (this.view === "project") this.goHome();
        else return;
        event.preventDefault();
        return;
      }
      if ((key !== "ArrowDown" && key !== "ArrowUp")
        || this.overlay || this.view !== "list"
        || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      const rows = [...this.root.querySelectorAll(".ct-row")];
      if (!rows.length) return;
      const current = rows.indexOf(document.activeElement);
      const next = key === "ArrowDown"
        ? Math.min(rows.length - 1, current < 0 ? 0 : current + 1)
        : Math.max(0, current < 0 ? rows.length - 1 : current - 1);
      rows[next]?.focus();
      event.preventDefault();
    });
  }

  maybeAutoRefresh(now = Date.now()) {
    if (this.refreshing) return false;
    if (typeof document !== "undefined" && document.hidden) return false;
    if (!refreshDue(
      this.state.diagnostics.lastFullRefresh,
      this.prefs?.refreshIntervalMinutes ?? 5,
      now,
    )) return false;
    this.fullRefresh();
    return true;
  }

  debounce(token, fn, ms) {
    const existing = this.reparseTimers.get(token);
    if (existing) clearTimeout(existing);
    this.reparseTimers.set(token, setTimeout(() => {
      this.reparseTimers.delete(token);
      fn();
    }, ms));
  }

  /** `file.changed` only covers the active project — reparse just that one (FR-031). */
  scheduleTargetedReparse(evt) {
    const path = String(evt?.path ?? "");
    if (!isPlanningPath(path)) return;
    const project = this.findProjectByPath(evt?.projectPath);
    if (!project) return;
    this.debounce(`reparse.${project.id}`, () => this.refreshProject(project, { quiet: true }), 350);
  }

  findProjectByPath(projectPath) {
    if (!projectPath) return this.state.projects.find((p) => p.isActive) ?? null;
    const norm = String(projectPath).replace(/\/+$/, "");
    return this.state.projects.find((p) => String(p.path).replace(/\/+$/, "") === norm) ?? null;
  }

  // --------------------------------------------------------------- refresh --

  async fullRefresh() {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    this.render();
    let refreshed = false;
    try {
      do {
        this.refreshQueued = false;
        refreshed = (await this.performFullRefresh()) || refreshed;
      } while (this.refreshQueued);
    } finally {
      this.refreshing = false;
      if (refreshed) {
        this.loaded = true;
        this.maybeAutoFocusActiveProject();
      }
      this.render();
    }
  }

  async performFullRefresh() {
    const m = bridge();

    const projectsRes = await call("projects.list", () => m.projects.list());
    if (!projectsRes.ok) {
      this.banner = {
        kind: projectsRes.error.kind === "permission" ? "permission" : "error",
        message: projectsRes.error.message,
      };
      this.recordProbe("projects.list", projectsRes.error);
      this.state = pushDiagnostic(this.state, {
        at: new Date().toISOString(),
        message: `projects.list: ${projectsRes.error.message}`,
        context: "inventory",
      });
      return false;
    }
    this.recordProbe("projects.list", null);
    const projects = normalizeProjects(projectsRes.value);

    const worktreesByProject = new Map();
    const inventoryFailures = [];
    for (const project of projects) {
      const res = await call("worktrees.list", () => m.worktrees.list(project.id));
      this.recordProbe("worktrees.list", res.error);
      const worktrees = normalizeWorktrees(res.value);
      if (res.ok && worktrees.length) {
        worktreesByProject.set(project.id, worktrees);
      } else if (res.ok) {
        // A successful empty response is a legitimate project-without-worktrees.
        worktreesByProject.set(project.id, [{ id: null, name: "root", path: project.path, isPrimary: true }]);
      } else {
        const warning = "Project details unavailable";
        inventoryFailures.push({ project, error: res.error });
        worktreesByProject.set(project.id, [{
          id: null,
          name: "project scope",
          path: project.path,
          isPrimary: true,
          inventoryWarning: warning,
        }]);
        this.state = pushDiagnostic(this.state, {
          at: new Date().toISOString(),
          message: `${project.name}: worktrees.list: ${res.error.message}`,
          context: "inventory",
        });
      }
    }

    if (inventoryFailures.length) {
      const denied = inventoryFailures.some(({ error }) => error.kind === "permission");
      this.banner = {
        kind: denied ? "permission" : "error",
        message: `${inventoryFailures.length} project${inventoryFailures.length === 1 ? "" : "s"} could not be fully loaded. See Diagnostics.`,
      };
    }

    this.state = applyInventory(this.state, projects, worktreesByProject);
    this.state = setDiagnostics(this.state, {
      lastFullRefresh: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
    });

    await this.forEachLimited(projects, 4, (project) => this.refreshProject(project, { quiet: true }));

    // Hydrate agent states (FR-020).
    const agentsRes = await call("agents.list", () => m.agents.list());
    this.recordProbe("agents.list", agentsRes.error);
    if (agentsRes.ok) {
      this.state = applyAgentHydration(this.state, normalizeAgentItems(agentsRes.value));
    } else if (agentsRes.error.kind !== "unavailable") {
      this.state = pushDiagnostic(this.state, {
        at: new Date().toISOString(),
        message: `agents.list: ${agentsRes.error.message}`,
        context: "hydration",
      });
    }

    return true;
  }

  /**
   * First-load default: land INSIDE the project the user is currently in,
   * instead of the cross-project list. Runs once per panel open; explicit
   * navigation afterwards always wins.
   */
  maybeAutoFocusActiveProject() {
    if (this.didAutoFocus || !this.loaded || this.overlay) return;
    if (this.prefs?.openOnActiveProject === false) {
      this.didAutoFocus = true;
      return;
    }
    const rows = this.currentRows();
    const activeProjectId = this.state.projects.find((project) => project.isActive)?.id;
    const candidates = activeProjectId
      ? rows.filter((row) => row.projectId === activeProjectId)
      : rows;
    const target =
      candidates.find((r) => r.isActiveWorktree && r.isGsd && r.gsd) ??
      candidates.find((r) => r.isActiveWorktree && r.isGsd) ??
      candidates.find((r) => r.isActiveWorktree) ??
      candidates[0];
    if (!target) return;
    this.didAutoFocus = true;
    this.view = "project";
    this.selectedKey = target.key;
  }

  /** Re-read inventory flags (active project) without full reparse. */
  async refreshActiveFlags() {
    const m = bridge();
    const res = await call("projects.list", () => m.projects.list());
    if (!res.ok) return;
    const projects = normalizeProjects(res.value);
    const worktreesByProject = new Map();
    for (const project of projects) {
      const existing = this.state.worktreesByProject.get(project.id);
      worktreesByProject.set(project.id, existing ?? [{ id: null, name: "root", path: project.path }]);
    }
    this.state = applyInventory(this.state, projects, worktreesByProject);
    this.render();
  }

  async refreshProjectById(projectId) {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (project) await this.refreshProject(project, { quiet: true });
  }

  /**
   * Parse one project's `.planning/` + git context and merge into the store.
   * Reads target the project's active worktree via the `{ project }` selector.
   */
  async refreshProject(project, { quiet = false } = {}) {
    const m = bridge();
    const trees = this.state.worktreesByProject.get(project.id)
      ?? [{ id: null, name: "root", path: project.path }];

    // Which worktree is active? git.repoInfo().root is the active worktree root.
    let activeRoot;
    const repoRes = await call("git.repoInfo", () => m.git.repoInfo({ project: project.id }));
    this.recordProbe("git.repoInfo", repoRes.error);
    if (repoRes.ok && repoRes.value?.root) activeRoot = String(repoRes.value.root).replace(/\/+$/, "");

    const at = new Date().toISOString();
    let gsd = null;
    let gsdError = null;
    try {
      const result = await buildGsdSnapshot(fileSource(project.id), { now: new Date(at) });
      if (result.recognized) gsd = result.gsd;
    } catch (e) {
      gsdError = e;
      if (!quiet) this.banner = { kind: e.kind === "permission" ? "permission" : "error", message: `${project.name}: ${e.message}` };
      this.state = pushDiagnostic(this.state, {
        at, message: `${project.name}: ${e.message}`, context: "gsd-parse",
      });
    }
    if (gsdError?.kind === "permission") this.recordProbe("files.read", gsdError);

    const git = {};
    const statusRes = await call("git.status", () => m.git.status({ local: true, project: project.id }));
    this.recordProbe("git.status", statusRes.error);
    if (statusRes.ok && statusRes.value) {
      git.branch = statusRes.value.branch;
      git.dirtyCount =
        (statusRes.value.stagedFiles?.length ?? 0) + (statusRes.value.unstagedFiles?.length ?? 0);
    }
    const logRes = await call("git.log", () => m.git.log({ maxCount: 1, project: project.id }));
    if (logRes.ok && Array.isArray(logRes.value) && logRes.value[0]) {
      git.lastCommitAt = logRes.value[0].authorDate;
      git.lastCommitSubject = logRes.value[0].subject;
    }

    let matched = false;
    for (const wt of trees) {
      const key = wsKey(project.id, wt.id ?? null);
      const isActive = activeRoot
        ? String(wt.path ?? "").replace(/\/+$/, "") === activeRoot
        : !!wt.isPrimary || trees.length === 1;
      if (isActive && !matched) {
        matched = true;
        this.state = applyWorkstreamData(this.state, key, {
          isGsd: !!gsd,
          gsd: gsd ?? undefined,
          gsdUnavailableReason: gsd
            ? undefined
            : (gsdError
              ? `Planning data unavailable — ${gsdError.message}`
              : "No .planning/ directory — not a GSD project"),
          git,
          at,
          isActiveWorktree: true,
        });
      } else {
        this.state = applyWorkstreamData(this.state, key, {
          isGsd: false,
          gsdUnavailableReason: "Planning state is read from this project's active worktree",
          git: { ...git, branch: wt.branch ?? git.branch },
          at,
          isActiveWorktree: false,
        });
      }
    }
    this.render();
  }

  async forEachLimited(items, limit, fn) {
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++];
        await fn(item);
      }
    });
    await Promise.all(workers);
  }

  currentRows() {
    return buildRows(this.state, this.prefs ?? {});
  }

  currentProjectRow() {
    return this.currentRows().find((r) => r.key === this.selectedKey);
  }

  recordProbe(capability, error) {
    if (!capability) return;
    const probes = { ...this.state.diagnostics.permissionProbes };
    if (!error) probes[capability] = true;
    else if (error.kind === "permission") probes[capability] = false;
    else if (!(capability in probes)) probes[capability] = true;
    this.state = setDiagnostics(this.state, { permissionProbes: probes });
  }

  // ------------------------------------------------------------- navigation --

  goHome() {
    this.overlay = null;
    this.view = "list";
    this.render();
  }

  openProject(row) {
    this.overlay = null;
    this.view = "project";
    this.selectedKey = row.key;
    this.render();
  }

  toggleOverlay(name) {
    this.overlay = this.overlay === name ? null : name;
    this.render();
  }

  closeOverlay() {
    this.overlay = null;
    this.render();
  }

  async toggleProjectHidden(projectId) {
    const hidden = new Set(this.prefs.hiddenProjects);
    if (hidden.has(projectId)) hidden.delete(projectId);
    else hidden.add(projectId);
    this.prefs = { ...this.prefs, hiddenProjects: [...hidden] };
    await this.persistPrefs();
    this.render();
  }

  async persistPrefs() {
    clearTimeout(this.savePrefsTimer);
    this.savePrefsTimer = setTimeout(() => savePrefs(this.prefs), 500);
  }

  // ------------------------------------------------------------------ render --

  scrollKey() {
    if (this.overlay) return `overlay:${this.overlay}`;
    if (this.view === "project") return `project:${this.selectedKey ?? "unknown"}`;
    return "list";
  }

  rememberScrollPosition() {
    const body = this.root?.querySelector?.(".ct-body[data-scroll-key]");
    const key = body?.dataset?.scrollKey;
    if (key) this.scrollPositions.set(key, body.scrollTop ?? 0);
  }

  restoreScrollPosition() {
    const body = this.root?.querySelector?.(".ct-body[data-scroll-key]");
    const key = body?.dataset?.scrollKey;
    if (key) body.scrollTop = this.scrollPositions.get(key) ?? 0;
  }

  render() {
    this.rememberScrollPosition();
    const active = document.activeElement;
    const focusId = active?.dataset?.preserveFocus ?? null;
    const selStart = active?.selectionStart ?? null;
    const selEnd = active?.selectionEnd ?? null;

    // Fail safe: a throw during view construction used to leave the panel
    // completely blank with no way back. Render an error card instead.
    try {
      clear(this.root);
      this.root.appendChild(this.viewRoot());
    } catch (e) {
      try {
        this.state = pushDiagnostic(this.state, {
          at: new Date().toISOString(),
          message: `render: ${e?.message ?? e}`,
          context: "panel-render",
        });
      } catch { /* keep the error card rendering */ }
      clear(this.root);
      this.root.appendChild(this.renderEmpty(
        "warning", "Panel hit a rendering problem", String(e?.message ?? e)));
    }

    if (focusId) {
      const el = this.root.querySelector(`[data-preserve-focus="${focusId}"]`);
      if (el) {
        el.focus();
        try { el.setSelectionRange(selStart, selEnd); } catch { /* not a text input */ }
      }
    }
    this.restoreScrollPosition();
  }

  viewRoot() {
    const rows = this.currentRows();
    const body = this.renderBody(rows);
    body.dataset.scrollKey = this.scrollKey();

    return h("div", { class: "ct-root" },
      this.renderHeader(rows),
      this.renderBanner(),
      body,
    );
  }

  renderHeader(rows) {
    const visibleCount = this.view === "list" && !this.overlay
      ? filterRows(rows, this.prefs?.filters ?? {}).filter((row) => this.prefs?.showNonGsd || row.isGsd).length
      : null;
    const overlayBtn = (id, iconName, label, name) =>
      h("button", {
        class: "ct-iconbtn", "data-active": this.overlay === name,
        "aria-label": label, title: label, "data-preserve-focus": `vb-${id}`,
        onclick: () => this.toggleOverlay(name),
      }, icon(iconName));

    // Breadcrumbs: brand doubles as Home; the current location follows it.
    const crumbs = [h("button", {
      class: "ct-crumb", "data-home": this.view === "list" && !this.overlay,
      title: "All projects", "aria-label": "All projects",
      onclick: () => this.goHome(),
    }, icon("tower", 14), h("span", { class: "ct-crumb-label" }, "Control Tower"))];

    if (this.overlay === "settings") {
      crumbs.push(crumbSep(), h("span", { class: "ct-crumb-current" }, "Preferences"));
    } else if (this.overlay === "diagnostics") {
      crumbs.push(crumbSep(), h("span", { class: "ct-crumb-current" }, "Diagnostics"));
    } else if (this.view === "project") {
      crumbs.push(crumbSep(), h("span", { class: "ct-crumb-current" },
        rows.find((r) => r.key === this.selectedKey)?.projectName ?? "Project"));
    }

    return h("header", { class: "ct-header" },
      h("div", { class: "ct-title-row" },
        h("div", { class: "ct-crumbs" }, ...crumbs),
        visibleCount == null ? null : h("span", {
          class: "ct-count",
          title: countLabel(visibleCount, "visible workstream"),
        },
          icon("layers", 12),
          countLabel(visibleCount, "workstream"),
        ),
        h("span", { class: "ct-spacer" }),
        this.refreshing
          ? h("button", { class: "ct-iconbtn", disabled: true, "aria-busy": "true", "aria-label": "Refreshing all workstreams", title: "Refreshing…" },
              h("span", { class: "ct-refresh-spin", style: "display:inline-flex" }, icon("refresh", 14)))
          : h("button", {
              class: "ct-iconbtn", "aria-label": "Refresh all", title: "Refresh all workstreams",
              onclick: () => this.fullRefresh(),
            }, icon("refresh", 14)),
        h("div", { class: "ct-viewtabs" },
          overlayBtn("settings", "gear", "Preferences", "settings"),
          overlayBtn("diag", "info", "Diagnostics", "diagnostics"),
        ),
      ),
      !this.overlay && this.view === "list" ? this.renderFilterRow() : null,
    );
  }

  renderFilterRow() {
    const f = this.prefs?.filters ?? { query: "" };

    return h("div", { class: "ct-searchrow" },
      h("div", { class: "ct-searchwrap" },
        icon("search", 13),
        h("input", {
          id: "ct-search", class: "ct-search", type: "search", placeholder: "Filter workstreams…",
          "aria-label": "Filter workstreams",
          value: f.query, "data-preserve-focus": "search", spellcheck: "false",
          oninput: (e) => {
            clearTimeout(this.searchTimer);
            const value = e.target.value;
            this.searchTimer = setTimeout(() => {
              this.prefs = { ...this.prefs, filters: { ...this.prefs.filters, query: value } };
              this.persistPrefs();
              this.render();
            }, 160);
          },
        }),
      ),
    );
  }

  renderBanner() {
    if (!this.banner) return null;
    const kind = this.banner.kind;
    const color = kind === "error" ? "var(--muxy-diff-remove)"
      : kind === "permission" ? "var(--muxy-diff-hunk, var(--muxy-foreground-muted))"
      : "var(--muxy-accent)";
    const iconName = kind === "info" ? "info" : "warning";
    return h("div", { class: "ct-banner", style: `--banner-color:${color}; margin: var(--s3) var(--s5) 0` },
      icon(iconName, 14),
      h("div", { class: "ct-truncate", style: "flex:1" }, this.banner.message),
      h("button", { class: "ct-iconbtn", "aria-label": "Dismiss", onclick: () => { this.banner = null; this.render(); } },
        h("span", { style: "font-size:var(--font-emphasis); line-height:1" }, "×")),
    );
  }

  renderBody(rows) {
    if (this.overlay === "settings") return this.renderSettings();
    if (this.overlay === "diagnostics") return this.renderDiagnostics();
    if (this.view === "project") return this.renderProject();
    return this.renderList(rows);
  }

  renderList(rows) {
    const body = h("div", { class: "ct-body" });

    if (!this.loaded && !rows.length) {
      body.appendChild(this.renderEmpty(
        "tower", "Reading workstreams…",
        "Loading projects and GSD activity."));
      return body;
    }

    if (!this.state.projects.length) {
      body.appendChild(this.renderEmpty(
        "layers", "No Muxy projects yet",
        "Add a project in Muxy to see its GSD progress and agent activity."));
      return body;
    }

    const visible = filterRows(rows, this.prefs?.filters ?? {});
    const showNonGsd = !!this.prefs?.showNonGsd;
    const listed = visible.filter((row) => showNonGsd || row.isGsd);
    const hiddenNonGsd = visible.filter((row) => !row.isGsd).length;

    if (listed.length) {
      body.appendChild(h("div", { class: "ct-section-label" }, "All workstreams", h("span", null, `· ${listed.length}`)));
      const card = h("div", { class: "ct-card", role: "list" });
      for (const row of listed) card.appendChild(this.renderRow(row));
      body.appendChild(card);
    }

    if (!visible.length) {
      body.appendChild(this.renderEmpty(
        "search", "Nothing matches",
        "Adjust the search to see more workstreams."));
    }

    if (!showNonGsd && hiddenNonGsd > 0) {
      body.appendChild(h("div", {
        class: "ct-section-label", style: "justify-content:center; text-transform:none; letter-spacing:0",
        title: "Projects that do not use GSD are hidden by default.",
      }, `${hiddenNonGsd} non-GSD project${hiddenNonGsd === 1 ? "" : "s"} hidden — enable in Preferences`));
    }

    const last = this.state.diagnostics.lastFullRefresh;
    if (last) {
      body.appendChild(h("div", {
        class: "ct-section-label", style: "margin-top: var(--s5); justify-content:center",
        title: "Open the panel or refresh to check every project again.",
      }, `Refreshed ${relativeTime(last)}`));
    }
    return body;
  }

  renderEmpty(iconName, title, hint) {
    return h("div", { class: "ct-empty" }, icon(iconName, 14), h("div", { style: "font-weight:600; color:var(--muxy-foreground)" }, title), h("div", { class: "hint" }, hint));
  }

  renderRow(row) {
    const gsd = row.gsd;
    const provider = row.agent?.providerId;
    const runtime = row.agent?.runtimeState ?? "unavailable";
    const line2 = verificationSummary(gsd)
      ?? summarizeGsd(gsd, row)
      ?? row.inventoryWarning
      ?? row.gsdUnavailableReason
      ?? (row.isGsd ? " " : "No GSD planning data");

    return h("button", {
      class: "ct-row", role: "listitem", "data-selected": this.selectedKey === row.key,
      "aria-label": `${row.projectName}: ${formatRuntime(runtime)}`,
      onclick: () => this.openProject(row),
    },
      h("span", {
        class: "ct-statusmark", style: `--dot:${stateColor(runtime)}`,
        "data-pulse": runtime === "waiting", "aria-hidden": "true",
      }, icon(statusIconName(runtime), 14)),
      h("span", { class: "ct-main" },
        h("span", { class: "ct-line1" },
          h("span", { class: "ct-proj" }, row.projectName),
          row.worktreeName && row.worktreeName !== "root"
            ? h("span", { class: "ct-wt" }, `⎇ ${row.git?.branch || row.worktreeName}`)
            : (row.git?.branch ? h("span", { class: "ct-wt" }, `⎇ ${row.git.branch}`) : null),
        ),
        h("span", { class: "ct-line2" }, line2),
      ),
      h("span", { class: "ct-side" },
        provider ? h("span", { class: "ct-provider", title: `Agent: ${formatProvider(provider)}` }, formatProvider(provider)) : null,
        runtime !== "unavailable" ? h("span", { class: "ct-runtime" }, formatRuntime(runtime)) : null,
        h("span", { class: "ct-time" }, relativeTime(freshestTimestamp(row))),
        icon("chevronRight", 12),
      ),
    );
  }

  // ------------------------------------------------------------ project view --

  renderProject() {
    const row = this.currentProjectRow();
    const body = h("div", { class: "ct-body" });
    if (!row) {
      body.appendChild(this.renderEmpty("info", "Project not found", "It may have been excluded or removed."));
      return body;
    }

    const gsd = row.gsd;
    const runtime = row.agent?.runtimeState ?? "unavailable";
    const stateColorValue = stateColor(runtime);

    // -- breadcrumb head (explicit way back to the tower)
    body.appendChild(h("div", { class: "ct-detail-head" },
      h("button", { class: "ct-backbtn", onclick: () => this.goHome() },
        icon("chevronLeft", 13), "All projects"),
      h("span", { class: "ct-spacer" }),
      h("span", { class: "ct-detail-title" }, row.projectName),
    ));

    // -- recorded state summary; displayed verbatim, never interpreted
    body.appendChild(h("div", { class: "ct-statecard", style: `--dot:${stateColorValue}` },
      h("span", {
        class: "ct-statusmark", style: `--dot:${stateColorValue}`,
        "data-pulse": runtime === "waiting", "aria-hidden": "true",
      }, icon("info", 14)),
      h("div", { class: "ct-state-main" },
        h("div", { class: "label" }, "Recorded GSD state"),
        h("div", { style: "font-size:var(--font-body)" },
          gsd?.statusLine ?? gsd?.frontmatterStatus
            ?? summarizeGsd(gsd, row) ?? row.gsdUnavailableReason ?? "No status recorded."),
      ),
    ));

    // -- refresh action
    const actions = h("div", { class: "ct-actions" },
      h("button", {
        class: "ct-btn",
        onclick: () => {
          const project = this.state.projects.find((p) => p.id === row.projectId);
          if (project) this.refreshProject(project, { quiet: false });
        },
      }, icon("refresh", 13), "Refresh"),
    );
    if (gsd) {
      // -- next action derived only from structured artifacts
      if (gsd.nextAction) {
        body.appendChild(h("div", { class: "ct-nextaction", style: "margin-top: var(--s4)" },
          icon("bolt", 14), h("div", null, h("strong", null, "Next: "), gsd.nextAction)));
      }

      body.appendChild(actions);

      // -- milestone progress from declared checklists/counts, never raw percent
      const progress = structuredProgress(gsd);
      if (progress) {
        body.appendChild(h("div", { class: "ct-card", style: "margin-top: var(--s4); padding: var(--s2) 0" },
          h("div", { class: "ct-progress" }, h("div", { style: `width:${progress.percent}%` })),
          h("div", { style: "text-align:center; font-size:var(--font-caption); color:var(--muxy-foreground-muted); padding-bottom: var(--s2)" },
            `${gsd.milestone ? `${gsd.milestone} · ` : ""}${progress.label}`),
        ));
      }

      // -- phase pipeline
      const phases = Array.isArray(gsd.phases) ? gsd.phases : [];
      if (phases.length) {
        const doneCount = phases.filter((p) => p.done).length;
        body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s5)" },
          h("div", { class: "ct-blocktitle" },
            `Phases · ${doneCount}/${phases.length} checked complete`),
          h("div", { class: "ct-card" }, phases.map((ph) => this.renderPhase(ph))),
        ));
      }

      // -- display-only notes from the untyped Blockers/Concerns section
      if (gsd.concerns?.length) {
        body.appendChild(disclosure("Notes",
          h("div", { class: "ct-card" },
            gsd.concerns.map((c) => h("div", { class: "ct-kv" },
              h("span", { class: "k", style: "color: var(--muxy-foreground-muted); font-weight:600" }, "Note"),
              h("span", { class: "v" }, c))))));
      }

      // -- workflow block
      body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s4)" },
        h("div", { class: "ct-blocktitle" }, "Plan status"),
        h("div", { class: "ct-card" },
          kv("Milestone", gsd.milestone ? `${gsd.milestone}${gsd.milestoneName ? ` — ${gsd.milestoneName}` : ""}` : null),
          kv("Phase", gsd.phaseLabel ?? gsd.phaseName ?? null),
          kv("Plan", gsd.planLabel ?? null),
          kv("Reported status", gsd.statusLine ?? gsd.frontmatterStatus ?? null),
          kv("Verification", formatVerification(gsd.verification, gsd.verificationDetail)),
          kv("Last activity", formatLastActivity(gsd.lastActivity, gsd.lastActivityDesc)),
          gsd.paused ? kv("Handoff", "Work is paused with a saved handoff") : null,
        ),
      ));

      const hasAgentData = !!row.agent?.providerId
        || ["working", "waiting", "idle"].includes(row.agent?.runtimeState);
      body.appendChild(h("div", { class: "ct-block" },
        h("div", { class: "ct-blocktitle" }, "Agent activity"),
        h("div", { class: "ct-card" },
          row.agent?.providerId ? kv("Agent", formatProvider(row.agent.providerId)) : null,
          kv("Status", formatRuntime(row.agent?.runtimeState)),
          !hasAgentData
            ? kv("Note", "Only agent sessions running in Muxy appear here.")
            : null,
          row.agent?.observedAt ? kv("Updated", relativeTime(row.agent.observedAt)) : null,
        ),
      ));

      // -- git block
      body.appendChild(disclosure("Repository",
        h("div", { class: "ct-card" },
          kv("Branch", row.git?.branch ?? null, true),
          kv("Dirty files", typeof row.git?.dirtyCount === "number" ? String(row.git.dirtyCount) : null),
          row.git?.lastCommitAt
            ? kv("Last commit", `${relativeTime(row.git.lastCommitAt)} — ${row.git.lastCommitSubject ?? ""}`)
            : null,
        )));

      // -- source block
      body.appendChild(disclosure("Sources",
        h("div", { class: "ct-card" },
          ...(gsd.evidence ?? []).map((ev) =>
            kv("Source", `${ev.path} · ${relativeTime(ev.observedAt)}`, true)),
        )));
    } else {
      body.appendChild(actions);
      body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s4)" },
        h("div", { class: "ct-blocktitle" }, "Plan status"),
        h("div", { class: "ct-card", style: "padding: var(--s3) var(--s4); color: var(--muxy-foreground-muted)" },
          row.gsdUnavailableReason ?? "No GSD planning data found."),
      ));
    }

    return body;
  }

  /** One sparse phase row; optional artifact chips appear only when expanded. */
  renderPhase(ph) {
    const expandId = `${ph.number}::${ph.dir}`;
    const expanded = this.expandedPhases.has(expandId);
    const st = phaseStatusOf(ph);
    const chips = stageChips(ph);

    return h("div", { class: "ct-phase" },
      h("button", {
        class: "ct-phase-head", "aria-expanded": expanded,
        "aria-label": `${ph.name ?? `Phase ${ph.number}`}${st.label ? `, ${st.label}` : ""}`,
        title: expanded ? "Hide phase details" : "Show phase details",
        onclick: () => {
          if (expanded) this.expandedPhases.delete(expandId);
          else this.expandedPhases.add(expandId);
          this.render();
        },
      },
        h("span", { class: "ct-dot", style: `--dot:${st.color}`, "data-pulse": st.label === "Current" }),
        h("span", { class: "ct-phase-num mono" }, ph.number),
        h("span", { class: "ct-phase-name" }, ph.name ?? ph.dir ?? `Phase ${ph.number}`),
        h("span", {
          class: "ct-phase-status", style: `color:${st.color}`, title: st.label,
        }, st.label),
        icon(expanded ? "chevronDown" : "chevronRight", 12),
      ),
      expanded ? h("div", { class: "ct-phase-body" },
        chips.length ? h("div", { class: "ct-stagewrap" }, chips) : null,
        ph.goal ? h("div", { class: "ct-phase-goal" }, ph.goal) : null,
        h("div", { class: "ct-phase-meta" },
          ph.dir ? h("code", null, `.planning/phases/${ph.dir}`) : "No phase details yet",
          ph.plansTotal ? ` · ${ph.plansDone}/${ph.plansTotal} plans complete` : "",
          ph.pausedMarker ? " · work paused" : "",
        ),
        ph.verificationDetail || ph.verification !== "unknown"
          ? h("div", { class: "ct-phase-meta" },
              `Verification: ${formatVerification(ph.verification, ph.verificationDetail)}`)
          : null,
      ) : null,
    );
  }

  // --------------------------------------------------------------- overlays --

  renderOverlayHead(title) {
    return h("div", { class: "ct-detail-head" },
      h("button", { class: "ct-backbtn", onclick: () => this.closeOverlay() },
        icon("chevronLeft", 13), "Back"),
      h("span", { class: "ct-spacer" }),
      h("span", { class: "ct-detail-title" }, title),
    );
  }

  renderSettings() {
    const p = this.prefs;
    const body = h("div", { class: "ct-body" });

    body.appendChild(this.renderOverlayHead("Preferences"));
    body.appendChild(h("div", { class: "ct-section-label" }, "Preferences"));
    const card = h("div", { class: "ct-card" });

    card.appendChild(h("div", { class: "ct-setting" },
      h("div", { class: "grow" },
        h("div", { class: "name" }, "Refresh planning and Git"),
        h("div", { class: "desc" }, "Agent activity stays live through Muxy events. This interval refreshes cross-project files and Git data while the panel is open.")),
      h("select", {
        class: "ct-select", "aria-label": "Cross-project refresh interval",
        onchange: async (e) => {
          const value = Number(e.target.value);
          this.prefs = {
            ...this.prefs,
            refreshIntervalMinutes: REFRESH_INTERVAL_OPTIONS.includes(value) ? value : 5,
          };
          await this.persistPrefs();
          this.maybeAutoRefresh();
          this.render();
        },
      }, REFRESH_INTERVAL_OPTIONS.map((minutes) => h("option", {
        value: String(minutes), selected: p.refreshIntervalMinutes === minutes,
      }, minutes === 0 ? "Manual" : `${minutes} min`))),
    ));

    card.appendChild(h("div", { class: "ct-setting" },
      h("div", { class: "grow" },
        h("div", { class: "name" }, "Open on active project"),
        h("div", { class: "desc" }, "On by default — the panel lands inside the project you're currently in instead of the all-projects list.")),
      switchEl(p.openOnActiveProject !== false, "Open Control Tower on the active project", async (on) => {
        this.prefs = { ...this.prefs, openOnActiveProject: on };
        await this.persistPrefs();
        this.render();
      }),
    ));

    card.appendChild(h("div", { class: "ct-setting" },
      h("div", { class: "grow" },
        h("div", { class: "name" }, "Show non-GSD projects"),
        h("div", { class: "desc" }, "Include projects that do not use GSD.")),
      switchEl(p.showNonGsd, "Show projects without GSD planning artifacts", async (on) => {
        this.prefs = { ...this.prefs, showNonGsd: on };
        await this.persistPrefs();
        this.render();
      }),
    ));
    body.appendChild(card);

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s5)" }, "Included projects"));
    const projCard = h("div", { class: "ct-card" });
    if (!this.state.projects.length) {
      projCard.appendChild(h("div", { class: "ct-kv" }, h("span", { class: "v", style: "color:var(--muxy-foreground-muted)" }, "No Muxy projects found.")));
    }
    for (const project of this.state.projects) {
      const hidden = this.prefs.hiddenProjects.includes(project.id);
      projCard.appendChild(h("div", { class: "ct-setting" },
        h("div", { class: "grow" },
          h("div", { class: "name" }, project.name),
          h("div", { class: "desc ct-path" }, project.path)),
        switchEl(!hidden, `Include ${project.name} in Control Tower`, () => this.toggleProjectHidden(project.id)),
      ));
    }
    body.appendChild(projCard);

    body.appendChild(h("div", { class: "ct-actions" },
      h("button", {
        class: "ct-btn danger",
        onclick: async () => {
          const m = bridge();
          const choice = await m?.dialog?.confirm?.({
            title: "Reset Control Tower preferences?",
            message: "Search, refresh settings, and included projects return to defaults. No project files are touched.",
            buttons: ["Reset", "Cancel"],
          });
          if (choice === "Reset") {
            this.prefs = await resetPrefs();
            this.render();
          }
        },
      }, "Reset preferences"),
    ));

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s6)" }, "About"));
    body.appendChild(h("div", { class: "ct-card", style: "padding: var(--s3) var(--s4); color: var(--muxy-foreground-muted); font-size: var(--font-caption)" },
      `GSD Control Tower v${EXTENSION_VERSION} · Reads planning files without changing them. No network requests.`));

    return body;
  }

  renderDiagnostics() {
    const d = this.state.diagnostics;
    const body = h("div", { class: "ct-body" });

    body.appendChild(this.renderOverlayHead("Diagnostics"));
    body.appendChild(h("div", { class: "ct-section-label" }, "Runtime"));
    body.appendChild(h("div", { class: "ct-card" },
      kv("Last full refresh", d.lastFullRefresh ? relativeTime(d.lastFullRefresh) : "never"),
      kv("Extension", `v${EXTENSION_VERSION}`),
    ));

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s4)" }, "Access"));
    const capCard = h("div", { class: "ct-card ct-diag-list" });
    const capRows = [
      ["projects.list", "Projects", "projects:read"],
      ["worktrees.list", "Worktrees", "worktrees:read"],
      ["agents.list", "Agent activity", "agents:read"],
      ["files.read", "Planning files", "files:read"],
      ["git.status", "Git", "git:read"],
      ["storage.get", "Preferences", "storage:read"],
    ];
    for (const [cap, label, perm] of capRows) {
      const probe = d.permissionProbes[cap];
      capCard.appendChild(h("div", { class: "ct-kv" },
        h("span", { class: "k", title: perm }, label),
        h("span", { class: "v", title: perm },
          probe === true ? "✓ working"
            : probe === false ? "✗ permission denied — related features disabled"
            : "not exercised yet"),
      ));
    }
    body.appendChild(capCard);

    const planningIssues = this.currentRows().flatMap((row) => [
      ...(row.gsd?.errors ?? []).map((message) => ({ project: row.projectName, kind: "Error", message })),
      ...(row.gsd?.warnings ?? []).map((message) => ({ project: row.projectName, kind: "Warning", message })),
    ]);
    if (planningIssues.length) {
      body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s4)" }, "Planning issues"));
      const planningLog = h("div", { class: "ct-card ct-errorlog" });
      for (const issue of planningIssues) {
        planningLog.appendChild(h("div", { class: "ct-logentry" },
          h("div", { class: "t" }, `${issue.project} · ${issue.kind}`),
          h("div", null, issue.message)));
      }
      body.appendChild(planningLog);
    }

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s4)" }, "Recent issues"));
    const log = h("div", { class: "ct-card ct-errorlog" });
    if (!d.errors.length) {
      log.appendChild(h("div", { class: "ct-kv" },
        h("span", { class: "v", style: "color: var(--muxy-foreground-muted)" }, "No errors recorded.")));
    }
    for (const entry of [...d.errors].reverse()) {
      log.appendChild(h("div", { class: "ct-logentry" },
        h("div", { class: "t" }, `${isoDate(entry.at)} ${entry.context ? `· ${entry.context}` : ""}`),
        h("div", null, entry.message)));
    }
    body.appendChild(log);

    body.appendChild(h("div", { class: "ct-actions" },
      h("button", {
        class: "ct-btn",
        onclick: () => {
          const text = this.diagnosticsText();
          bridge()?.dialog?.alert?.({ title: "Control Tower diagnostics", message: text });
        },
      }, icon("copy", 13), "Copy diagnostics"),
      h("button", {
        class: "ct-btn",
        onclick: () => {
          this.state = setDiagnostics(this.state, { errors: [] });
          this.render();
        },
      }, "Clear log"),
    ));

    return body;
  }

  diagnosticsText() {
    const d = this.state.diagnostics;
    const rows = this.currentRows();
    return [
      `GSD Control Tower v${EXTENSION_VERSION} (${PARSER_VERSION})`,
      `Last full refresh: ${d.lastFullRefresh ?? "never"}`,
      `Subscriptions: ${d.subscriptions.join(", ") || "none"}`,
      `Capabilities: ${JSON.stringify(d.permissionProbes)}`,
      `Workstreams: ${rows.length}`,
      `Recent issues (${d.errors.length}/${BOUNDS.maxDiagnostics}):`,
      ...d.errors.map((e) => `- ${e.at} [${e.context ?? "general"}] ${e.message}`),
    ].join("\n");
  }
}

// ---------------------------------------------------------------- helpers --

function normalizeProjects(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.projects) ? value.projects : [];
  return list
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: String(p.id ?? p.path),
      name: String(p.name ?? p.path?.split("/").pop() ?? "Untitled"),
      path: String(p.path ?? ""),
      isActive: !!p.isActive,
      worktreesEnabled: p.worktreesEnabled !== false,
    }));
}

function normalizeWorktrees(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.worktrees)) return value.worktrees;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

/** One-line summary for list rows using identifiers, not interpreted prose. */
function summarizeGsd(gsd, row) {
  if (!gsd?.recognized) return null;
  const bits = [];
  if (gsd.milestone) bits.push(gsd.milestone);
  if (gsd.phaseLabel || gsd.phaseName) bits.push(gsd.phaseLabel ?? gsd.phaseName);
  return bits.length ? bits.join(" · ") : null;
}

/** Typed verification is displayed as a field, never promoted to priority. */
function verificationSummary(gsd) {
  if (!gsd?.recognized || gsd.verification === "unknown") return null;
  return `Verification: ${formatVerification(gsd.verification, gsd.verificationDetail)}`;
}

/** Freshest timestamp worth showing on a row: activity beats refresh time. */
function freshestTimestamp(row) {
  const t1 = Date.parse(row.gsd?.lastActivity ?? "");
  if (Number.isFinite(t1)) return row.gsd.lastActivity;
  return row.refreshedAt;
}

/** Stage chips are sparse evidence: only artifacts and typed results that exist. */
function stageChips(ph) {
  const chips = [];
  const boolStages = [
    ["spec", "spec"], ["discuss", "discuss"], ["research", "research"],
    ["ui", "ui spec"], ["patterns", "patterns"], ["review", "review"],
    ["security", "security"], ["validation", "validation"],
  ];
  for (const [key, label] of boolStages) {
    if (ph.stages?.[key]) chips.push(stageChip(label, "done"));
  }
  if (ph.plansTotal > 0) {
    chips.push(stageChip("plan", "done", String(ph.plansTotal)));
    chips.push(stageChip("execute",
      ph.plansDone >= ph.plansTotal ? "done" : ph.plansDone > 0 ? "part" : "off",
      `${ph.plansDone}/${ph.plansTotal}`));
  }
  if (ph.verification === "passed") chips.push(stageChip("verify", "done"));
  else if (ph.verification === "failed") chips.push(stageChip("verify", "failed"));
  else if (ph.verification === "pending") chips.push(stageChip("verify", "off", "pending"));

  return chips;
}

function stageChip(label, state, extra) {
  const text = extra ? `${label} ${extra}` : state === "done" ? `${label} ✓` : state === "failed" ? `${label} ✗` : label;
  return h("span", { class: "ct-stage", "data-state": state, title: `${label}: ${state}` }, text);
}

/** Per-phase label from explicit phase/checklist/handoff/verification evidence. */
export function phaseStatusOf(ph) {
  if (ph.verification === "failed") return { label: "Verification failed", color: "var(--muxy-diff-remove)" };
  if (ph.done) return { label: "Complete", color: "var(--muxy-diff-add)" };
  if (ph.pausedMarker) return { label: "Paused", color: "var(--st-waiting)" };
  if (ph.isCurrent) return { label: "Current", color: "var(--muxy-accent)" };
  if (!ph.dir) return { label: "Planned", color: "var(--muxy-foreground-muted)" };
  return { label: "Not current", color: "var(--muxy-foreground-muted)" };
}

/** Progress display from explicit roadmap checkboxes or phase counts. */
function structuredProgress(gsd) {
  const roadmap = Array.isArray(gsd?.roadmapPhases) ? gsd.roadmapPhases : [];
  if (roadmap.length) {
    const completed = roadmap.filter((phase) => phase.done === true).length;
    return {
      percent: Math.round(100 * completed / roadmap.length),
      label: `${completed}/${roadmap.length} roadmap phases checked complete`,
    };
  }
  const total = gsd?.progress?.totalPhases;
  const completed = gsd?.progress?.completedPhases;
  if (Number.isFinite(total) && total > 0 && Number.isFinite(completed) && completed >= 0) {
    const bounded = Math.min(total, completed);
    return {
      percent: Math.round(100 * bounded / total),
      label: `${bounded}/${total} phases recorded complete`,
    };
  }
  return null;
}

function formatLastActivity(iso, desc) {
  if (!iso) return null;
  const when = `${relativeTime(iso)} (${isoDate(iso)})`;
  return desc ? `${when} — ${desc}` : when;
}

function formatVerification(status, detail) {
  if (status === "passed") return `Passed${detail ? ` · ${detail}` : ""}`;
  if (status === "failed") return `Failed${detail ? ` · ${detail}` : ""}`;
  if (status === "pending") return "Pending";
  return detail ?? "Unknown";
}

function formatRuntime(state) {
  switch (state) {
    case "working": return "Working";
    case "waiting": return "Waiting for you";
    case "idle": return "Idle";
    default: return "No activity";
  }
}

function formatProvider(providerId) {
  const value = String(providerId ?? "").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Agent";
}

function crumbSep() {
  return icon("chevronRight", 12);
}

function statusIconName(state) {
  switch (state) {
    case "waiting": return "pause";
    case "working": return "bolt";
    case "idle": return "check";
    default: return "info";
  }
}

function disclosure(title, content) {
  return h("details", { class: "ct-disclosure" },
    h("summary", null, h("span", null, title), icon("chevronRight", 12)),
    h("div", { class: "ct-disclosure-body" }, content));
}

function kv(key, value, mono = false) {
  if (value == null || value === "") return null;
  return h("div", { class: "ct-kv" },
    h("span", { class: "k" }, key),
    h("span", { class: mono ? "v mono" : "v" }, value));
}

function switchEl(on, label, onchange) {
  return h("button", {
    class: "ct-switch", "data-on": on, role: "switch", "aria-checked": on,
    "aria-label": label,
    onclick: () => onchange(!on),
  });
}

function relativeTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 45_000) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function isoDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso ?? "");
  const d = new Date(t);
  return d.toISOString().slice(0, 16).replace("T", " ");
}
