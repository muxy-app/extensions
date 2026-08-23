/**
 * GSD Control Tower — panel application.
 * Owns inventory + GSD parsing (webview-only APIs), renders the ranked
 * attention queue, the project view (phase pipeline, blockers, concerns),
 * filters, diagnostics, and preferences.
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
import {
  buildRows, attentionRows, statusCounts, filterRows, knownProviders,
} from "../core/selectors.js";
import {
  CONTROL_LABELS, PROVIDER_WAITING_SUPPORT, PARSER_VERSION, EXTENSION_VERSION, BOUNDS,
} from "../core/types.js";
import { buildGsdSnapshot } from "../core/gsd/parse-planning.js";
import { planNavigation } from "../core/navigation.js";
import { bridge, call, hasCapability, fileSource, normalizeAgentItems } from "../host/muxy.js";
import { loadPrefs, savePrefs, resetPrefs } from "../host/prefs.js";

const STATUS_ORDER = ["waiting", "blocked", "unknown", "stale", "ready", "working", "idle"];

/** Control state → semantic CSS custom property (see global.css). */
export function stateColor(controlState) {
  return `var(--st-${controlState}, var(--st-idle))`;
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
  }

  async start() {
    this.prefs = await loadPrefs();
    this.wireEvents();
    this.render();
    this.fullRefresh();
    // Recompute derived states (staleness) periodically without refetching.
    setInterval(() => { if (!this.overlay) this.render(); }, 30_000);
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
      this.publishCounts();
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
    sub("command.focus-top-attention", () => this.revealTopAttention());

    if (hasCapability("onFocus")) {
      m.onFocus((focused) => { if (focused) this.render(); });
    }
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
        this.publishCounts();
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
        const warning = `Worktree inventory unavailable: ${res.error.message}`;
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
          message: `${project.name}: ${warning}`,
          context: "inventory",
        });
      }
    }

    if (inventoryFailures.length) {
      const denied = inventoryFailures.some(({ error }) => error.kind === "permission");
      this.banner = {
        kind: denied ? "permission" : "error",
        message: `${inventoryFailures.length} project${inventoryFailures.length === 1 ? "" : "s"} could not list worktrees. Project-scoped rows are marked in Diagnostics.`,
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
    this.publishCounts();
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
              ? `Planning state unreadable — ${gsdError.message}`
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

  // -------------------------------------------------------------- publishing --

  currentRows() {
    return buildRows(this.state, this.prefs ?? {}, Date.now());
  }

  currentProjectRow() {
    return this.currentRows().find((r) => r.key === this.selectedKey);
  }

  /** Push counts to the status bar + background cache (works while panel is open). */
  publishCounts() {
    const rows = this.currentRows();
    const attention = attentionRows(rows);
    const waitingIds = rows
      .filter((r) => r.controlState === "waiting")
      .map((r) => r.worktreeId)
      .filter(Boolean);
    this.updateStatusBar(attention.length);
    try {
      const emission = bridge()?.events?.emit?.("extension.snapshot", {
        attentionCount: attention.length,
        total: rows.length,
        waitingIds,
        at: new Date().toISOString(),
      });
      Promise.resolve(emission).catch((error) => {
        this.state = pushDiagnostic(this.state, {
          at: new Date().toISOString(),
          message: `extension.snapshot: ${error?.message ?? error}`,
          context: "background-sync",
        });
      });
    } catch { /* background may not be running */ }
  }

  updateStatusBar(count) {
    const m = bridge();
    if (!hasCapability("statusbar.set")) return;
    const payload = count > 0
      ? { id: "attention", text: String(count), icon: { symbol: "exclamationmark.triangle.fill" } }
      : { id: "attention", text: "", icon: { symbol: "circle.dashed" } };
    call("statusbar.set", () => m.statusbar.set(payload)).then((res) => {
      this.recordProbe("statusbar.set", res.error);
    });
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

  async openContext(row) {
    const m = bridge();
    const project = this.state.projects.find((p) => p.id === row.projectId);
    const { steps, note } = planNavigation(row, project);
    try {
      for (const step of steps) {
        const res = step.kind === "switchProject"
          ? await call("projects.switchTo", () => m.projects.switchTo(step.projectId))
          : await call("worktrees.switchTo", () => m.worktrees.switchTo(step.targetId, step.projectId));
        if (!res.ok) throw new Error(res.error.message);
      }
      // Switching projects recreates this panel (per-project session).
      if (note && steps.length) {
        this.banner = { kind: "info", message: note };
        this.render();
      }
    } catch (e) {
      this.banner = { kind: "error", message: `Could not open context: ${e.message}` };
      this.render();
    }
  }

  revealTopAttention() {
    const rows = filterRows(this.currentRows(), this.prefs?.filters ?? {});
    const top = attentionRows(rows)[0];
    if (!top) {
      this.banner = { kind: "info", message: "Nothing needs attention right now." };
      this.render();
      return;
    }
    this.openProject(top);
  }

  async toggleProjectHidden(projectId) {
    const hidden = new Set(this.prefs.hiddenProjects);
    if (hidden.has(projectId)) hidden.delete(projectId);
    else hidden.add(projectId);
    this.prefs = { ...this.prefs, hiddenProjects: [...hidden] };
    await this.persistPrefs();
    this.render();
    this.publishCounts();
  }

  async persistPrefs() {
    clearTimeout(this.savePrefsTimer);
    this.savePrefsTimer = setTimeout(() => savePrefs(this.prefs), 500);
  }

  // ------------------------------------------------------------------ render --

  render() {
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
  }

  viewRoot() {
    const rows = this.currentRows();
    const attention = attentionRows(rows);
    const counts = statusCounts(rows);

    return h("div", { class: "ct-root" },
      this.renderHeader(rows, attention.length),
      this.renderBanner(),
      this.renderBody(rows, attention, counts),
    );
  }

  renderHeader(rows, attentionCount) {
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
        h("span", { class: "ct-count", "data-hot": attentionCount > 0,
          title: `${attentionCount} of ${rows.length} workstreams need attention`,
        },
          attentionCount > 0 ? icon("warning", 12) : icon("check", 12),
          attentionCount > 0 ? `${attentionCount} of ${rows.length}` : `${rows.length} steady`,
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
    const f = this.prefs?.filters ?? { query: "", statuses: [], providers: [] };
    const rows = this.currentRows();
    const counts = statusCounts(rows);
    const providers = knownProviders(rows);

    return h("div", { class: "ct-searchrow" },
      h("div", { class: "ct-searchwrap" },
        icon("search", 13),
        h("input", {
          id: "ct-search", class: "ct-search", type: "search", placeholder: "Filter workstreams…",
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
      h("div", { class: "ct-chips", style: "flex-basis:100%" },
        STATUS_ORDER
          .filter((s) => (counts[s] ?? 0) > 0)
          .map((s) => {
            const on = f.statuses.includes(s);
            return h("button", {
              class: "ct-chip", "data-on": on, style: `--chip-color:${stateColor(s)}`,
              "aria-pressed": on, title: `Filter: ${CONTROL_LABELS[s]} (${counts[s]})`,
              onclick: () => this.toggleStatusFilter(s),
            }, h("span", { class: "dot" }), `${CONTROL_LABELS[s]} ${counts[s]}`);
          }),
        providers.map((p) => {
          const on = f.providers.includes(p);
          return h("button", {
            class: "ct-chip", "data-on": on, style: "--chip-color: var(--muxy-accent)",
            "aria-pressed": on, title: `Filter provider: ${p}`,
            onclick: () => this.toggleProviderFilter(p),
          }, p);
        }),
      ),
    );
  }

  async toggleStatusFilter(status) {
    const statuses = new Set(this.prefs.filters.statuses);
    if (statuses.has(status)) statuses.delete(status);
    else statuses.add(status);
    this.prefs = { ...this.prefs, filters: { ...this.prefs.filters, statuses: [...statuses] } };
    await this.persistPrefs();
    this.render();
  }

  async toggleProviderFilter(provider) {
    const providers = new Set(this.prefs.filters.providers);
    if (providers.has(provider)) providers.delete(provider);
    else providers.add(provider);
    this.prefs = { ...this.prefs, filters: { ...this.prefs.filters, providers: [...providers] } };
    await this.persistPrefs();
    this.render();
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

  renderBody(rows, attention, counts) {
    if (this.overlay === "settings") return this.renderSettings();
    if (this.overlay === "diagnostics") return this.renderDiagnostics();
    if (this.view === "project") return this.renderProject();
    return this.renderList(rows, attention);
  }

  renderList(rows, attention) {
    const body = h("div", { class: "ct-body" });

    if (!this.loaded && !rows.length) {
      body.appendChild(this.renderEmpty(
        "tower", "Reading workstreams…",
        "Listing Muxy projects, worktrees, agents, and .planning/ artifacts."));
      return body;
    }

    if (!this.state.projects.length) {
      body.appendChild(this.renderEmpty(
        "layers", "No Muxy projects yet",
        "Add a project in Muxy first — the Control Tower watches every project's .planning/ directory and live agent activity."));
      return body;
    }

    const visible = filterRows(rows, this.prefs?.filters ?? {});
    const visibleAttention = attentionRows(visible);

    if (visibleAttention.length) {
      body.appendChild(h("div", { class: "ct-section-label" }, "Needs attention", h("span", null, `· ${visibleAttention.length}`)));
      const card = h("div", { class: "ct-card", role: "list" });
      for (const row of visibleAttention) card.appendChild(this.renderRow(row, { emphasized: true }));
      body.appendChild(card);
    }

    // Non-GSD projects are hidden from the list by default (they still reach
    // Needs attention via runtime states); a quiet line keeps them discoverable.
    const showNonGsd = !!this.prefs?.showNonGsd;
    const rest = visible.filter((r) => !attention.includes(r) && (showNonGsd || r.isGsd));
    const hiddenNonGsd = visible.filter((r) => !attention.includes(r) && !r.isGsd).length;

    if (rest.length) {
      body.appendChild(h("div", { class: "ct-section-label" }, "All workstreams", h("span", null, `· ${rest.length}`)));
      const card = h("div", { class: "ct-card", role: "list" });
      for (const row of rest) card.appendChild(this.renderRow(row, {}));
      body.appendChild(card);
    }

    if (!visible.length) {
      body.appendChild(this.renderEmpty(
        "search", "Nothing matches",
        "Adjust the search or status filters to see more workstreams."));
    } else if (!rest.length && visibleAttention.length) {
      body.appendChild(this.renderEmpty(
        "check", "Everything else is steady",
        "No GSD workstream is waiting, blocked, stale, or ready right now."));
    }

    if (!showNonGsd && hiddenNonGsd > 0) {
      body.appendChild(h("div", {
        class: "ct-section-label", style: "justify-content:center; text-transform:none; letter-spacing:0",
        title: "Projects without .planning/ stay out of the list. They still appear under Needs attention when an agent reports waiting or working.",
      }, `${hiddenNonGsd} non-GSD project${hiddenNonGsd === 1 ? "" : "s"} hidden — enable in Preferences`));
    }

    const last = this.state.diagnostics.lastFullRefresh;
    if (last) {
      body.appendChild(h("div", {
        class: "ct-section-label", style: "margin-top: var(--s5); justify-content:center",
        title: "Inactive projects refresh on panel open, manual refresh, and project/worktree changes — Muxy only streams file events for the active project.",
      }, `Refreshed ${relativeTime(last)}`));
    }
    return body;
  }

  renderEmpty(iconName, title, hint) {
    return h("div", { class: "ct-empty" }, icon(iconName, 14), h("div", { style: "font-weight:600; color:var(--muxy-foreground)" }, title), h("div", { class: "hint" }, hint));
  }

  renderRow(row, { emphasized = false } = {}) {
    const gsd = row.gsd;
    const provider = row.agent?.providerId;
    const line2 = row.attentionReason
      ?? summarizeGsd(gsd, row)
      ?? row.inventoryWarning
      ?? row.gsdUnavailableReason
      ?? (row.isGsd ? " " : "No .planning/ — not a GSD project");

    return h("button", {
      class: "ct-row", role: "listitem", "data-selected": this.selectedKey === row.key,
      "aria-label": `${row.projectName}: ${CONTROL_LABELS[row.controlState]}`,
      onclick: () => this.openProject(row),
    },
      h("span", {
        class: "ct-dot", style: `--dot:${stateColor(row.controlState)}`,
        "data-pulse": row.controlState === "waiting" || row.controlState === "working",
        "data-state": row.controlState,
      }),
      h("span", { class: "ct-main" },
        h("span", { class: "ct-line1" },
          h("span", { class: "ct-proj" }, row.projectName),
          row.worktreeName && row.worktreeName !== "root"
            ? h("span", { class: "ct-wt" }, `⎇ ${row.git?.branch || row.worktreeName}`)
            : (row.git?.branch ? h("span", { class: "ct-wt" }, `⎇ ${row.git.branch}`) : null),
        ),
        h("span", { class: "ct-line2", "data-reason": !!row.attentionReason }, line2),
      ),
      h("span", { class: "ct-side" },
        provider ? h("span", { class: "ct-provider", title: `Provider: ${provider}` }, provider) : null,
        emphasized || row.controlState !== "idle" ? h("span", { class: "ct-runtime" }, CONTROL_LABELS[row.controlState]) : null,
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
    const stateColorValue = stateColor(row.controlState);

    // -- breadcrumb head (explicit way back to the tower)
    body.appendChild(h("div", { class: "ct-detail-head" },
      h("button", { class: "ct-backbtn", onclick: () => this.goHome() },
        icon("chevronLeft", 13), "All projects"),
      h("span", { class: "ct-spacer" }),
      h("span", { class: "ct-detail-title" }, row.projectName),
    ));

    // -- state card
    body.appendChild(h("div", { class: "ct-statecard", style: `--dot:${stateColorValue}` },
      h("span", {
        class: "ct-dot", style: `--dot:${stateColorValue}`,
        "data-pulse": row.controlState === "waiting" || row.controlState === "working",
      }),
      h("div", null,
        h("div", { class: "label" }, CONTROL_LABELS[row.controlState]),
        h("div", { style: "font-size:var(--font-body)" },
          row.attentionReason ?? summarizeGsd(gsd, row) ?? row.gsdUnavailableReason ?? "No attention condition."),
      ),
    ));

    // -- actions
    const actions = h("div", { class: "ct-actions" },
      h("button", { class: "ct-btn primary", onclick: () => this.openContext(row) },
        icon("open", 13), "Open context"),
      h("button", {
        class: "ct-btn",
        onclick: () => {
          const project = this.state.projects.find((p) => p.id === row.projectId);
          if (project) this.refreshProject(project, { quiet: false });
        },
      }, icon("refresh", 13), "Re-read project"),
    );
    body.appendChild(actions);

    if (gsd) {
      // -- milestone progress
      const pct = gsd.progress?.percent;
      if (typeof pct === "number") {
        body.appendChild(h("div", { class: "ct-card", style: "margin-top: var(--s4); padding: var(--s2) 0" },
          h("div", { class: "ct-progress" }, h("div", { style: `width:${Math.min(100, Math.max(0, pct))}%` })),
          h("div", { style: "text-align:center; font-size:var(--font-caption); color:var(--muxy-foreground-muted); padding-bottom: var(--s2)" },
            `${gsd.milestone ? `${gsd.milestone} · ` : ""}${pct}% · ${gsd.progress?.completedPhases ?? "?"}/${gsd.progress?.totalPhases ?? "?"} phases · ${gsd.progress?.completedPlans ?? "?"}/${gsd.progress?.totalPlans ?? "?"} plans`),
        ));
      }

      // -- next action
      if (gsd.nextAction) {
        body.appendChild(h("div", { class: "ct-nextaction", style: "margin-top: var(--s4)" },
          icon("bolt", 14), h("div", null, h("strong", null, "Next: "), gsd.nextAction)));
      }

      // -- phase pipeline
      const phases = Array.isArray(gsd.phases) ? gsd.phases : [];
      if (phases.length) {
        const doneCount = phases.filter((p) => p.done).length;
        body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s5)" },
          h("div", { class: "ct-blocktitle" },
            `Phases · ${doneCount}/${phases.length} complete`),
          h("div", { class: "ct-card" }, phases.map((ph) => this.renderPhase(ph))),
        ));
      }

      // -- blockers (explicit) and concerns (non-blocking notes)
      if (gsd.blockers.length) {
        body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s4)" },
          h("div", { class: "ct-blocktitle" }, "Blockers"),
          h("div", { class: "ct-card" },
            gsd.blockers.map((b) => h("div", { class: "ct-kv" },
              h("span", { class: "k", style: "color: var(--muxy-diff-remove); font-weight:600" }, "Blocker"),
              h("span", { class: "v" }, b))))));
      }
      if (gsd.concerns?.length) {
        body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s4)" },
          h("div", { class: "ct-blocktitle" }, "Notes & deferred concerns"),
          h("div", { class: "ct-card" },
            gsd.concerns.map((c) => h("div", { class: "ct-kv" },
              h("span", { class: "k", style: "color: var(--st-stale); font-weight:600" }, "Concern"),
              h("span", { class: "v" }, c))))));
      }

      // -- workflow block
      body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s4)" },
        h("div", { class: "ct-blocktitle" }, "GSD workflow"),
        h("div", { class: "ct-card" },
          kv("Milestone", gsd.milestone ? `${gsd.milestone}${gsd.milestoneName ? ` — ${gsd.milestoneName}` : ""}` : null),
          kv("Phase", gsd.phaseLabel ?? gsd.phaseName ?? null),
          kv("Plan", gsd.planLabel ?? null),
          kv("Status", gsd.statusLine ?? gsd.frontmatterStatus ?? null),
          kv("Verification", formatVerification(gsd.verification, gsd.verificationDetail)),
          kv("Last activity", formatLastActivity(gsd.lastActivity, gsd.lastActivityDesc)),
          gsd.paused ? kv("Handoff", "Paused mid-work — a .continue-here/HANDOFF marker is present") : null,
        ),
      ));

      // -- agent block (Muxy-hosted agents only — external terminal CLIs are invisible)
      const waitingSupported = row.agent?.providerId
        ? PROVIDER_WAITING_SUPPORT[row.agent.providerId] !== false
        : true;
      const hasAgentData = !!row.agent?.providerId
        || ["working", "waiting", "idle"].includes(row.agent?.runtimeState);
      body.appendChild(h("div", { class: "ct-block" },
        h("div", {
          class: "ct-blocktitle",
          title: "Muxy reports agent lifecycle only for agents it hosts in a Muxy pane, via provider hooks.",
        }, "Agent activity · Muxy-hosted agents"),
        h("div", { class: "ct-card" },
          kv("Provider", row.agent?.providerId ?? null),
          kv("Runtime state", formatRuntime(row.agent?.runtimeState)),
          !hasAgentData
            ? kv("Why empty?", "No Muxy-integrated agent has reported in this worktree. Agents running in external terminals — Codex CLI, DeepSeek Harness, plain Claude Code — are invisible to Muxy and never appear here.")
            : null,
          row.agent?.providerId && !waitingSupported
            ? kv("Capability", "Waiting state unavailable for this provider — silence is never treated as waiting")
            : null,
          row.agent?.paneId ? kv("Pane", row.agent.paneId, true) : null,
          row.agent?.observedAt ? kv("Observed", relativeTime(row.agent.observedAt)) : null,
          kv("Scope", "Worktree-level aggregate across Muxy agent panes, not a per-process inventory"),
        ),
      ));

      // -- git block
      body.appendChild(h("div", { class: "ct-block" },
        h("div", { class: "ct-blocktitle" }, "Repository"),
        h("div", { class: "ct-card" },
          kv("Branch", row.git?.branch ?? null, true),
          kv("Dirty files", typeof row.git?.dirtyCount === "number" ? String(row.git.dirtyCount) : null),
          row.git?.lastCommitAt
            ? kv("Last commit", `${relativeTime(row.git.lastCommitAt)} — ${row.git.lastCommitSubject ?? ""}`)
            : null,
        ),
      ));

      // -- provenance block
      body.appendChild(h("div", { class: "ct-block" },
        h("div", { class: "ct-blocktitle" }, "Provenance"),
        h("div", { class: "ct-card" },
          ...(gsd.evidence ?? []).map((ev) =>
            kv("Source", `${ev.path} · ${relativeTime(ev.observedAt)}`, true)),
          kv("Parser", gsd.parserVersion),
          ...(gsd.warnings ?? []).map((w) => kv("Warning", w)),
          ...(gsd.errors ?? []).map((er) => kv("Error", er)),
        ),
      ));
    } else {
      body.appendChild(h("div", { class: "ct-block", style: "margin-top: var(--s4)" },
        h("div", { class: "ct-blocktitle" }, "GSD workflow"),
        h("div", { class: "ct-card", style: "padding: var(--s3) var(--s4); color: var(--muxy-foreground-muted)" },
          row.gsdUnavailableReason ?? "No .planning/ directory — not a GSD project."),
      ));
    }

    return body;
  }

  /** One pipeline row: status dot, number, name, stage chips; click expands details. */
  renderPhase(ph) {
    const expandId = `${ph.number}::${ph.dir}`;
    const expanded = this.expandedPhases.has(expandId);
    const st = phaseStatusOf(ph);

    return h("div", { class: "ct-phase" },
      h("button", {
        class: "ct-phase-head", "aria-expanded": expanded,
        title: expanded ? "Hide phase details" : "Show phase details",
        onclick: () => {
          if (expanded) this.expandedPhases.delete(expandId);
          else this.expandedPhases.add(expandId);
          this.render();
        },
      },
        h("span", { class: "ct-dot", style: `--dot:${st.color}`, "data-pulse": st.label === "In progress" }),
        h("span", { class: "ct-phase-num mono" }, ph.number),
        h("span", { class: "ct-phase-name" }, ph.name ?? ph.dir ?? `Phase ${ph.number}`),
        h("span", { class: "ct-phase-status", style: `color:${st.color}` }, st.label),
        icon(expanded ? "chevronDown" : "chevronRight", 12),
      ),
      h("div", { class: "ct-stagewrap" }, stageChips(ph)),
      expanded ? h("div", { class: "ct-phase-body" },
        ph.goal ? h("div", { class: "ct-phase-goal" }, ph.goal) : null,
        h("div", { class: "ct-phase-meta" },
          ph.dir ? h("code", null, `.planning/phases/${ph.dir}`) : "No phase directory yet — planning hasn't started",
          ph.plansTotal ? ` · ${ph.plansDone}/${ph.plansTotal} plans executed` : "",
          ph.pausedMarker ? " · paused handoff marker present" : "",
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
        h("div", { class: "name" }, "Stale after"),
        h("div", { class: "desc" }, "Incomplete work with no observed change for this long is ranked Stale.")),
      h("input", {
        class: "ct-input-num mono", type: "number", min: "5", max: "1440", step: "5",
        value: String(p.staleThresholdMinutes), "aria-label": "Stale threshold in minutes",
        onchange: async (e) => {
          const v = Math.min(1440, Math.max(5, Number(e.target.value) || 45));
          this.prefs = { ...this.prefs, staleThresholdMinutes: v };
          e.target.value = String(v);
          await this.persistPrefs();
          this.render();
        },
      }),
      h("span", { class: "desc" }, "min"),
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
        h("div", { class: "desc" }, "Off by default — projects without .planning/ stay out of All workstreams. They still reach Needs attention when an agent reports waiting or working.")),
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
            message: "Filters, thresholds, and included projects return to defaults. No project files are touched.",
            buttons: ["Reset", "Cancel"],
          });
          if (choice === "Reset") {
            this.prefs = await resetPrefs();
            this.render();
            this.publishCounts();
          }
        },
      }, "Reset preferences"),
    ));

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s6)" }, "About"));
    body.appendChild(h("div", { class: "ct-card", style: "padding: var(--s3) var(--s4); color: var(--muxy-foreground-muted); font-size: var(--font-caption)" },
      `GSD Control Tower v${EXTENSION_VERSION} · ${PARSER_VERSION} · read-only: no files are written, no commands run, no data leaves this Mac.`));

    return body;
  }

  renderDiagnostics() {
    const d = this.state.diagnostics;
    const body = h("div", { class: "ct-body" });

    body.appendChild(this.renderOverlayHead("Diagnostics"));
    body.appendChild(h("div", { class: "ct-section-label" }, "Runtime"));
    body.appendChild(h("div", { class: "ct-card" },
      kv("Last full refresh", d.lastFullRefresh ? relativeTime(d.lastFullRefresh) : "never"),
      kv("Parser", d.parserVersion ?? PARSER_VERSION),
      kv("Extension", `v${EXTENSION_VERSION}`),
      kv("Subscriptions", d.subscriptions.length ? d.subscriptions.join(", ") : "none"),
    ));

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s4)" }, "Capabilities"));
    const capCard = h("div", { class: "ct-card ct-diag-list" });
    const capRows = [
      ["projects.list", "projects:read"],
      ["worktrees.list", "worktrees:read"],
      ["agents.list", "agents:read"],
      ["files.read", "files:read"],
      ["git.status", "git:read"],
      ["statusbar.set", "panels:write"],
      ["storage.get", "storage:read"],
    ];
    for (const [cap, perm] of capRows) {
      const probe = d.permissionProbes[cap];
      capCard.appendChild(h("div", { class: "ct-kv" },
        h("span", { class: "k" }, h("code", null, perm)),
        h("span", { class: "v" },
          probe === true ? "✓ working"
            : probe === false ? "✗ permission denied — related features disabled"
            : "not exercised yet"),
      ));
    }
    body.appendChild(capCard);

    body.appendChild(h("div", { class: "ct-section-label", style: "margin-top: var(--s4)" },
      `Recent issues · bounded at ${BOUNDS.maxDiagnostics}`));
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
      `Workstreams: ${rows.length} — ${JSON.stringify(statusCounts(rows))}`,
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

/** One-line summary for list rows: milestone · phase · what the workflow claims. */
function summarizeGsd(gsd, row) {
  if (!gsd?.recognized) return null;
  const bits = [];
  if (gsd.milestone) bits.push(gsd.milestone);
  if (gsd.phaseLabel || gsd.phaseName) bits.push(gsd.phaseLabel ?? gsd.phaseName);
  const act = activityWord(gsd);
  if (act && !(gsd.phaseLabel ?? gsd.phaseName ?? "").toLowerCase().includes(act.toLowerCase())) {
    bits.push(act);
  }
  if (gsd.planLabel && /^not started/i.test(gsd.planLabel)) bits.push("plan queued");
  return bits.length ? bits.join(" · ") : null;
}

/** The workflow's own verb: "Executing", "Complete", "Ready"… from artifacts. */
function activityWord(gsd) {
  const fm = String(gsd?.frontmatterStatus ?? "").trim();
  const line = String(gsd?.statusLine ?? "").trim();
  const word = (fm || line.split(/[\s—]+/)[0] || "").split(/\s+/)[0]?.replace(/[^\w-]/g, "");
  if (!word) return undefined;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Freshest timestamp worth showing on a row: activity beats refresh time. */
function freshestTimestamp(row) {
  const t1 = Date.parse(row.gsd?.lastActivity ?? "");
  if (Number.isFinite(t1)) return row.gsd.lastActivity;
  return row.refreshedAt;
}

/**
 * Stage chips for one phase: what part of the workflow has happened.
 * Only stages with a real artifact (or plan counts) get a chip; a phase with
 * no signals at all reads "Not started".
 */
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

  if (!chips.length) {
    return h("span", { class: "ct-stage-none" },
      ph.done ? "Completed before phase directories were kept" : "Not started");
  }
  return chips;
}

function stageChip(label, state, extra) {
  const text = extra ? `${label} ${extra}` : state === "done" ? `${label} ✓` : state === "failed" ? `${label} ✗` : label;
  return h("span", { class: "ct-stage", "data-state": state, title: `${label}: ${state}` }, text);
}

/** Per-phase rollup status shown on the right of the pipeline row. */
function phaseStatusOf(ph) {
  if (ph.verification === "failed") return { label: "Blocked", color: "var(--st-blocked)" };
  if (ph.done) return { label: "Complete", color: "var(--st-ready)" };
  if (ph.pausedMarker) return { label: "Paused", color: "var(--st-waiting)" };
  if (ph.isCurrent) return { label: "In progress", color: "var(--muxy-accent)" };
  const started =
    ph.plansTotal > 0 ||
    Object.values(ph.stages ?? {}).some(Boolean);
  if (started) return { label: "Underway", color: "var(--muxy-accent)" };
  return { label: "Queued", color: "var(--muxy-foreground-muted)" };
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
    default: return "No Muxy-integrated agent observed";
  }
}

function crumbSep() {
  return icon("chevronRight", 12);
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
