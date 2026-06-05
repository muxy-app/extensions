import { h } from "@/lib/dom";
import { relativeTime, MAX_LANES } from "@/lib/graph";
import { openCommitDiff } from "@/lib/git";
import { cherryPickCommit, copyHash, openCommitOnGithub, revertCommit } from "@/lib/commit-actions";
import type { CommitLane, CommitNode, CommitRef } from "@/lib/types";
import { button, emptyState, menuItem, openFloating, smallIconButton } from "@/ui/shared";
import type { GitPanelApp } from "@/panel/app";

const COLUMN_WIDTH = 12;
const ROW_HEIGHT = 34;
const DOT_RADIUS = 4;

export function renderHistoryTab(app: GitPanelApp): HTMLElement {
  if (app.graph.rows.length === 0) {
    return emptyState(app.graph.loading ? "Loading..." : "No commits.");
  }
  return h(
    "div",
    { class: "flex min-h-0 flex-1 flex-col overflow-auto" },
    h(
      "ul",
      { class: "divide-y divide-border" },
      app.graph.rows.map((row) => renderCommitRow(app, row.commit, row.lane)),
    ),
    app.graph.hasMore
      ? button(app.graph.loading ? "Loading..." : "Load more", {
          variant: "ghost",
          disabled: app.graph.loading,
          className: "m-1 h-7 justify-center text-[12px]",
          onClick: () => void app.loadMoreGraph(),
        })
      : null,
  );
}

function renderCommitRow(app: GitPanelApp, commit: CommitNode, lane: CommitLane): HTMLLIElement {
  return h(
    "li",
    {
      class: "group flex h-[34px] cursor-pointer items-center gap-2 pl-2.5 pr-2.5 hover:bg-accent",
      onclick: () => void openCommitDiff(commit.hash, commit.shortHash),
    },
    commitGraphRail(lane),
    h(
      "span",
      { class: "min-w-[60px] flex-1 truncate text-left text-[12px] font-medium text-foreground", title: commit.subject },
      commit.subject,
    ),
    h("span", { class: "flex min-w-0 max-w-[45%] shrink justify-end" }, commitRefs(commit.refs)),
    h("span", { class: "shrink-0 font-mono text-[10px] text-muted-foreground", title: commit.hash }, commit.shortHash),
    h("span", { class: "shrink-0 text-[10px] text-muted-foreground", title: commit.authorName }, relativeTime(commit.authorDate)),
    smallIconButton("More actions", "more", (event) => {
      event.stopPropagation();
      openCommitMenu(app, commit, event.currentTarget as HTMLElement);
    }, "flex opacity-0 group-hover:opacity-100"),
  );
}

function openCommitMenu(app: GitPanelApp, commit: CommitNode, anchor: HTMLElement): void {
  const content = h(
    "div",
    { class: "p-1" },
    menuItem("View diff", null, () => void openCommitDiff(commit.hash, commit.shortHash)),
    menuItem("Copy hash", null, () => void copyHash(commit)),
    menuItem("Open on GitHub", null, () => void openCommitOnGithub(commit)),
    menuItem("Cherry-pick", null, () => void cherryPickCommit(commit, () => app.refreshAll())),
    menuItem("Revert", null, () =>
      void revertCommit(
        commit,
        (message) => {
          app.message = message;
          app.setTab("branch");
        },
        () => app.refreshAll(),
      ),
    ),
  );
  openFloating(anchor, content, { width: 176, align: "end" });
}

function laneColor(column: number): string {
  return `var(--lane-${column % MAX_LANES})`;
}

function columnX(column: number): number {
  return COLUMN_WIDTH / 2 + Math.min(column, MAX_LANES - 1) * COLUMN_WIDTH;
}

function commitGraphRail(lane: CommitLane): SVGSVGElement {
  const columns = Math.min(MAX_LANES, Math.max(lane.width, lane.column + 1));
  const width = columns * COLUMN_WIDTH;
  const mid = ROW_HEIGHT / 2;
  const x = columnX(lane.column);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "shrink-0");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(ROW_HEIGHT));
  svg.setAttribute("viewBox", `0 0 ${width} ${ROW_HEIGHT}`);
  svg.setAttribute("aria-hidden", "true");
  for (const column of lane.passthrough) {
    svg.appendChild(svgLine(columnX(column), 0, columnX(column), ROW_HEIGHT, laneColor(column)));
  }
  svg.appendChild(svgLine(x, 0, x, mid, laneColor(lane.column)));
  for (const edge of lane.edges) {
    const tx = columnX(edge.toColumn);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x} ${mid} C ${x} ${ROW_HEIGHT} ${tx} ${mid} ${tx} ${ROW_HEIGHT}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", laneColor(edge.toColumn));
    path.setAttribute("stroke-width", "1.5");
    svg.appendChild(path);
  }
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(mid));
  circle.setAttribute("r", String(DOT_RADIUS));
  circle.setAttribute("fill", "var(--muxy-background)");
  circle.setAttribute("stroke", laneColor(lane.column));
  circle.setAttribute("stroke-width", "1.5");
  svg.appendChild(circle);
  return svg;
}

function svgLine(x1: number, y1: number, x2: number, y2: number, stroke: string): SVGLineElement {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", "1.5");
  return line;
}

function commitRefs(refs: CommitRef[]): HTMLSpanElement | null {
  if (refs.length === 0) return null;
  const visible = refs.slice(0, 2);
  const hidden = refs.length - visible.length;
  return h(
    "span",
    { class: "flex min-w-0 shrink items-center gap-1" },
    visible.map((ref) =>
      h(
        "span",
        {
          class: `max-w-[88px] shrink truncate rounded px-1.5 py-px text-[10px] font-medium leading-tight ${refClass(ref)}`,
          title: ref.name,
        },
        ref.name,
      ),
    ),
    hidden > 0
      ? h(
          "span",
          {
            class: "shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium leading-tight text-muted-foreground",
            title: refs.slice(2).map((ref) => ref.name).join(", "),
          },
          `+${hidden}`,
        )
      : null,
  );
}

function refClass(ref: CommitRef): string {
  const kind = ref.kind.toLowerCase();
  const name = ref.name.toLowerCase();
  if (kind.includes("tag")) return "bg-diff-add/15 text-diff-add";
  if (kind.includes("remote") || name.startsWith("origin/") || name.includes("/")) {
    return "bg-muted text-muted-foreground";
  }
  if (kind.includes("head") || name === "head") return "bg-primary/15 text-primary";
  return "bg-primary/10 text-primary";
}
