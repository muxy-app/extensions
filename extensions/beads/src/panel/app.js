import { clear, h } from "@/lib/dom";
import { icon } from "@/lib/icons";
import {
  applyColumnOrder,
  groupIssuesByColumn,
  getIssueAge,
  getPriorityLabel,
  getStatusLabel,
  loadBoardData,
} from "./data";

const LAYOUT_STORAGE_KEY = "beads-board-layout";
const DEFAULT_AUTO_REFRESH_MS = 15000;
const AUTO_REFRESH_OPTIONS = [
  { label: "Never", value: 0 },
  { label: "15s", value: 15000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "5m", value: 300000 },
];

export class BeadsBoardPanel {
  constructor(root) {
    this.root = root;
    this.issues = [];
    this.filterText = "";
    this.selectedIssue = null;
    this.projectName = "Workspace";
    this.workspacePath = null;
    this.source = "none";
    this.error = null;
    this.refreshing = false;
    this.pollTimer = null;
    this.autoRefreshMs = DEFAULT_AUTO_REFRESH_MS;
    this.collapsedColumns = new Set();
    this.touchedColumns = new Set();
    this.columnOrder = [];
    this.draggingColumnID = null;
    this.suppressColumnClickUntil = 0;
  }

  async start() {
    muxy.events.subscribe("command.refresh-beads-board", () => this.refresh(true));
    muxy.events.subscribe("project.switched", () => this.delayedRefresh());
    muxy.events.subscribe("worktree.switched", () => this.delayedRefresh());
    await this.loadLayout();
    this.refresh(true);
    this.applyAutoRefreshTimer();
  }

  destroy() {
    this.clearAutoRefreshTimer();
  }

  delayedRefresh() {
    this.issues = [];
    this.selectedIssue = null;
    this.error = null;
    this.collapsedColumns = new Set();
    this.touchedColumns = new Set();
    this.draggingColumnID = null;
    this.render();
    setTimeout(() => this.refresh(true), 300);
  }

  async refresh(force) {
    if (this.refreshing) return;
    this.refreshing = true;
    if (force && this.issues.length === 0) this.render();

    try {
      const data = await loadBoardData();
      this.issues = data.issues;
      this.projectName = data.projectName;
      this.workspacePath = data.workspacePath;
      this.source = data.source;
      this.error = data.error;
      this.syncSelectedIssue();
      this.updateTopbar();
      this.render();
    } catch (error) {
      this.error = error?.message ?? String(error);
      this.render();
    } finally {
      this.refreshing = false;
    }
  }

  updateTopbar() {
    try {
      muxy.topbar.set({ id: "beads-board", visible: true });
    } catch {
    }
  }

  syncSelectedIssue() {
    if (!this.selectedIssue) return;
    this.selectedIssue = this.issues.find((issue) => issue.id === this.selectedIssue.id) ?? null;
  }

  render() {
    clear(this.root);

    if (this.selectedIssue) {
      this.root.appendChild(this.renderDetail());
      return;
    }

    this.root.appendChild(this.renderBoard());
  }

  renderBoard() {
    this.reconcileCollapsedColumns(this.orderBuckets(groupIssuesByColumn(this.issues)));

    return h("div", { class: "board" },
      this.renderToolbar(),
      this.error && this.issues.length === 0 ? this.renderNotice() : null,
      this.issues.length === 0 ? this.renderEmpty() : null,
      this.issues.length > 0
        ? this.renderColumns()
        : null,
    );
  }

  renderColumns() {
    const buckets = this.orderBuckets(groupIssuesByColumn(this.getFilteredIssues()));
    return h("div", { class: "columns" }, buckets.map((bucket) => this.renderColumn(bucket)));
  }

  refreshColumnsOnly() {
    const columns = this.root.querySelector(".columns");
    if (!columns) {
      this.render();
      return;
    }

    columns.replaceWith(this.renderColumns());
  }

  renderToolbar() {
    return h("div", { class: "toolbar" },
      icon("search", 12),
      h("input", {
        class: "search-input",
        placeholder: "Filter beads...",
        value: this.filterText,
        oninput: (event) => {
          this.filterText = event.target.value;
          this.refreshColumnsOnly();
        },
        onkeydown: (event) => {
          if (event.key === "Escape") {
            this.filterText = "";
            this.render();
          }
        },
      }),
      this.filterText
        ? h("button", {
            class: "icon-button",
            title: "Clear filter",
            onclick: () => {
              this.filterText = "";
              this.render();
            },
          }, icon("x", 13))
        : null,
      h("button", {
        class: "icon-button",
        title: "Refresh beads",
        disabled: this.refreshing,
        onclick: () => this.refresh(true),
      }, icon("refresh", 13)),
      h("select", {
        class: "refresh-select",
        title: "Auto-update interval",
        onchange: (event) => this.setAutoRefresh(Number(event.target.value)),
      },
        AUTO_REFRESH_OPTIONS.map((option) => h("option", {
          value: option.value,
          selected: option.value === this.autoRefreshMs,
        }, option.label)),
      ),
    );
  }

  renderNotice() {
    return h("div", { class: "notice" },
      icon("alertCircle", 14),
      h("span", {}, this.error),
    );
  }

  renderEmpty() {
    return h("div", { class: "empty-state" },
      icon("rectangle3group", 28),
      h("div", { class: "empty-title" }, "No beads found"),
      h("div", { class: "empty-copy" }, "Open a workspace with a Beads database or exported issues.jsonl."),
      h("div", { class: "debug" },
        h("div", {}, `project: ${this.projectName || "unknown"}`),
        h("div", {}, `workspace: ${this.workspacePath || "not set"}`),
        h("div", {}, `source: ${this.source}`),
      ),
    );
  }

  renderColumn(bucket) {
    const isCollapsed = this.collapsedColumns.has(bucket.id);
    const attrs = {
      class: `column column-${bucket.id}${isCollapsed ? " is-collapsed" : ""}`,
      ondragenter: (event) => this.handleColumnDragEnter(event, bucket.id),
      ondragover: (event) => this.handleColumnDragOver(event, bucket.id),
      ondragleave: (event) => this.handleColumnDragLeave(event, bucket.id),
      ondrop: (event) => this.handleColumnDrop(event, bucket.id),
    };

    if (isCollapsed) {
      return h("button", {
        ...attrs,
        draggable: true,
        title: `Open ${bucket.title}`,
        onclick: () => this.toggleColumn(bucket.id),
        ondragstart: (event) => this.handleColumnDragStart(event, bucket.id),
        ondragend: () => this.handleColumnDragEnd(),
      },
        h("span", { class: "collapsed-count" }, bucket.issues.length),
        h("span", { class: "collapsed-title" }, bucket.title),
      );
    }

    return h("section", attrs,
      h("button", {
        class: "column-header",
        draggable: true,
        title: `Collapse ${bucket.title}`,
        onclick: () => this.toggleColumn(bucket.id),
        ondragstart: (event) => this.handleColumnDragStart(event, bucket.id),
        ondragend: () => this.handleColumnDragEnd(),
      },
        h("span", { class: "column-title" }, bucket.title),
        h("span", { class: "column-count" }, bucket.issues.length),
      ),
      h("div", { class: "column-body" },
        bucket.issues.length === 0
          ? h("div", { class: "column-empty" }, "No beads")
          : bucket.issues.map((issue) => this.renderCard(issue)),
      ),
    );
  }

  toggleColumn(columnID) {
    if (Date.now() < this.suppressColumnClickUntil) return;
    this.touchedColumns.add(columnID);
    if (this.collapsedColumns.has(columnID)) {
      this.collapsedColumns.delete(columnID);
    } else {
      this.collapsedColumns.add(columnID);
    }
    this.render();
  }

  reconcileCollapsedColumns(buckets) {
    for (const bucket of buckets) {
      if (this.touchedColumns.has(bucket.id)) continue;
      if (bucket.issues.length === 0) {
        this.collapsedColumns.add(bucket.id);
      } else {
        this.collapsedColumns.delete(bucket.id);
      }
    }
  }

  orderBuckets(buckets) {
    return applyColumnOrder(buckets, this.columnOrder);
  }

  async loadLayout() {
    try {
      const layout = await muxy.storage.get(LAYOUT_STORAGE_KEY);
      this.columnOrder = Array.isArray(layout?.columnOrder) ? layout.columnOrder : [];
      this.autoRefreshMs = this.normalizeAutoRefreshMs(layout?.autoRefreshMs);
    } catch {
      this.columnOrder = [];
      this.autoRefreshMs = DEFAULT_AUTO_REFRESH_MS;
    }
  }

  async saveLayout() {
    try {
      await muxy.storage.set(LAYOUT_STORAGE_KEY, {
        columnOrder: this.columnOrder,
        autoRefreshMs: this.autoRefreshMs,
      });
    } catch {
    }
  }

  normalizeAutoRefreshMs(value) {
    const numeric = Number(value);
    return AUTO_REFRESH_OPTIONS.some((option) => option.value === numeric)
      ? numeric
      : DEFAULT_AUTO_REFRESH_MS;
  }

  setAutoRefresh(value) {
    this.autoRefreshMs = this.normalizeAutoRefreshMs(value);
    this.applyAutoRefreshTimer();
    this.saveLayout();
  }

  applyAutoRefreshTimer() {
    this.clearAutoRefreshTimer();
    if (this.autoRefreshMs <= 0) return;
    this.pollTimer = setInterval(() => this.refresh(false), this.autoRefreshMs);
  }

  clearAutoRefreshTimer() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  handleColumnDragStart(event, columnID) {
    this.draggingColumnID = columnID;
    this.clearColumnDropTargets();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnID);
    event.stopPropagation();
  }

  handleColumnDragEnter(event, columnID) {
    if (!this.draggingColumnID || this.draggingColumnID === columnID) return;
    event.preventDefault();
    event.currentTarget.classList.add("is-drop-target");
  }

  handleColumnDragOver(event, columnID) {
    if (!this.draggingColumnID || this.draggingColumnID === columnID) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.classList.add("is-drop-target");
  }

  handleColumnDragLeave(event, columnID) {
    if (!this.draggingColumnID || this.draggingColumnID === columnID) return;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    event.currentTarget.classList.remove("is-drop-target");
  }

  handleColumnDrop(event, targetColumnID) {
    event.preventDefault();
    event.stopPropagation();
    this.clearColumnDropTargets();
    const sourceColumnID = this.draggingColumnID || event.dataTransfer.getData("text/plain");
    if (!sourceColumnID || sourceColumnID === targetColumnID) {
      this.handleColumnDragEnd();
      return;
    }

    const orderedIDs = this.orderBuckets(groupIssuesByColumn(this.issues)).map((bucket) => bucket.id);
    const sourceIndex = orderedIDs.indexOf(sourceColumnID);
    const targetIndex = orderedIDs.indexOf(targetColumnID);
    if (sourceIndex === -1 || targetIndex === -1) {
      this.handleColumnDragEnd();
      return;
    }

    orderedIDs.splice(sourceIndex, 1);
    orderedIDs.splice(targetIndex, 0, sourceColumnID);
    this.columnOrder = orderedIDs;
    this.saveLayout();
    this.handleColumnDragEnd();
    this.render();
  }

  handleColumnDragEnd() {
    this.clearColumnDropTargets();
    this.draggingColumnID = null;
    this.suppressColumnClickUntil = Date.now() + 250;
  }

  clearColumnDropTargets() {
    this.root.querySelectorAll(".column.is-drop-target").forEach((node) => {
      node.classList.remove("is-drop-target");
    });
  }

  renderCard(issue) {
    return h("button", {
      class: `card priority-${issue.priority ?? "unknown"}`,
      onclick: () => {
        this.selectedIssue = issue;
        this.render();
      },
    },
      h("div", { class: "card-topline" },
        h("span", { class: "issue-id" }, issue.id),
        h("span", { class: `priority priority-${issue.priority ?? "unknown"}` }, getPriorityLabel(issue.priority)),
      ),
      h("div", { class: "card-title" }, issue.title),
      h("div", { class: "card-meta" },
        h("span", { class: "badge" }, issue.issue_type),
        h("span", { class: `badge status-${issue.status}` }, getStatusLabel(issue.status)),
        issue.ready ? h("span", { class: "badge badge-ready" }, "Ready") : null,
        getIssueAge(issue) ? h("span", { class: "muted" }, getIssueAge(issue)) : null,
      ),
      issue.labels.length > 0
        ? h("div", { class: "label-row" }, issue.labels.slice(0, 3).map((label) => h("span", { class: "label" }, label)))
        : null,
    );
  }

  renderDetail() {
    const issue = this.selectedIssue;

    return h("div", { class: "detail" },
      h("div", { class: "detail-header" },
        h("button", {
          class: "back-button",
          title: "Back to board",
          onclick: () => {
            this.selectedIssue = null;
            this.render();
          },
        }, icon("chevronLeft", 14), "Board"),
        h("button", {
          class: "icon-button",
          title: "Refresh beads",
          onclick: () => this.refresh(true),
        }, icon("refresh", 13)),
      ),
      h("div", { class: "detail-body" },
        h("div", { class: "detail-kicker" }, issue.id),
        h("h1", {}, issue.title),
        h("div", { class: "detail-badges" },
          h("span", { class: `priority priority-${issue.priority ?? "unknown"}` }, getPriorityLabel(issue.priority)),
          h("span", { class: `badge status-${issue.status}` }, getStatusLabel(issue.status)),
          issue.ready ? h("span", { class: "badge badge-ready" }, "Ready") : null,
          h("span", { class: "badge" }, issue.issue_type),
        ),
        this.renderField("Description", issue.description),
        this.renderField("Design", issue.design),
        this.renderField("Acceptance", issue.acceptance_criteria),
        this.renderField("Notes", issue.notes),
        this.renderStats(issue),
      ),
    );
  }

  renderField(label, value) {
    if (!value) return null;
    return h("section", { class: "detail-section" },
      h("h2", {}, label),
      h("p", {}, value),
    );
  }

  renderStats(issue) {
    return h("section", { class: "detail-section" },
      h("h2", {}, "Activity"),
      h("div", { class: "stat-grid" },
        h("div", {}, h("span", {}, issue.dependency_count), h("small", {}, "blockers")),
        h("div", {}, h("span", {}, issue.dependent_count), h("small", {}, "dependents")),
        h("div", {}, h("span", {}, issue.comment_count), h("small", {}, "comments")),
      ),
    );
  }

  getFilteredIssues() {
    if (!this.filterText) return this.issues;
    const query = this.filterText.toLowerCase();
    return this.issues.filter((issue) => [
      issue.id,
      issue.title,
      issue.description,
      issue.issue_type,
      issue.status,
      ...issue.labels,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }
}
