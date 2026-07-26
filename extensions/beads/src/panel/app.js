import { clear, h, svg } from "@/lib/dom";
import { icon } from "@/lib/icons";
import {
  BLOCKING_EDGE,
  applyColumnOrder,
  buildDependencyGraph,
  buildInsights,
  buildIssueIndex,
  getBlockerLinks,
  getDependentLinks,
  groupIssuesByColumn,
  getIssueAge,
  getPriorityLabel,
  getStatusLabel,
  loadBoardContext,
  loadBoardData,
} from "./data";

const LAYOUT_STORAGE_KEY = "beads-board-layout";
const DATA_CACHE_KEY_PREFIX = "beads-board-data-v1:";
const DEFAULT_AUTO_REFRESH_MS = 15000;
const DEFAULT_VIEW = "board";
const DEFAULT_INSPECTOR_WIDTH = 320;
const MIN_INSPECTOR_WIDTH = 260;
const MAX_INSPECTOR_WIDTH = 640;
const VIEWS = [
  { id: "board", label: "Board" },
  { id: "graph", label: "Graph" },
  { id: "insights", label: "Insights" },
];
const GRAPH_NODE_WIDTH = 184;
const GRAPH_NODE_MIN_HEIGHT = 82;
const GRAPH_COL_GAP = 60;
const GRAPH_ROW_GAP = 18;
const GRAPH_PADDING = 20;
const INSIGHT_LIST_LIMIT = 6;
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
    this.loading = true;
    this.hasLoaded = false;
    this.usingCache = false;
    this.cachedAt = null;
    this.refreshing = false;
    this.refreshGeneration = 0;
    this.activeRefreshGeneration = null;
    this.workspaceRefreshTimer = null;
    this.pollTimer = null;
    this.autoRefreshMs = DEFAULT_AUTO_REFRESH_MS;
    this.activeView = DEFAULT_VIEW;
    this.inspectorWidth = DEFAULT_INSPECTOR_WIDTH;
    this.collapsedColumns = new Set();
    this.touchedColumns = new Set();
    this.columnOrder = [];
    this.draggingColumnID = null;
    this.suppressColumnClickUntil = 0;
    this.graphRenderSequence = 0;
    this.viewRenderSequence = 0;
    this.shell = null;
    this.contentRoot = null;
    this.projectNameElement = null;
    this.searchInput = null;
    this.clearSearchButton = null;
    this.refreshButton = null;
    this.refreshSelect = null;
    this.cacheIndicator = null;
    this.viewButtons = new Map();
    this.isTab = window.muxy?.data?.surface === "tab";
  }

  async start() {
    this.root.classList.add(this.isTab ? "surface-tab" : "surface-panel");
    muxy.events.subscribe("command.refresh-beads-board", () => this.refresh());
    muxy.events.subscribe("project.switched", () => this.delayedRefresh());
    muxy.events.subscribe("worktree.switched", () => this.delayedRefresh());
    muxy.onFocus?.((focused) => {
      if (focused && !this.selectedIssue) this.root.querySelector(".search-input")?.focus();
    });
    this.render();
    await this.loadLayout();
    this.render();
    this.refresh();
    this.applyAutoRefreshTimer();
  }

  destroy() {
    this.clearAutoRefreshTimer();
    if (this.workspaceRefreshTimer) clearTimeout(this.workspaceRefreshTimer);
  }

  delayedRefresh() {
    this.refreshGeneration += 1;
    if (this.workspaceRefreshTimer) clearTimeout(this.workspaceRefreshTimer);
    this.issues = [];
    this.selectedIssue = null;
    this.error = null;
    this.loading = true;
    this.hasLoaded = false;
    this.usingCache = false;
    this.cachedAt = null;
    this.source = "none";
    this.workspacePath = null;
    this.collapsedColumns = new Set();
    this.touchedColumns = new Set();
    this.draggingColumnID = null;
    this.render();
    const generation = this.refreshGeneration;
    this.workspaceRefreshTimer = setTimeout(() => {
      this.workspaceRefreshTimer = null;
      this.refresh(generation);
    }, 300);
  }

  async refresh(generation = this.refreshGeneration) {
    if (this.activeRefreshGeneration === generation) return;
    this.activeRefreshGeneration = generation;
    this.refreshing = true;
    if (!this.hasLoaded) this.loading = true;
    this.syncTopbar();
    if (!this.hasLoaded) this.renderContent();

    try {
      const context = await loadBoardContext();
      if (!this.isCurrentRefresh(generation)) return;

      this.projectName = context.projectName;
      this.workspacePath = context.workspacePath;

      if (!this.hasLoaded) {
        const cached = await this.loadCachedData(context);
        if (!this.isCurrentRefresh(generation)) return;
        if (cached) {
          this.applyBoardData(cached, true);
          this.loading = false;
          this.render();
        }
      }

      const data = await loadBoardData(context);
      if (!this.isCurrentRefresh(generation)) return;

      if (data.source === "none" && this.hasLoaded && this.source !== "none") {
        this.error = data.error;
        this.usingCache = true;
      } else {
        this.applyBoardData(data, false);
        if (data.source !== "none") {
          const cachedAt = await this.saveCachedData(data);
          if (this.isCurrentRefresh(generation)) this.cachedAt = cachedAt;
        }
      }
      if (!this.isCurrentRefresh(generation)) return;
      this.updateTopbar();
    } catch (error) {
      if (this.isCurrentRefresh(generation)) {
        this.error = error?.message ?? String(error);
        if (this.hasLoaded && this.source !== "none") this.usingCache = true;
        this.hasLoaded = true;
      }
    } finally {
      if (this.isCurrentRefresh(generation)) {
        this.activeRefreshGeneration = null;
        this.refreshing = false;
        this.loading = false;
        this.hasLoaded = true;
        this.render();
      }
    }
  }

  isCurrentRefresh(generation) {
    return generation === this.refreshGeneration;
  }

  applyBoardData(data, cached) {
    this.issues = data.issues;
    this.projectName = data.projectName;
    this.workspacePath = data.workspacePath;
    this.source = data.source;
    this.error = cached ? null : data.error;
    this.hasLoaded = true;
    this.usingCache = cached;
    this.cachedAt = cached ? data.cachedAt : null;
    this.syncSelectedIssue();
  }

  async loadCachedData(context) {
    if (!context.workspaceKey) return null;

    try {
      const cached = await muxy.storage.get(this.getDataCacheKey(context.workspaceKey));
      if (cached?.workspaceKey !== context.workspaceKey || !Array.isArray(cached?.issues)) return null;
      return cached;
    } catch {
      return null;
    }
  }

  async saveCachedData(data) {
    if (!data.workspaceKey) return null;

    try {
      const cachedAt = Date.now();
      await muxy.storage.set(this.getDataCacheKey(data.workspaceKey), {
        workspaceKey: data.workspaceKey,
        workspacePath: data.workspacePath,
        projectName: data.projectName,
        source: data.source,
        issues: data.issues,
        cachedAt,
      });
      return cachedAt;
    } catch {
      return null;
    }
  }

  getDataCacheKey(workspaceKey) {
    let hash = 2166136261;
    for (let index = 0; index < workspaceKey.length; index += 1) {
      hash ^= workspaceKey.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${DATA_CACHE_KEY_PREFIX}${(hash >>> 0).toString(36)}`;
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
    if (!this.shell?.isConnected) this.mountShell();
    this.syncTopbar();
    this.renderContent();
  }

  mountShell() {
    clear(this.root);
    this.contentRoot = h("div", { class: "app-content" });
    this.shell = h("div", { class: "app-shell" }, this.renderTopbar(), this.contentRoot);
    this.root.appendChild(this.shell);
  }

  renderContent() {
    if (!this.contentRoot) return;
    const scrollState = this.captureScrollState();
    const sequence = ++this.viewRenderSequence;
    this.index = buildIssueIndex(this.issues);
    const notice = this.error && (this.source === "none" || this.usingCache) ? this.renderNotice() : null;
    const view = this.loading && !this.hasLoaded
      ? this.renderLoading()
      : this.issues.length === 0 ? this.renderEmpty() : this.renderActiveView();
    this.contentRoot.replaceChildren(...[notice, view].filter(Boolean));
    this.restoreScrollState(scrollState);
    queueMicrotask(() => {
      if (sequence === this.viewRenderSequence) this.restoreScrollState(scrollState);
    });
  }

  captureScrollState() {
    const state = new Map();
    this.contentRoot?.querySelectorAll("[data-scroll-key]").forEach((node) => {
      state.set(node.dataset.scrollKey, { top: node.scrollTop, left: node.scrollLeft });
    });
    return state;
  }

  restoreScrollState(state) {
    if (!state?.size) return;
    this.contentRoot?.querySelectorAll("[data-scroll-key]").forEach((node) => {
      const position = state.get(node.dataset.scrollKey);
      if (!position) return;
      node.scrollTop = position.top;
      node.scrollLeft = position.left;
    });
  }

  renderTopbar() {
    this.projectNameElement = h("span", { class: "project-name" });
    this.viewButtons = new Map();
    const viewSwitcher = h("nav", { class: "view-switcher", "aria-label": "Issue view" }, VIEWS.map((view) => {
      const button = h("button", {
        type: "button",
        class: "view-button",
        onclick: () => this.setView(view.id),
      }, view.label);
      this.viewButtons.set(view.id, button);
      return button;
    }));
    this.searchInput = h("input", {
      class: "search-input",
      type: "search",
      placeholder: "Filter issues…",
      autocomplete: "off",
      spellcheck: "false",
      oninput: (event) => {
        this.filterText = event.target.value;
        this.syncTopbar();
        this.renderContent();
      },
      onkeydown: (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        this.filterText = "";
        this.syncTopbar();
        this.renderContent();
      },
    });
    this.clearSearchButton = h("button", {
      type: "button",
      class: "clear-search",
      title: "Clear filter",
      "aria-label": "Clear filter",
      onclick: () => {
        this.filterText = "";
        this.syncTopbar();
        this.renderContent();
        this.searchInput?.focus();
      },
    }, icon("x", 12));
    this.refreshButton = h("button", {
      type: "button",
      class: "icon-button",
      onclick: () => this.refresh(),
    }, icon("refresh", 13));
    this.refreshSelect = h("select", {
      class: "refresh-select",
      title: "Auto-refresh interval",
      onchange: (event) => this.setAutoRefresh(Number(event.target.value)),
    }, AUTO_REFRESH_OPTIONS.map((option) => h("option", {
      value: option.value,
    }, option.label)));
    this.cacheIndicator = h("span", { class: "cache-indicator" }, "Cached");

    return h("header", { class: "app-topbar" },
      h("div", { class: "brand" }, h("span", { class: "brand-mark" }), h("strong", {}, "Beads")),
      this.projectNameElement,
      viewSwitcher,
      h("div", { class: "topbar-spacer" }),
      h("label", { class: "search-control" },
        icon("search", 12),
        this.searchInput,
        this.clearSearchButton,
      ),
      this.refreshButton,
      this.refreshSelect,
      this.cacheIndicator,
    );
  }

  syncTopbar() {
    if (!this.shell) return;
    this.projectNameElement.textContent = this.projectName;
    this.projectNameElement.title = this.workspacePath || "";
    for (const [view, button] of this.viewButtons) {
      const active = this.activeView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (this.searchInput.value !== this.filterText) this.searchInput.value = this.filterText;
    this.clearSearchButton.hidden = !this.filterText;
    const refreshLabel = this.refreshing ? "Refreshing beads" : "Refresh beads";
    this.refreshButton.classList.toggle("is-refreshing", this.refreshing);
    this.refreshButton.title = refreshLabel;
    this.refreshButton.setAttribute("aria-label", refreshLabel);
    this.refreshButton.setAttribute("aria-busy", String(this.refreshing));
    this.refreshButton.disabled = this.refreshing;
    this.refreshSelect.value = String(this.autoRefreshMs);
    this.cacheIndicator.hidden = !this.usingCache;
    this.cacheIndicator.title = this.cachedAt
      ? `Cached ${new Date(this.cachedAt).toLocaleString()}`
      : "Cached data";
  }

  renderActiveView() {
    if (this.activeView === "graph") return this.renderGraph();
    if (this.activeView === "insights") return this.renderInsights();
    return this.renderBoard();
  }

  renderBoard() {
    this.reconcileCollapsedColumns(this.orderBuckets(groupIssuesByColumn(this.issues)));
    const content = h("section", { class: "board-workspace" },
      this.renderSummary(),
      h("div", { class: "columns", "data-scroll-key": "board-columns" }, this.orderBuckets(groupIssuesByColumn(this.getFilteredIssues()))
        .map((bucket) => this.renderColumn(bucket))),
    );
    return h("main", {
      class: `view-layout board-layout${this.selectedIssue ? " has-selection" : ""}`,
      style: `--inspector-width:${this.inspectorWidth}px`,
    },
      content,
      this.selectedIssue ? this.renderInspector(this.selectedIssue) : null,
    );
  }

  renderSummary() {
    const active = this.issues.filter((issue) => issue.status !== "closed").length;
    const ready = this.issues.filter((issue) => issue.ready).length;
    const blocked = this.issues.filter((issue) => issue.status === "blocked").length;
    const closed = this.issues.filter((issue) => issue.status === "closed").length;
    const total = this.issues.length || 1;
    return h("div", { class: "summary" },
      h("div", { class: "summary-copy" }, h("strong", {}, this.projectName), h("span", {}, `${active} active issues`)),
      this.renderMetric(ready, "ready"),
      this.renderMetric(blocked, "blocked"),
      h("div", { class: "progress" },
        h("span", {}, `${closed} of ${this.issues.length} closed`),
        h("div", { class: "progress-track" }, h("i", { style: `width:${Math.round((closed / total) * 100)}%` })),
      ),
    );
  }

  renderMetric(value, label) {
    return h("div", { class: "summary-metric" }, h("b", {}, value), h("span", {}, label));
  }

  renderColumn(bucket) {
    const isCollapsed = this.collapsedColumns.has(bucket.id);
    const attrs = {
      class: `column column-${bucket.id}${isCollapsed ? " is-collapsed" : ""}`,
      "data-column-id": bucket.id,
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
      }, h("span", { class: "collapsed-count" }, bucket.issues.length), h("span", { class: "collapsed-title" }, bucket.title));
    }

    return h("section", attrs,
      h("button", {
        class: "column-header",
        draggable: true,
        title: `Collapse ${bucket.title}`,
        onclick: () => this.toggleColumn(bucket.id),
        ondragstart: (event) => this.handleColumnDragStart(event, bucket.id),
        ondragend: () => this.handleColumnDragEnd(),
      }, h("span", { class: "column-title" }, bucket.title), h("span", { class: "column-count" }, bucket.issues.length)),
      h("div", { class: "column-body", "data-scroll-key": `column:${bucket.id}` }, bucket.issues.length === 0
        ? h("div", { class: "column-empty" }, "No issues")
        : bucket.issues.map((issue) => this.renderCard(issue))),
    );
  }

  renderCard(issue) {
    return h("button", {
      class: `card priority-${issue.priority ?? "unknown"}${this.selectedIssue?.id === issue.id ? " is-selected" : ""}`,
      onclick: () => this.selectIssue(issue),
    },
      h("div", { class: "card-topline" },
        h("span", { class: "issue-id" }, issue.id),
        h("span", { class: `priority priority-${issue.priority ?? "unknown"}` }, getPriorityLabel(issue.priority)),
      ),
      h("div", { class: "card-title" }, issue.title),
      h("div", { class: "card-meta" },
        issue.ready ? h("span", { class: "badge badge-ready" }, "Ready") : null,
        h("span", { class: "muted" }, issue.issue_type),
        getIssueAge(issue) ? h("span", { class: "muted" }, getIssueAge(issue)) : null,
      ),
    );
  }

  renderGraph() {
    const graph = buildDependencyGraph(this.getFilteredIssues());
    const chain = this.getGraphChain(graph);
    return h("main", {
      class: `view-layout graph-layout${this.selectedIssue ? " has-selection" : ""}`,
      style: `--inspector-width:${this.inspectorWidth}px`,
    },
      h("section", {
        class: "graph-workspace",
      },
        h("div", { class: "view-heading" },
          h("div", {}, h("h1", {}, "Dependency graph"), h("p", {}, "Blockers flow left to right — select an issue to trace its chain.")),
          h("span", { class: "result-count" }, `${graph.nodes.length} ${graph.nodes.length === 1 ? "issue" : "issues"} · ${graph.edges.length} ${graph.edges.length === 1 ? "dependency" : "dependencies"}`),
        ),
        graph.nodes.length ? this.renderGraphCanvas(graph, chain) : this.renderGraphEmpty(),
      ),
      this.selectedIssue ? this.renderInspector(this.selectedIssue) : null,
    );
  }

  renderGraphCanvas(graph, chain) {
    const left = (id) => GRAPH_PADDING + graph.level.get(id) * (GRAPH_NODE_WIDTH + GRAPH_COL_GAP);
    const top = (id) => GRAPH_PADDING + graph.row.get(id) * (GRAPH_NODE_MIN_HEIGHT + GRAPH_ROW_GAP);
    const width = GRAPH_PADDING * 2 + graph.columns * GRAPH_NODE_WIDTH + Math.max(0, graph.columns - 1) * GRAPH_COL_GAP;
    const initialHeight = GRAPH_PADDING * 2 + graph.rows * GRAPH_NODE_MIN_HEIGHT + Math.max(0, graph.rows - 1) * GRAPH_ROW_GAP;
    const maskID = `beads-graph-card-mask-${++this.graphRenderSequence}`;

    const edgeElements = graph.edges.map((edge) => {
      const line = svg("path", { class: "graph-edge-line" });
      const head = svg("path", { class: "graph-edge-head" });
      const group = svg("g", { class: `graph-edge${this.edgeState(chain, edge)}` }, line, head);
      return { edge, group, line, head };
    });
    const maskBackground = svg("rect", { x: 0, y: 0, width, height: initialHeight, fill: "white" });
    const edgeMask = svg("mask", {
      class: "graph-edge-mask",
      id: maskID,
      x: 0,
      y: 0,
      width,
      height: initialHeight,
      maskUnits: "userSpaceOnUse",
      maskContentUnits: "userSpaceOnUse",
    }, maskBackground);
    const maskedEdges = svg("g", { mask: `url(#${maskID})` }, edgeElements.map(({ group }) => group));
    const edgeLayer = svg("svg", {
      class: "graph-edges",
      width,
      height: initialHeight,
      viewBox: `0 0 ${width} ${initialHeight}`,
    }, svg("defs", {}, edgeMask), maskedEdges);

    const nodeElements = new Map(graph.nodes.map((issue) => [
      issue.id,
      this.renderGraphNode(issue, left(issue.id), top(issue.id), chain),
    ]));
    const canvas = h("div", {
      class: "graph-canvas",
      style: `width:${width}px;height:${initialHeight}px`,
    }, edgeLayer, [...nodeElements.values()]);
    queueMicrotask(() => this.layoutGraphCanvas(canvas, edgeLayer, edgeMask, maskBackground, graph, nodeElements, edgeElements, width));

    return h("div", { class: "graph-scroll", "data-scroll-key": "graph" },
      canvas,
    );
  }

  layoutGraphCanvas(canvas, edgeLayer, edgeMask, maskBackground, graph, nodeElements, edgeElements, width) {
    if (!canvas.isConnected) return;

    const positions = new Map();
    let height = GRAPH_PADDING * 2;

    for (let level = 0; level < graph.columns; level += 1) {
      const issues = graph.nodes
        .filter((issue) => graph.level.get(issue.id) === level)
        .sort((a, b) => graph.row.get(a.id) - graph.row.get(b.id));
      let y = GRAPH_PADDING;

      for (const issue of issues) {
        const node = nodeElements.get(issue.id);
        if (!node) continue;
        const x = GRAPH_PADDING + level * (GRAPH_NODE_WIDTH + GRAPH_COL_GAP);
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        const nodeHeight = Math.max(GRAPH_NODE_MIN_HEIGHT, node.offsetHeight);
        positions.set(issue.id, { x, y, width: GRAPH_NODE_WIDTH, height: nodeHeight });
        y += nodeHeight + GRAPH_ROW_GAP;
      }

      if (issues.length) height = Math.max(height, y - GRAPH_ROW_GAP + GRAPH_PADDING);
    }

    canvas.style.height = `${height}px`;
    edgeLayer.setAttribute("width", String(width));
    edgeLayer.setAttribute("height", String(height));
    edgeLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    edgeMask.setAttribute("width", String(width));
    edgeMask.setAttribute("height", String(height));
    maskBackground.setAttribute("width", String(width));
    maskBackground.setAttribute("height", String(height));
    edgeMask.replaceChildren(maskBackground, ...[...positions.values()].map((position) => svg("rect", {
      x: position.x,
      y: position.y,
      width: position.width,
      height: position.height,
      rx: 8,
      ry: 8,
      fill: "black",
    })));

    for (const { edge, group, line, head } of edgeElements) {
      const source = positions.get(edge.from);
      const target = positions.get(edge.to);
      if (!source || !target) {
        group.setAttribute("display", "none");
        continue;
      }

      const sx = source.x + source.width;
      const sy = source.y + source.height / 2;
      const tx = target.x;
      const ty = target.y + target.height / 2;
      const curve = Math.max(24, (tx - sx) * 0.5);
      line.setAttribute("d", `M${sx},${sy} C${sx + curve},${sy} ${tx - curve},${ty} ${tx},${ty}`);
      head.setAttribute("d", `M${tx - 7},${ty - 4} L${tx},${ty} L${tx - 7},${ty + 4} Z`);
    }
  }

  renderGraphNode(issue, x, y, chain) {
    const dependents = issue.dependent_count || 0;
    return h("button", {
      class: `graph-node priority-${issue.priority ?? "unknown"} status-${issue.status}${issue.ready ? " is-ready" : ""}${this.selectedIssue?.id === issue.id ? " is-selected" : ""}${this.nodeState(chain, issue.id)}`,
      style: `left:${x}px;top:${y}px;width:${GRAPH_NODE_WIDTH}px;min-height:${GRAPH_NODE_MIN_HEIGHT}px`,
      title: issue.title,
      onclick: () => this.selectIssue(issue),
    },
      h("div", { class: "graph-node-top" },
        h("span", { class: "issue-id" }, issue.id),
        h("span", { class: `priority priority-${issue.priority ?? "unknown"}` }, getPriorityLabel(issue.priority)),
      ),
      h("div", { class: "graph-node-title" }, issue.title),
      h("div", { class: "graph-node-foot" },
        issue.ready ? h("span", { class: "badge badge-ready" }, "Ready") : h("span", { class: `badge status-${issue.status}` }, getStatusLabel(issue.status)),
        dependents ? h("span", { class: "muted" }, `unblocks ${dependents}`) : null,
      ),
    );
  }

  renderGraphEmpty() {
    return h("div", { class: "graph-empty" },
      icon("rectangle3group", 26),
      h("div", { class: "empty-title" }, "No matching issues"),
      h("div", { class: "empty-copy" }, "Try a different filter."),
    );
  }

  getGraphChain(graph) {
    const start = this.selectedIssue?.id;
    if (!start || !graph.blockers) return null;
    if (!graph.nodes.some((issue) => issue.id === start)) return null;
    const chain = new Set([start]);
    const walk = (id, map) => {
      for (const next of map.get(id) ?? []) {
        if (chain.has(next)) continue;
        chain.add(next);
        walk(next, map);
      }
    };
    walk(start, graph.blockers);
    walk(start, graph.dependents);
    return chain;
  }

  nodeState(chain, id) {
    if (!chain) return "";
    return chain.has(id) ? " is-active" : " is-dim";
  }

  edgeState(chain, edge) {
    if (!chain) return "";
    return chain.has(edge.from) && chain.has(edge.to) ? " is-active" : " is-dim";
  }

  renderInsights() {
    const insights = buildInsights(this.getFilteredIssues());
    return h("main", {
      class: `view-layout insights-layout${this.selectedIssue ? " has-selection" : ""}`,
      style: `--inspector-width:${this.inspectorWidth}px`,
    },
      h("section", { class: "insights-workspace", "data-scroll-key": "insights" },
        h("div", { class: "view-heading" },
          h("div", {}, h("h1", {}, "Project health"), h("p", {}, "Where work is stuck, and what unblocks the most.")),
          h("span", { class: "result-count" }, `${insights.metrics.total} issues`),
        ),
        h("div", { class: "insights-body" },
          this.renderMetricTiles(insights.metrics),
          h("div", { class: "insights-grid" },
            this.renderBottlenecks(insights.bottlenecks),
            this.renderWaiting(insights.waiting),
            this.renderIssueListCard("Ready to start", "No unresolved blockers", insights.ready,
              (issue) => h("span", { class: `priority priority-${issue.priority ?? "unknown"}` }, getPriorityLabel(issue.priority)),
              "Nothing is ready right now."),
            this.renderIssueListCard("Stale", "Untouched the longest", insights.stale,
              (issue) => h("span", { class: "muted" }, getIssueAge(issue) || "—"),
              "No active issues."),
            this.renderDistribution("Priority", insights.priorityDist, (bucket) =>
              h("span", { class: `priority priority-${bucket.value ?? "unknown"}` }, bucket.label)),
            this.renderDistribution("Status", insights.statusDist.map((entry) => ({ ...entry, key: entry.status })), (entry) =>
              h("span", { class: `badge status-${entry.status}` }, getStatusLabel(entry.status))),
          ),
        ),
      ),
      this.selectedIssue ? this.renderInspector(this.selectedIssue) : null,
    );
  }

  renderMetricTiles(metrics) {
    const tiles = [
      { value: metrics.total, label: "total" },
      { value: metrics.active, label: "active" },
      { value: metrics.ready, label: "ready", tone: "ready" },
      { value: metrics.waiting, label: "blocked", tone: "blocked" },
      { value: `${metrics.closedPct}%`, label: "closed" },
    ];
    return h("div", { class: "metric-tiles" }, tiles.map((tile) => h("div", {
      class: `metric-tile${tile.tone ? ` tone-${tile.tone}` : ""}`,
    }, h("b", {}, tile.value), h("span", {}, tile.label))));
  }

  renderBottlenecks(entries) {
    return this.renderInsightCard("Bottlenecks", "Finishing these frees the most work", entries.length,
      entries.slice(0, INSIGHT_LIST_LIMIT).map((entry) => this.renderInsightRow(entry.issue,
        h("span", { class: "lever" }, `blocks ${entry.count}`))),
      "Nothing is blocking other work.");
  }

  renderWaiting(entries) {
    return this.renderInsightCard("Blocked & waiting", "Held up by open blockers", entries.length,
      entries.slice(0, INSIGHT_LIST_LIMIT).map((entry) => h("div", { class: "waiting-item" },
        h("button", {
          class: `waiting-head${this.selectedIssue?.id === entry.issue.id ? " is-selected" : ""}`,
          onclick: () => this.selectIssue(entry.issue),
        },
          h("span", { class: `state-dot status-${entry.issue.status}` }),
          h("span", { class: "insight-main" }, h("b", {}, entry.issue.title), h("small", {}, entry.issue.id)),
          h("span", { class: "lever" }, `${entry.blockers.length} blocking`),
        ),
        h("div", { class: "chip-row" }, entry.blockers.map((blocker) => this.renderDepChip(blocker))),
      )),
      "Nothing is waiting on an open blocker.");
  }

  renderIssueListCard(title, subtitle, issues, trailing, emptyText) {
    return this.renderInsightCard(title, subtitle, issues.length,
      issues.slice(0, INSIGHT_LIST_LIMIT).map((issue) => this.renderInsightRow(issue, trailing(issue))),
      emptyText);
  }

  renderInsightRow(issue, trailing) {
    return h("button", {
      class: `insight-row${this.selectedIssue?.id === issue.id ? " is-selected" : ""}`,
      onclick: () => this.selectIssue(issue),
    },
      h("span", { class: `state-dot status-${issue.status}` }),
      h("span", { class: "insight-main" }, h("b", {}, issue.title), h("small", {}, issue.id)),
      trailing || null,
    );
  }

  renderDistribution(title, buckets, label) {
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    return h("section", { class: "insights-card" },
      h("div", { class: "insights-card-head" }, h("h2", {}, title)),
      h("div", { class: "insights-card-body" }, buckets.map((bucket) => h("div", { class: "bar-row" },
        h("span", { class: "bar-label" }, label(bucket)),
        h("div", { class: "bar-track" }, h("i", { style: `width:${Math.round((bucket.count / max) * 100)}%` })),
        h("span", { class: "bar-count" }, bucket.count),
      ))),
    );
  }

  renderInsightCard(title, subtitle, count, rows, emptyText) {
    return h("section", { class: "insights-card" },
      h("div", { class: "insights-card-head" },
        h("h2", {}, title),
        count != null ? h("span", { class: "insights-card-count" }, count) : null,
      ),
      subtitle ? h("p", { class: "insights-card-sub" }, subtitle) : null,
      rows.length
        ? h("div", { class: "insights-card-body" }, rows)
        : h("div", { class: "insights-empty" }, emptyText),
    );
  }

  renderDepChip(issue) {
    return h("button", {
      class: `dep-chip${this.selectedIssue?.id === issue.id ? " is-selected" : ""}`,
      title: issue.title,
      onclick: () => this.selectIssue(issue),
    },
      h("span", { class: `state-dot status-${issue.status}` }),
      h("span", { class: "issue-id" }, issue.id),
      h("span", { class: "dep-chip-title" }, issue.title),
    );
  }

  renderRelations(issue) {
    const blockerLinks = getBlockerLinks(issue, this.index);
    const dependentLinks = getDependentLinks(issue, this.index);
    const blockedBy = blockerLinks.filter((link) => link.type === BLOCKING_EDGE);
    const unblocks = dependentLinks.filter((link) => link.type === BLOCKING_EDGE);
    const related = new Map();
    for (const link of [...blockerLinks, ...dependentLinks]) {
      if (link.type !== BLOCKING_EDGE) related.set(link.issue.id, link.issue);
    }
    if (!blockedBy.length && !unblocks.length && !related.size) return null;

    return h("section", { class: "detail-section" },
      h("h2", {}, "Dependencies"),
      this.renderRelationGroup("Blocked by", blockedBy.map((link) => link.issue)),
      this.renderRelationGroup("Unblocks", unblocks.map((link) => link.issue)),
      this.renderRelationGroup("Related", [...related.values()]),
    );
  }

  renderRelationGroup(label, issues) {
    if (!issues.length) return null;
    return h("div", { class: "relation-group" },
      h("small", {}, label),
      h("div", { class: "chip-row" }, issues.map((issue) => this.renderDepChip(issue))),
    );
  }

  renderInspector(issue) {
    return h("aside", { class: "inspector" },
      h("div", {
        class: "inspector-resizer",
        role: "separator",
        tabindex: "0",
        "aria-label": "Resize issue details",
        "aria-orientation": "vertical",
        "aria-valuemin": MIN_INSPECTOR_WIDTH,
        "aria-valuemax": MAX_INSPECTOR_WIDTH,
        "aria-valuenow": this.inspectorWidth,
        onpointerdown: (event) => this.startInspectorResize(event),
        onkeydown: (event) => this.handleInspectorResizeKey(event),
      }, h("span", {})),
      h("div", { class: "inspector-head" },
        h("button", { class: "icon-button close-inspector", title: "Close details", onclick: () => { this.selectedIssue = null; this.render(); } }, icon("x", 13)),
        h("div", { class: "detail-kicker" }, issue.id),
        h("h1", {}, issue.title),
        this.renderBadges(issue),
      ),
      h("div", { class: "inspector-body", "data-scroll-key": `inspector:${issue.id}` },
        this.renderRelations(issue),
        this.renderField("Description", issue.description),
        this.renderField("Design", issue.design),
        this.renderField("Acceptance", issue.acceptance_criteria),
        this.renderField("Notes", issue.notes),
        this.renderStats(issue),
      ),
    );
  }

  renderBadges(issue) {
    return h("div", { class: "detail-badges" },
      h("span", { class: `priority priority-${issue.priority ?? "unknown"}` }, getPriorityLabel(issue.priority)),
      h("span", { class: `badge status-${issue.status}` }, getStatusLabel(issue.status)),
      issue.ready ? h("span", { class: "badge badge-ready" }, "Ready") : null,
      h("span", { class: "badge" }, issue.issue_type),
    );
  }

  renderField(label, value) {
    if (!value) return null;
    return h("section", { class: "detail-section" }, h("h2", {}, label), h("p", {}, value));
  }

  renderStats(issue) {
    return h("section", { class: "detail-section" },
      h("h2", {}, "Activity"),
      h("div", { class: "stat-grid" },
        this.renderStat(issue.dependency_count, "blockers"),
        this.renderStat(issue.dependent_count, "dependents"),
        this.renderStat(issue.comment_count, "comments"),
      ),
    );
  }

  renderStat(value, label) {
    return h("div", {}, h("span", {}, value), h("small", {}, label));
  }

  renderNotice() {
    const message = this.usingCache ? `Showing cached data. ${this.error}` : this.error;
    return h("div", { class: "notice" }, icon("alertCircle", 14), h("span", {}, message));
  }

  renderLoading() {
    return h("div", {
      class: "loading-state",
      role: "status",
      "aria-live": "polite",
      "aria-label": "Loading beads",
    },
      h("span", { class: "loading-spinner", "aria-hidden": "true" }),
      h("div", { class: "empty-title" }, "Loading beads…"),
      h("div", { class: "empty-copy" }, "Checking the workspace and its cached issue data."),
    );
  }

  renderEmpty() {
    const hasBeadsSource = this.source !== "none";
    return h("div", { class: "empty-state" },
      icon("rectangle3group", 28),
      h("div", { class: "empty-title" }, this.filterText ? "No matching issues" : hasBeadsSource ? "No issues yet" : "No beads found"),
      h("div", { class: "empty-copy" }, this.filterText
        ? "Try a different filter."
        : hasBeadsSource ? "This Beads workspace does not contain any issues yet." : "Open a workspace with a Beads database or exported issues.jsonl."),
      !this.filterText && !hasBeadsSource ? h("div", { class: "debug" },
        h("div", {}, `project: ${this.projectName || "unknown"}`),
        h("div", {}, `workspace: ${this.workspacePath || "not set"}`),
        h("div", {}, `source: ${this.source}`),
      ) : null,
    );
  }

  selectIssue(issue) {
    this.selectedIssue = issue;
    this.render();
  }

  setView(view) {
    if (!VIEWS.some((item) => item.id === view)) return;
    this.activeView = view;
    this.saveLayout();
    this.render();
  }

  toggleColumn(columnID) {
    if (Date.now() < this.suppressColumnClickUntil) return;
    this.touchedColumns.add(columnID);
    if (this.collapsedColumns.has(columnID)) this.collapsedColumns.delete(columnID);
    else this.collapsedColumns.add(columnID);
    this.render();
  }

  reconcileCollapsedColumns(buckets) {
    for (const bucket of buckets) {
      if (this.touchedColumns.has(bucket.id)) continue;
      if (bucket.issues.length === 0) this.collapsedColumns.add(bucket.id);
      else this.collapsedColumns.delete(bucket.id);
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
      this.activeView = VIEWS.some((view) => view.id === layout?.activeView) ? layout.activeView : DEFAULT_VIEW;
      this.inspectorWidth = this.normalizeInspectorWidth(layout?.inspectorWidth);
    } catch {
      this.columnOrder = [];
      this.autoRefreshMs = DEFAULT_AUTO_REFRESH_MS;
      this.activeView = DEFAULT_VIEW;
      this.inspectorWidth = DEFAULT_INSPECTOR_WIDTH;
    }
  }

  async saveLayout() {
    try {
      await muxy.storage.set(LAYOUT_STORAGE_KEY, {
        columnOrder: this.columnOrder,
        autoRefreshMs: this.autoRefreshMs,
        activeView: this.activeView,
        inspectorWidth: this.inspectorWidth,
      });
    } catch {
    }
  }

  normalizeAutoRefreshMs(value) {
    const numeric = Number(value);
    return AUTO_REFRESH_OPTIONS.some((option) => option.value === numeric) ? numeric : DEFAULT_AUTO_REFRESH_MS;
  }

  normalizeInspectorWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_INSPECTOR_WIDTH;
    return Math.round(Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, numeric)));
  }

  startInspectorResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.inspectorWidth;
    const resizer = event.currentTarget;
    resizer.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-resizing-inspector");

    const handleMove = (moveEvent) => {
      const viewportLimit = Math.max(MIN_INSPECTOR_WIDTH, window.innerWidth - 360);
      this.inspectorWidth = this.normalizeInspectorWidth(Math.min(viewportLimit, startWidth + startX - moveEvent.clientX));
      this.root.querySelector(".view-layout")?.style.setProperty("--inspector-width", `${this.inspectorWidth}px`);
      resizer.setAttribute("aria-valuenow", String(this.inspectorWidth));
    };
    const handleUp = () => {
      document.body.classList.remove("is-resizing-inspector");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      this.saveLayout();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  handleInspectorResizeKey(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 20 : -20;
    this.inspectorWidth = this.normalizeInspectorWidth(this.inspectorWidth + delta);
    this.saveLayout();
    this.render();
    this.root.querySelector(".inspector-resizer")?.focus();
  }

  setAutoRefresh(value) {
    this.autoRefreshMs = this.normalizeAutoRefreshMs(value);
    this.applyAutoRefreshTimer();
    this.saveLayout();
  }

  applyAutoRefreshTimer() {
    this.clearAutoRefreshTimer();
    if (this.autoRefreshMs <= 0) return;
    this.pollTimer = setInterval(() => this.refresh(), this.autoRefreshMs);
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
    if (!sourceColumnID || sourceColumnID === targetColumnID) return this.handleColumnDragEnd();
    const orderedIDs = this.orderBuckets(groupIssuesByColumn(this.issues)).map((bucket) => bucket.id);
    const sourceIndex = orderedIDs.indexOf(sourceColumnID);
    const targetIndex = orderedIDs.indexOf(targetColumnID);
    if (sourceIndex === -1 || targetIndex === -1) return this.handleColumnDragEnd();
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
    this.root.querySelectorAll(".column.is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
  }

  getFilteredIssues() {
    if (!this.filterText) return this.issues;
    const query = this.filterText.toLowerCase();
    return this.issues.filter((issue) => [
      issue.id, issue.title, issue.description, issue.issue_type, issue.status, ...issue.labels,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }
}
