import { clear, h } from "@/lib/dom";
import { icon } from "@/lib/icons";
import { providerIcon } from "@/lib/provider-icons";
import { activeCwd, shortPath } from "@/lib/cwd";
import {
  getListFilter,
  getPreferredCli,
  setListFilter,
  setPreferredCli,
} from "@/lib/storage";
import { openResumeTerminal, openStartTerminal } from "@/lib/resume";
import { filterGroups, listAll } from "@/lib/sessions/index";
import {
  buildStartActionModel,
  isFilterStartOverride,
  pickStartCli,
  resolveStartPreference,
  shouldHealPreferredAfterStart,
} from "@/lib/sessions/start-cli";
import { dateGroup, relativeTime } from "@/lib/time";
import { groupByDate } from "@/lib/sessions/group";
import { deleteSession, renameSession } from "@/lib/sessions/manage";
import { providerById } from "@/lib/sessions/providers";
import {
  editTargetStillPresent,
  evaluateRenameDraft,
  findSessionByKey,
  sessionRowKey,
} from "@/lib/sessions/inline-rename";

function basenamePath(path) {
  if (!path || typeof path !== "string") return null;
  const norm = path.replace(/[\\/]+$/, "");
  const parts = norm.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

/** Attribute-safe form of sessionRowKey for data-* selectors (avoid CSS.escape). */
function dataKeyAttr(key) {
  return String(key).replace(/:/g, "__");
}

export class SessionsPanel {
  constructor(root) {
    this.root = root;
    this.cwd = null;
    this.installed = [];
    this.groups = [];
    this.filter = "all";
    this.preferredCli = "grok";
    this.loading = true;
    this.error = null;
    this.busyId = null;
    this.hostToolsMissing = false;
    this.refreshing = false;
    /** Monotonic epoch so overlapping listAll calls cannot clobber newer results. */
    this._listEpoch = 0;
    this.editingKey = null;
    this.editDraft = "";
    this.editError = null;
    this.confirmingDeleteKey = null;
    this.startMenuOpen = false;
    this._pendingFocus = null;
    this._lastEditedKey = null;
    /** Stable aria-live region (not recreated filled on every render). */
    this._liveRegion = null;
    this._startMenuDocListener = null;
    this.disposers = [];
  }

  clearEditState() {
    this.editingKey = null;
    this.editDraft = "";
    this.editError = null;
  }

  clearInlineModes() {
    this.clearEditState();
    this.confirmingDeleteKey = null;
    this.closeStartMenu();
  }

  closeStartMenu() {
    this.startMenuOpen = false;
    this._detachStartMenuListeners();
  }

  _detachStartMenuListeners() {
    if (this._startMenuDocListener) {
      document.removeEventListener("pointerdown", this._startMenuDocListener, true);
      document.removeEventListener("keydown", this._startMenuDocListener, true);
      this._startMenuDocListener = null;
    }
  }

  _attachStartMenuListeners() {
    this._detachStartMenuListeners();
    const onDoc = (e) => {
      if (!this.startMenuOpen) return;
      if (e.type === "keydown") {
        if (e.key === "Escape") {
          e.preventDefault();
          this.closeStartMenu();
          this._pendingFocus = "start-chevron";
          this.render();
        }
        return;
      }
      if (e.type === "pointerdown") {
        const shell = this.root.querySelector("[data-start-split]");
        if (shell && shell.contains(e.target)) return;
        // Close flag + detach now, but defer re-render so the current click
        // still hits its target (full re-render would steal the gesture).
        this.closeStartMenu();
        setTimeout(() => {
          if (!this.startMenuOpen) this.render();
        }, 0);
      }
    };
    this._startMenuDocListener = onDoc;
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onDoc, true);
  }

  toggleStartMenu() {
    if (this.startMenuOpen) {
      this.closeStartMenu();
      this._pendingFocus = "start-chevron";
      this.render();
      return;
    }
    this.clearEditState();
    this.confirmingDeleteKey = null;
    this.startMenuOpen = true;
    this._attachStartMenuListeners();
    this._pendingFocus = "start-menu-item";
    this.render();
  }

  /** @internal test seam — preference persistence */
  _writePreferredCli(id) {
    return setPreferredCli(id);
  }

  /** @internal test seam — list filter persistence */
  _writeListFilter(filter) {
    return setListFilter(filter);
  }

  /** @internal test seam — terminal launch */
  _openStartTerminal(cli) {
    return openStartTerminal(cli);
  }

  async preferCli(id) {
    if (!id || !this.installed.some((p) => p.id === id)) {
      this.closeStartMenu();
      this._pendingFocus = "start-chevron";
      this.render();
      return;
    }
    // Menu pick always becomes preferred and resets filter to All so
    // preferred ≡ effective Start target (even if preferred id is unchanged).
    this.preferredCli = id;
    this.filter = "all";
    this.closeStartMenu();
    this._pendingFocus = "start-chevron";
    this.render();
    // Writes return false on failure (do not throw). Memory-first UX stands either way.
    const [okPref, okFilter] = await Promise.all([
      this._writePreferredCli(id),
      this._writeListFilter("all"),
    ]);
    if (!okPref || !okFilter) {
      // Soft-log only: denied storage:write must not break the panel UI.
      console.warn(
        "[ai-session-history] preferCli storage write failed",
        { preferred: okPref, filter: okFilter, id },
      );
    }
  }

  start() {
    // Match the Git/Files panels: paint a useful shell synchronously, then
    // hydrate. A rejected bridge call can no longer leave a blank webview.
    this.render();
    this.disposers = [
      muxy.events.subscribe("command.refresh-sessions", () => void this.refresh()),
      muxy.events.subscribe("project.switched", () => void this.refresh()),
      muxy.events.subscribe("worktree.switched", () => void this.refresh()),
    ].filter(Boolean);
    void this.bootstrap();
  }

  async bootstrap() {
    try {
      [this.preferredCli, this.filter] = await Promise.all([
        getPreferredCli(),
        getListFilter(),
      ]);
      await this.refresh();
    } catch (err) {
      this.loading = false;
      this.error = err?.message || String(err);
      this.render();
    }
  }

  dispose() {
    this._detachStartMenuListeners();
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  /**
   * Soft re-list without blanking the panel (used after rename/delete).
   */
  async relistQuiet() {
    const epoch = ++this._listEpoch;
    try {
      const { installed, groups, hostToolsMissing, errorsByCli } = await listAll(this.cwd);
      if (epoch !== this._listEpoch) return;
      this.installed = installed;
      // Keep previous groups when host tools vanish mid-session (SWR).
      if (hostToolsMissing && this.groups.length) {
        this.hostToolsMissing = true;
        this.error = errorsByCli?._host || this.error;
      } else {
        this.groups = groups;
        this.hostToolsMissing = Boolean(hostToolsMissing);
        if (this.hostToolsMissing && errorsByCli?._host) {
          this.error = errorsByCli._host;
        } else {
          this.error = null;
        }
      }
    } catch (err) {
      if (epoch !== this._listEpoch) return;
      // Keep previous groups visible; surface via notification if possible.
      this.error = err?.message || String(err);
      try {
        await muxy.notifications.notify({
          title: "Could not refresh sessions",
          body: this.error,
        });
      } catch {
        /* ignore */
      }
    }
  }

  async refresh() {
    this.clearInlineModes();
    this._pendingFocus = null;
    const epoch = ++this._listEpoch;
    const hasData = this.groups.length > 0;
    if (hasData) {
      this.refreshing = true;
    } else {
      this.loading = true;
    }
    // Only clear global error on full cold load; keep list during SWR refresh.
    if (!hasData) this.error = null;
    this.render();
    try {
      this.cwd = await activeCwd();
      const { installed, groups, hostToolsMissing, errorsByCli } = await listAll(this.cwd);
      if (epoch !== this._listEpoch) return;
      this.installed = installed;
      if (hostToolsMissing && hasData) {
        this.hostToolsMissing = true;
        this.error = errorsByCli?._host || this.error;
      } else {
        this.groups = groups;
        this.hostToolsMissing = Boolean(hostToolsMissing);
        if (this.hostToolsMissing && errorsByCli?._host) {
          this.error = errorsByCli._host;
        } else {
          this.error = null;
        }
      }
      if (this.filter !== "all" && !installed.some((p) => p.id === this.filter)) {
        this.filter = "all";
        await setListFilter("all");
      }
      // Heal ghost preferred when stored CLI is no longer installed.
      const resolvedPreferred = pickStartCli(this.preferredCli, installed);
      if (resolvedPreferred && resolvedPreferred !== this.preferredCli) {
        this.preferredCli = resolvedPreferred;
        await setPreferredCli(resolvedPreferred);
      }
      if (this.editingKey && !editTargetStillPresent(this.editingKey, this.groups)) {
        this.clearEditState();
      }
      if (
        this.confirmingDeleteKey &&
        !editTargetStillPresent(this.confirmingDeleteKey, this.groups)
      ) {
        this.confirmingDeleteKey = null;
      }
    } catch (err) {
      if (epoch !== this._listEpoch) return;
      this.error = err?.message || String(err);
      // Hard failure only blanks when we had no prior data.
      if (!hasData) {
        this.installed = [];
        this.groups = [];
      }
      this.hostToolsMissing = false;
      this.clearInlineModes();
    } finally {
      if (epoch === this._listEpoch) {
        this.loading = false;
        this.refreshing = false;
        this.render();
      }
    }
  }

  async setFilter(filter) {
    this.clearInlineModes();
    this._pendingFocus = null;
    this.filter = filter;
    await setListFilter(filter);
    this.render();
  }

  async resume(session) {
    if (this.editingKey || this.confirmingDeleteKey) {
      this.clearInlineModes();
      this._pendingFocus = null;
    }
    this.busyId = sessionRowKey(session.cli, session.id);
    this.render();
    try {
      await openResumeTerminal(session.cli, session.id);
      if (session.cli !== this.preferredCli) {
        this.preferredCli = session.cli;
        await setPreferredCli(session.cli);
      }
    } catch (err) {
      try {
        await muxy.notifications.notify({
          title: "Could not resume session",
          body: err?.message || String(err),
        });
      } catch {
        // notifications optional
      }
    } finally {
      this.busyId = null;
      this.render();
    }
  }

  async startNew() {
    if (this.startMenuOpen) {
      this.closeStartMenu();
      this.render();
    }
    // Snapshot before await so concurrent filter/menu changes cannot mis-heal.
    const preferredAtStart = this.preferredCli;
    const filterAtStart = this.filter;
    const installed = this.installed;
    const resolved = resolveStartPreference(
      preferredAtStart,
      filterAtStart,
      installed,
    );
    const cli = pickStartCli(resolved, installed);
    if (!cli) return;
    try {
      await this._openStartTerminal(cli);
      // Heal stored preference when pick fell back (e.g. preferred CLI uninstalled).
      // Filter-driven Start must not write preferredCli. Only heal if preferred
      // was not updated while the terminal opened (e.g. concurrent menu pick).
      if (
        shouldHealPreferredAfterStart(
          cli,
          preferredAtStart,
          filterAtStart,
          installed,
        ) &&
        this.preferredCli === preferredAtStart
      ) {
        this.preferredCli = cli;
        await this._writePreferredCli(cli);
        this.render();
      }
    } catch (err) {
      try {
        await muxy.notifications.notify({
          title: "Could not start session",
          body: err?.message || String(err),
        });
      } catch {
        /* ignore */
      }
    }
  }


  beginRename(session) {
    if (this.busyId) return;
    const key = sessionRowKey(session.cli, session.id);
    this.closeStartMenu();
    this.confirmingDeleteKey = null;
    this.editingKey = key;
    this.editDraft = session.title ?? "";
    this.editError = null;
    this._pendingFocus = "input";
    this.render();
  }

  cancelRename() {
    if (this.editingKey) this._lastEditedKey = this.editingKey;
    this.clearEditState();
    this._pendingFocus = "row";
    this.render();
  }

  beginDelete(session) {
    if (this.busyId) return;
    const key = sessionRowKey(session.cli, session.id);
    this.closeStartMenu();
    this.clearEditState();
    this.confirmingDeleteKey = key;
    this._lastEditedKey = key;
    this._pendingFocus = "delete-confirm";
    this.render();
  }

  cancelDelete() {
    if (this.confirmingDeleteKey) this._lastEditedKey = this.confirmingDeleteKey;
    this.confirmingDeleteKey = null;
    this._pendingFocus = "row";
    this.render();
  }

  /** Visible session keys in display order (for post-delete focus neighbor). */
  _visibleSessionKeys() {
    const visible = filterGroups(this.groups, this.filter);
    const sessions =
      this.filter === "all"
        ? visible
            .flatMap((g) => g.sessions)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        : visible.flatMap((g) => g.sessions);
    return sessions.map((s) => sessionRowKey(s.cli, s.id));
  }

  async confirmDelete() {
    if (!this.confirmingDeleteKey || this.busyId) return;
    const key = this.confirmingDeleteKey;
    const session = findSessionByKey(key, this.groups);
    if (!session) {
      this.confirmingDeleteKey = null;
      this.render();
      return;
    }
    const keys = this._visibleSessionKeys();
    const idx = keys.indexOf(key);
    const neighborKey =
      (idx >= 0 && keys[idx + 1]) || (idx > 0 && keys[idx - 1]) || null;

    this.busyId = key;
    this.render();
    try {
      await deleteSession(session.cli, session.id, this.cwd);
      this.confirmingDeleteKey = null;
      await this.relistQuiet();
      this.busyId = null;
      // Prefer neighbor still present after re-list; else Start chevron / empty Start.
      const stillThere =
        neighborKey &&
        findSessionByKey(neighborKey, this.groups) != null;
      if (stillThere) {
        this._lastEditedKey = neighborKey;
        this._pendingFocus = "row";
      } else {
        this._lastEditedKey = null;
        this._pendingFocus = this.installed.length ? "start-chevron" : null;
      }
      this.render();
    } catch (err) {
      try {
        await muxy.notifications.notify({
          title: "Could not delete session",
          body: err?.message || String(err),
        });
      } catch {
        /* ignore */
      }
      this.busyId = null;
      this._pendingFocus = "delete-confirm";
      this.render();
    }
  }

  async confirmRename() {
    if (!this.editingKey || this.busyId) return;
    const key = this.editingKey;
    const session = findSessionByKey(key, this.groups);
    if (!session) {
      this.clearEditState();
      this.render();
      return;
    }
    const result = evaluateRenameDraft(session.title, this.editDraft);
    if (result.action === "empty") {
      this.editError = null;
      this._pendingFocus = "input";
      this.render();
      return;
    }
    if (result.action === "unchanged") {
      this.cancelRename();
      return;
    }

    this.busyId = key;
    this.editError = null;
    this.render();
    try {
      await renameSession(session.cli, session.id, result.title);
      this._lastEditedKey = key;
      this.clearEditState();
      this.busyId = null;
      await this.relistQuiet();
      this._pendingFocus = "row";
      this.render();
    } catch (err) {
      try {
        await muxy.notifications.notify({
          title: "Could not rename session",
          body: err?.message || String(err),
        });
      } catch {
        /* ignore */
      }
      this.busyId = null;
      this._pendingFocus = "input";
      this.render();
    }
  }


  /** Text for the stable aria-live region (only updates when content changes). */
  _liveStatusText() {
    const parts = [];
    if (this.loading && !this.groups.length) parts.push("Loading sessions…");
    if (this.refreshing) parts.push("Refreshing…");
    if (this.error) parts.push(this.error);
    return parts.join(" · ");
  }

  _ensureShell() {
    if (!this._liveRegion || !this._liveRegion.isConnected) {
      this._liveRegion = h("div", {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true",
        "data-panel-live": "true",
        class: "sr-only",
      });
    }
    let viewHost = this.root.querySelector("[data-panel-view]");
    if (!viewHost) {
      clear(this.root);
      viewHost = h("div", {
        "data-panel-view": "true",
        class: "h-full min-h-0",
      });
      this.root.appendChild(this._liveRegion);
      this.root.appendChild(viewHost);
    } else if (!this._liveRegion.isConnected) {
      this.root.insertBefore(this._liveRegion, viewHost);
    }
    return viewHost;
  }

  render() {
    const viewHost = this._ensureShell();
    clear(viewHost);
    viewHost.appendChild(this.view());
    const liveText = this._liveStatusText();
    if (this._liveRegion && this._liveRegion.textContent !== liveText) {
      this._liveRegion.textContent = liveText;
    }
    this._applyPendingFocus();
  }

  _applyPendingFocus() {
    const intent = this._pendingFocus;
    this._pendingFocus = null;
    const scope = this.root.querySelector("[data-panel-view]") || this.root;
    if (intent === "input" && this.editingKey) {
      const input = scope.querySelector(
        `input[data-edit-key="${dataKeyAttr(this.editingKey)}"]`,
      );
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    if (intent === "delete-confirm" && this.confirmingDeleteKey) {
      const btn = scope.querySelector(
        `button[data-delete-confirm="${dataKeyAttr(this.confirmingDeleteKey)}"]`,
      );
      btn?.focus();
      return;
    }
    if (intent === "row") {
      const key = this._lastEditedKey;
      if (!key) return;
      const btn = scope.querySelector(
        `button[data-session-key="${dataKeyAttr(key)}"]`,
      );
      if (btn) {
        btn.focus();
        return;
      }
      // Deleted row gone: fall back to Start chevron or active filter chip.
      // focus() returns undefined — never chain with || or the fallback always runs.
      const chevron = scope.querySelector("button[data-start-chevron]");
      if (chevron) {
        chevron.focus();
        return;
      }
      scope.querySelector('button[aria-pressed="true"]')?.focus();
      return;
    }
    if (intent === "start-chevron") {
      const chevron = scope.querySelector("button[data-start-chevron]");
      if (chevron) {
        chevron.focus();
        return;
      }
      // Footer + empty CTA both set data-start-main; avoid Tailwind class soup.
      scope.querySelector("button[data-start-main]")?.focus();
      return;
    }
    if (intent === "start-menu-item") {
      const selected = scope.querySelector(
        "[data-start-menu] [aria-selected='true']",
      );
      (selected ?? scope.querySelector("[data-start-menu] button"))?.focus();
    }
  }

  view() {
    const visible = filterGroups(this.groups, this.filter);
    const flat =
      this.filter !== "all"
        ? visible.flatMap((g) => g.sessions)
        : null;

    return h(
      "div",
      { class: "flex h-full flex-col" },
      this.toolbar(),
      h(
        "div",
        { class: "px-2.5 pb-1.5 text-[10px] text-muted-foreground truncate" },
        this.cwd ? shortPath(this.cwd, 56) : "No active project",
      ),
      h(
        "div",
        { class: "min-h-0 flex-1 overflow-y-auto px-1 pb-2" },
        this.loading && !this.groups.length
          ? this.emptyState("Loading sessions…")
          : this.error && !this.groups.length
            ? this.emptyState(this.error)
            : !this.installed.length && !this.loading
              ? this.noCliState()
              : this.filter === "all"
                ? this.groupedBody(visible)
                : this.flatBody(flat, visible[0]),
      ),
      this.footer(),
    );
  }

  toolbar() {
    const chips = [
      { id: "all", label: "All", providerId: null },
      ...this.installed.map((p) => ({ id: p.id, label: p.displayName, providerId: p.id })),
    ];

    return h(
      "div",
      { class: "flex flex-wrap items-center gap-1 px-2.5 pt-2.5 pb-1" },
      ...chips.map((chip) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": this.filter === chip.id ? "true" : "false",
            class:
              this.filter === chip.id
                ? "inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground outline-none"
                : "inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] text-foreground outline-none hover:bg-accent",
            onclick: () => this.setFilter(chip.id),
          },
          chip.providerId ? providerIcon(chip.providerId, 12) : null,
          chip.label,
        ),
      ),
    );
  }

  groupedBody(groups) {
    if (!groups.length) {
      return this.emptyState("No resumable sessions for this folder", true);
    }
    const errors = groups.filter((g) => g.error);
    const allSessions = groups
      .flatMap((g) => g.sessions)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const dateGroups = groupByDate(allSessions, dateGroup);
    return h(
      "div",
      { class: "flex flex-col gap-1" },
      this.statusBanner(),
      ...errors.map((g) => this.statusLine(`${g.displayName}: ${g.error}`)),
      ...dateGroups.map(({ label, sessions }) =>
        this.dateSection(label, sessions),
      ),
    );
  }

  flatBody(sessions, group) {
    if (group?.error && !sessions?.length) {
      return this.emptyState(group.error);
    }
    if (!sessions?.length) {
      return this.emptyState("No resumable sessions for this folder", true);
    }
    const dateGroups = groupByDate(sessions, dateGroup);
    return h(
      "div",
      { class: "flex flex-col" },
      this.statusBanner(),
      group?.error ? this.statusLine(group.error) : null,
      ...dateGroups.map(({ label, sessions: dateSessions }) =>
        this.dateSection(label, dateSessions),
      ),
    );
  }

  dateSection(label, sessions) {
    return h(
      "div",
      { class: "flex flex-col" },
      h(
        "div",
        {
          class:
            "sticky top-0 z-10 flex items-center justify-between bg-background px-2 py-1",
        },
        h(
          "span",
          {
            class:
              "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
          },
          label,
        ),
        h(
          "span",
          { class: "font-mono text-[10px] text-muted-foreground" },
          String(sessions.length),
        ),
      ),
      ...sessions.map((s) => this.row(s)),
    );
  }

  row(session) {
    const key = sessionRowKey(session.cli, session.id);
    const dataKey = dataKeyAttr(key);
    const busy = this.busyId === key;
    const isEditing = this.editingKey === key;
    const isConfirmingDelete = this.confirmingDeleteKey === key;
    const cwdBase = basenamePath(session.cwd);
    const place = [cwdBase, session.branch].filter(Boolean).join(" · ");
    const secondary = [relativeTime(session.updatedAt), place].filter(Boolean).join(" · ");

    const caps = providerById(session.cli)?.capabilities ?? {};

    if (isConfirmingDelete) {
      return h(
        "div",
        {
          class: "group relative flex w-full items-stretch rounded-md bg-destructive/10",
          "aria-busy": busy ? "true" : "false",
        },
        h(
          "div",
          {
            class: "flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-1.5",
            role: "group",
            "aria-label": "Confirm delete session",
          },
          h(
            "div",
            { class: "flex w-full items-center gap-2" },
            providerIcon(session.cli, 14, "shrink-0 text-muted-foreground"),
            h(
              "span",
              { class: "min-w-0 flex-1 truncate text-[12px] text-foreground" },
              session.title,
            ),
            busy ? icon("refresh", 12, "text-muted-foreground animate-spin") : null,
          ),
          h(
            "span",
            { class: "w-full truncate pl-5 text-[10px] text-destructive" },
            "Delete permanently? This cannot be undone.",
          ),
        ),
        h(
          "div",
          { class: "flex items-center gap-0.5 pr-1.5" },
          h(
            "button",
            {
              type: "button",
              title: "Confirm delete",
              "aria-label": "Confirm delete",
              "data-delete-confirm": dataKey,
              disabled: busy,
              class:
                "flex min-h-6 min-w-6 items-center justify-center rounded p-0.5 text-destructive outline-none hover:bg-accent disabled:opacity-40",
              onmousedown: (e) => e.preventDefault(),
              onkeydown: (e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  this.cancelDelete();
                }
              },
              onclick: (e) => {
                e.stopPropagation();
                this.confirmDelete();
              },
            },
            icon("check", 12),
          ),
          h(
            "button",
            {
              type: "button",
              title: "Cancel delete",
              "aria-label": "Cancel delete",
              disabled: busy,
              class:
                "flex min-h-6 min-w-6 items-center justify-center rounded p-0.5 text-muted-foreground outline-none hover:text-foreground hover:bg-accent disabled:opacity-40",
              onmousedown: (e) => e.preventDefault(),
              onkeydown: (e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  this.cancelDelete();
                }
              },
              onclick: (e) => {
                e.stopPropagation();
                this.cancelDelete();
              },
            },
            icon("x", 12),
          ),
        ),
      );
    }

    if (isEditing) {
      const inputAttrs = {
        type: "text",
        value: this.editDraft,
        "data-edit-key": dataKey,
        "aria-label": "Session title",
        autocomplete: "off",
        disabled: busy,
        class:
          "h-6 w-full min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[12px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60",
        oninput: (e) => {
          this.editDraft = e.target.value;
        },
        onkeydown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.confirmRename();
          } else if (e.key === "Escape") {
            e.preventDefault();
            this.cancelRename();
          }
        },
      };

      return h(
        "div",
        {
          class: "group relative flex w-full items-stretch rounded-md bg-accent/40",
          "aria-busy": busy ? "true" : "false",
        },
        h(
          "div",
          {
            class: "flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-1.5",
            role: "group",
            "aria-label": "Rename session",
          },
          h(
            "div",
            { class: "flex w-full items-center gap-2" },
            providerIcon(session.cli, 14, "shrink-0 text-muted-foreground"),
            h("input", inputAttrs),
            busy ? icon("refresh", 12, "text-muted-foreground animate-spin") : null,
          ),
          secondary
            ? h(
                "span",
                { class: "w-full truncate pl-5 font-mono text-[10px] text-muted-foreground" },
                secondary,
              )
            : null,
        ),
        h(
          "div",
          { class: "flex items-center gap-0.5 pr-1.5" },
          h(
            "button",
            {
              type: "button",
              title: "Confirm rename",
              "aria-label": "Confirm rename",
              disabled: busy,
              class:
                "flex min-h-6 min-w-6 items-center justify-center rounded p-0.5 text-primary outline-none hover:bg-accent disabled:opacity-40",
              onmousedown: (e) => e.preventDefault(),
              onclick: (e) => {
                e.stopPropagation();
                this.confirmRename();
              },
            },
            icon("check", 12),
          ),
          h(
            "button",
            {
              type: "button",
              title: "Cancel rename",
              "aria-label": "Cancel rename",
              disabled: busy,
              class:
                "flex min-h-6 min-w-6 items-center justify-center rounded p-0.5 text-muted-foreground outline-none hover:text-foreground hover:bg-accent disabled:opacity-40",
              onmousedown: (e) => e.preventDefault(),
              onclick: (e) => {
                e.stopPropagation();
                this.cancelRename();
              },
            },
            icon("x", 12),
          ),
        ),
      );
    }

    const actionButtons = [];
    if (caps.rename) {
      actionButtons.push(
        h(
          "button",
          {
            type: "button",
            title: "Rename",
            "aria-label": "Rename",
            disabled: busy,
            class:
              "flex items-center rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-foreground hover:bg-accent outline-none disabled:opacity-40",
            onclick: (e) => {
              e.stopPropagation();
              this.beginRename(session);
            },
          },
          icon("pencil", 11),
        ),
      );
    }
    if (caps.delete) {
      actionButtons.push(
        h(
          "button",
          {
            type: "button",
            title: "Delete",
            "aria-label": "Delete",
            disabled: busy,
            class:
              "flex items-center rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive hover:bg-accent outline-none disabled:opacity-40",
            onclick: (e) => {
              e.stopPropagation();
              this.beginDelete(session);
            },
          },
          icon("trash", 11),
        ),
      );
    }

    return h(
      "div",
      {
        class: "group relative flex w-full items-stretch rounded-md hover:bg-accent",
      },
      h(
        "button",
        {
          type: "button",
          disabled: busy,
          "data-session-key": dataKey,
          class:
            "flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-1.5 text-left outline-none disabled:opacity-60",
          onclick: () => this.resume(session),
        },
        h(
          "div",
          { class: "flex w-full items-center gap-2" },
          providerIcon(session.cli, 14, "shrink-0 text-muted-foreground"),
          h(
            "span",
            { class: "min-w-0 flex-1 truncate text-[12px] text-foreground" },
            session.title,
          ),
          busy ? icon("refresh", 12, "text-muted-foreground animate-spin") : null,
        ),
        secondary
          ? h(
              "span",
              { class: "w-full truncate pl-5 font-mono text-[10px] text-muted-foreground" },
              secondary,
            )
          : null,
      ),
      actionButtons.length
        ? h(
            "div",
            { class: "flex items-center gap-0.5 pr-1.5" },
            ...actionButtons,
          )
        : null,
    );
  }

  footer() {
    const canStart = this.installed.length > 0;
    const model = buildStartActionModel(
      this.preferredCli,
      this.installed,
      this.filter,
    );

    if (!canStart || !model.showMenu) {
      return h(
        "div",
        { class: "border-t border-border px-2.5 py-2" },
        h(
          "button",
          {
            type: "button",
            "data-start-main": "true",
            disabled: !canStart,
            class:
              "flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[12px] text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50",
            onclick: () => this.startNew(),
          },
          icon("sparkles", 12),
          model.label,
        ),
      );
    }

    const menuOpen = this.startMenuOpen;
    // Checkmark / aria-selected track effective Start (filter when override).
    // Rename chrome so AT is not told a "preferred" list with a temporary selection.
    const filterOverride = isFilterStartOverride(this.filter, this.installed);
    const chevronLabel = filterOverride
      ? "Choose CLI to start with"
      : "Choose preferred CLI";
    const menuLabel = filterOverride
      ? "CLI used when starting"
      : "Preferred AI CLI";

    return h(
      "div",
      { class: "relative border-t border-border px-2.5 py-2" },
      h(
        "div",
        {
          class: "relative flex h-7 w-full",
          role: "group",
          "aria-label": "Start new session",
          "data-start-split": "true",
        },
        h(
          "button",
          {
            type: "button",
            "data-start-main": "true",
            class:
              "flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-md border border-border border-r-0 bg-surface text-[12px] text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary",
            onclick: () => this.startNew(),
          },
          icon("sparkles", 12),
          h("span", { class: "truncate" }, model.label),
        ),
        h(
          "button",
          {
            type: "button",
            "data-start-chevron": "true",
            "aria-label": chevronLabel,
            "aria-haspopup": "listbox",
            "aria-expanded": menuOpen ? "true" : "false",
            "aria-controls": menuOpen ? "start-cli-menu" : undefined,
            class:
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-r-md border border-border bg-surface text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary",
            onclick: (e) => {
              e.stopPropagation();
              this.toggleStartMenu();
            },
          },
          // Menu opens upward: closed chevron points up.
          icon("chevron", 12, menuOpen ? "" : "rotate-180"),
        ),
        menuOpen
          ? h(
              "div",
              {
                id: "start-cli-menu",
                role: "listbox",
                "aria-label": menuLabel,
                "data-start-menu": "true",
                class:
                  "absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-md border border-border bg-surface shadow-md",
              },
              ...model.items.map((item) =>
                h(
                  "button",
                  {
                    type: "button",
                    role: "option",
                    "aria-selected": item.selected ? "true" : "false",
                    class: item.selected
                      ? "flex w-full items-center gap-2 bg-accent px-2.5 py-1.5 text-left text-[12px] text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary"
                      : "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary",
                    onclick: (e) => {
                      e.stopPropagation();
                      this.preferCli(item.id);
                    },
                  },
                  providerIcon(item.id, 14, "shrink-0 text-muted-foreground"),
                  h("span", { class: "min-w-0 flex-1 truncate" }, item.displayName),
                  item.selected
                    ? icon("check", 12, "shrink-0 text-primary")
                    : h("span", { class: "w-3 shrink-0" }),
                ),
              ),
            )
          : null,
      ),
    );
  }

  /**
   * Visual status line (soft per-CLI vs hard host/global errors).
   * Announcements use the stable `_liveRegion`, not recreated live regions.
   * @param {string} text
   * @param {{ hard?: boolean }} [opts]
   */
  statusLine(text, opts = {}) {
    const hard = Boolean(opts.hard);
    return h(
      "div",
      {
        class: hard
          ? "px-2 py-1 text-[11px] font-medium text-destructive"
          : "px-2 py-1 text-[11px] text-muted-foreground",
      },
      text,
    );
  }

  statusBanner() {
    const parts = [];
    if (this.refreshing) {
      parts.push(
        h(
          "div",
          { class: "px-2 py-1 text-[11px] text-muted-foreground" },
          "Refreshing…",
        ),
      );
    }
    if (this.error && this.groups.length) {
      // Host/global errors are hard failures even when SWR keeps prior list.
      parts.push(this.statusLine(this.error, { hard: true }));
    }
    if (!parts.length) return null;
    return h("div", { class: "flex flex-col gap-0.5" }, ...parts);
  }

  emptyState(message, showStart = false) {
    const model = buildStartActionModel(
      this.preferredCli,
      this.installed,
      this.filter,
    );
    return h(
      "div",
      {
        class:
          "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-[12px] text-muted-foreground",
      },
      h("p", null, message),
      showStart && this.installed.length
        ? h(
            "button",
            {
              type: "button",
              "data-start-main": "true",
              class:
                "h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary",
              onclick: () => this.startNew(),
            },
            model.label,
          )
        : null,
    );
  }

  noCliState() {
    return h(
      "div",
      {
        class:
          "flex flex-col gap-2 px-4 py-8 text-[12px] text-muted-foreground",
      },
      h(
        "p",
        { class: "text-center font-medium text-foreground" },
        "No AI CLIs found on PATH",
      ),
      h(
        "p",
        { class: "text-center" },
        "Install grok, claude, codex, copilot, cursor-agent, or opencode, then refresh.",
      ),
    );
  }
}
