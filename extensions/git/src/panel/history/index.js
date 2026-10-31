import { cls, h, toggle, fill } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenu } from "@/shared/menu";
import { relativeTime, absoluteTime } from "@/shared/time";
import { VirtualList } from "@/shared/virtual-list";
import { computeGraph } from "@/core/graph";
import * as git from "@/core/git";
import { placeholder, spinner } from "@/panel/ui";
import { rail } from "@/panel/history/rail";
import { commitMenu, openCommit, openRange } from "@/panel/ops/history";
import { pull } from "@/panel/ops/sync";

const ROW_HEIGHT = 28;
const PAGE = 100;

function refChips(refs) {
  const shown = refs.slice(0, 2);
  const extra = refs.length - shown.length;
  return [
    ...shown.map((ref) => h("span", { class: cls("chip", ref.kind === "remote" && "chip-muted", ref.kind === "tag" && "chip-tag"), title: ref.name }, ref.name)),
    extra > 0 ? h("span", { class: "chip chip-muted", title: refs.slice(2).map((ref) => ref.name).join(", ") }, `+${extra}`) : null,
  ];
}

function matches(commit, query) {
  if (!query) return true;
  return commit.subject.toLowerCase().includes(query) || commit.authorName.toLowerCase().includes(query) || commit.hash.startsWith(query);
}

export class HistoryView {
  constructor(ctl) {
    this.ctl = ctl;
    this.commits = [];
    this.incoming = [];
    this.outgoing = new Set();
    this.hasMore = false;
    this.loading = false;
    this.loadId = 0;
    this.stale = true;
    this.visible = false;
    this.query = "";
    this.incomingOpen = false;
    this.filterInput = h("input", {
      class: "field",
      placeholder: "Filter by message, author, or hash",
      spellcheck: "false",
      oninput: () => {
        this.query = this.filterInput.value.trim().toLowerCase();
        this.renderRows();
      },
    });
    this.canvas = h("div", { class: "list-canvas" });
    this.listEl = h("div", { class: "list", tabindex: "0", "aria-label": "History" }, this.canvas);
    this.empty = h("div", { class: "history-empty", hidden: true });
    this.el = h("section", { class: "view history" }, h("div", { class: "filter-row" }, this.filterInput), this.listEl, this.empty);
    this.list = new VirtualList(this.listEl, this.canvas, {
      rowHeight: ROW_HEIGHT,
      key: (row) => row.key,
      signature: (row) => this.signature(row),
      create: () => h("div", { class: "row commit-row" }),
      update: (el, row) => this.paint(el, row),
      onScroll: () => this.maybeLoadMore(),
    });
    this.listEl.addEventListener("click", (event) => this.onClick(event));
    this.listEl.addEventListener("contextmenu", (event) => this.onContextMenu(event));
  }

  signature(row) {
    if (row.type === "header") return `header|${this.incomingOpen}|${this.incoming.length}`;
    if (row.type !== "commit") return row.key;
    const g = row.graph;
    return `${row.key}|${g.col}|${g.hasChild}|${g.pass}|${g.joins}|${g.edges}|${g.width}|${this.outgoing.has(g.commit.hash)}|${g.commit.refs.map((ref) => ref.name)}`;
  }

  paint(el, row) {
    if (row.type === "header") {
      el.className = "row row-section";
      fill(el, 
        h("span", { class: cls("twisty", this.incomingOpen && "twisty-open") }, icon("chevronRight", 12)),
        h("span", { class: "section-label" }, "Incoming"),
        h("span", { class: "count" }, String(this.incoming.length)),
        h("span", { class: "row-actions row-actions-always" }, h("button", { type: "button", class: "link-btn", dataset: { action: "pull" } }, "Pull")),
      );
      return;
    }
    if (row.type === "more") {
      el.className = "row row-more";
      fill(el, spinner(12), h("span", { class: "muted" }, "Loading…"));
      return;
    }
    const { commit } = row.graph;
    const outgoing = this.outgoing.has(commit.hash);
    el.className = cls("row commit-row", row.incoming && "commit-incoming");
    el.title = `${commit.subject}\n${commit.authorName} · ${absoluteTime(commit.authorDate)}\n${commit.hash}`;
    fill(el, 
      rail(row.graph, ROW_HEIGHT, { outgoing, dim: row.incoming }),
      h("span", { class: "commit-subject" }, commit.subject),
      h("span", { class: "commit-refs" }, refChips(commit.refs)),
      outgoing ? h("span", { class: "commit-out", title: "Not pushed yet" }, icon("arrowUp", 11)) : null,
      h("span", { class: "commit-hash" }, commit.shortHash),
      h("span", { class: "commit-time" }, relativeTime(commit.authorDate)),
    );
  }

  rows() {
    const rows = [];
    if (this.incoming.length && !this.query) {
      rows.push({ type: "header", key: "incoming" });
      if (this.incomingOpen) for (const graph of computeGraph(this.incoming)) rows.push({ type: "commit", key: `in:${graph.commit.hash}`, graph, incoming: true });
    }
    const filtered = this.query ? this.commits.filter((commit) => matches(commit, this.query)) : this.commits;
    const graphs = this.query ? filtered.map((commit) => ({ commit, col: 0, hasChild: false, joins: [], pass: [], edges: [], width: 1 })) : computeGraph(filtered);
    for (const graph of graphs) rows.push({ type: "commit", key: graph.commit.hash, graph });
    if (this.hasMore && this.loading) rows.push({ type: "more", key: "more" });
    return rows;
  }

  renderRows() {
    const rows = this.rows();
    this.list.setItems(rows);
    const empty = rows.length === 0;
    toggle(this.empty, !empty);
    toggle(this.listEl, empty);
    if (empty) fill(this.empty, this.loading ? h("div", { class: "placeholder" }, spinner(16)) : placeholder(this.query ? "No matching commits" : "No commits yet"));
  }

  async reload() {
    const id = ++this.loadId;
    this.stale = false;
    this.loading = true;
    if (!this.commits.length) this.renderRows();
    const { upstream } = this.ctl.state;
    try {
      const [first, incoming, outgoing] = await Promise.all([
        git.log({ maxCount: Math.max(PAGE, this.commits.length), fresh: true }),
        upstream.behind ? git.logRange("HEAD..@{upstream}", 200) : [],
        upstream.ahead ? git.outgoingHashes() : new Set(),
      ]);
      if (id !== this.loadId) return;
      this.commits = first;
      this.incoming = incoming;
      this.outgoing = outgoing;
      this.hasMore = first.length >= PAGE;
    } catch {
      if (id !== this.loadId) return;
      this.commits = [];
      this.hasMore = false;
    }
    this.loading = false;
    this.renderRows();
  }

  async maybeLoadMore() {
    if (!this.hasMore || this.loading || this.query || !this.list.nearBottom(400)) return;
    const id = this.loadId;
    this.loading = true;
    this.renderRows();
    try {
      const page = await git.log({ skip: this.commits.length, maxCount: PAGE });
      if (id !== this.loadId) return;
      const known = new Set(this.commits.map((commit) => commit.hash));
      this.commits = [...this.commits, ...page.filter((commit) => !known.has(commit.hash))];
      this.hasMore = page.length >= PAGE;
    } catch {
      this.hasMore = false;
    }
    this.loading = false;
    this.renderRows();
  }

  rowFromEvent(event) {
    const el = event.target.closest?.(".row");
    return el && this.canvas.contains(el) ? el._item : null;
  }

  onClick(event) {
    const row = this.rowFromEvent(event);
    if (!row) return;
    if (row.type === "header") {
      if (event.target.closest?.("[data-action=pull]")) void pull(this.ctl);
      else {
        this.incomingOpen = !this.incomingOpen;
        this.renderRows();
      }
      return;
    }
    if (row.type === "commit") openCommit(this.ctl, row.graph.commit);
  }

  onContextMenu(event) {
    const row = this.rowFromEvent(event);
    if (row?.type === "header") {
      event.preventDefault();
      openMenu([
        { label: "Open Incoming Changes", run: () => openRange(this.ctl, "HEAD...@{upstream}", "Incoming") },
        { label: "Pull", run: () => void pull(this.ctl) },
      ], event.clientX, event.clientY);
      return;
    }
    if (row?.type !== "commit") return;
    event.preventDefault();
    openMenu(commitMenu(this.ctl, row.graph.commit, event.target.closest(".row")), event.clientX, event.clientY);
  }

  update(state, prev) {
    if (state.repo?.root !== prev.repo?.root) {
      this.commits = [];
      this.incoming = [];
      this.outgoing = new Set();
      this.loadId += 1;
      this.loading = false;
      this.stale = true;
    }
    const now = state.status;
    const was = prev.status;
    if (state.headVersion !== prev.headVersion || (was && (now?.branch !== was.branch || now?.ahead !== was.ahead || (now?.staged.length ?? 0) < was.staged.length))) this.stale = true;
    if (this.visible && this.stale && state.phase === "ready") void this.reload();
  }

  show() {
    this.visible = true;
    this.renderRows();
    void this.reload();
  }

  hide() {
    this.visible = false;
  }
}
