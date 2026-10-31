import { CodeView, getFiletypeFromFileName, parsePatchFiles, preloadHighlighter } from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import { HEADER_CSS, MUXY_DIFF_THEME, registerMuxyDiffTheme } from "@/diff/theme";

const STATUS = { new: "A", deleted: "D", change: "M", "rename-pure": "R", "rename-changed": "R" };
const LINE_HEIGHT = 19;
const HEADER_HEIGHT = 35;

function workerPool() {
  try {
    return getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
        poolSize: 3,
      },
      highlighterOptions: { theme: MUXY_DIFF_THEME, lineDiffType: "word", preferredHighlighter: "shiki-js" },
    });
  } catch {
    return undefined;
  }
}

export function parseGroup(group) {
  const items = [];
  if (!group.patch.trim()) return items;
  for (const commit of parsePatchFiles(group.patch)) {
    for (const fileDiff of commit.files) {
      const additions = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0);
      const deletions = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0);
      const path = fileDiff.name;
      fileDiff.cacheKey = `${fileDiff.prevObjectId ?? ""}:${fileDiff.newObjectId ?? ""}:${path}:${fileDiff.hunks.length}:${additions}:${deletions}`;
      items.push({
        id: `${group.id}:${path}`,
        group: group.id,
        path,
        oldPath: fileDiff.prevName && fileDiff.prevName !== path ? fileDiff.prevName : null,
        code: STATUS[fileDiff.type] ?? "M",
        additions,
        deletions,
        fileDiff,
      });
    }
  }
  return items;
}

export class DiffViewer {
  constructor(host, { onActive, onHeaderAction, headerActions }) {
    registerMuxyDiffTheme();
    this.host = host;
    this.onActive = onActive;
    this.onHeaderAction = onHeaderAction;
    this.headerActions = headerActions;
    this.items = [];
    this.byId = new Map();
    this.collapsed = new Set();
    this.versions = new Map();
    this.style = "split";
    this.wrap = true;
    this.zoom = 1;
    this.suppress = false;
    this.frame = 0;
    this.active = "";
    this.view = new CodeView(this.options(), workerPool());
    this.view.setup(host);
    this.view.subscribeToScroll(() => this.syncActive());
    host.addEventListener("click", (event) => this.onClick(event));
  }

  options() {
    return {
      theme: MUXY_DIFF_THEME,
      useCSSClasses: true,
      diffStyle: this.style,
      diffIndicators: "bars",
      lineDiffType: "word",
      hunkSeparators: "metadata",
      stickyHeaders: true,
      overflow: this.wrap ? "wrap" : "scroll",
      itemMetrics: { lineHeight: Math.round(LINE_HEIGHT * this.zoom), diffHeaderHeight: Math.round(HEADER_HEIGHT * this.zoom) },
      layout: { gap: 0, paddingTop: 0, paddingBottom: 0 },
      unsafeCSS: HEADER_CSS,
      renderHeaderMetadata: (fileDiff, context) => this.headerActions?.(this.byId.get(context?.item?.id)) ?? null,
      onPostRender: (node, _instance, phase, context) => {
        if (phase !== "unmount") node.toggleAttribute("data-diffs-collapsed", this.collapsed.has(context?.item?.id));
      },
    };
  }

  configure({ style = this.style, wrap = this.wrap, zoom = this.zoom }) {
    this.style = style;
    this.wrap = wrap;
    this.zoom = zoom;
    this.view.setOptions(this.options());
  }

  setItems(items) {
    this.items = items;
    this.byId = new Map(items.map((item) => [item.id, item]));
    for (const id of [...this.collapsed]) if (!this.byId.has(id)) this.collapsed.delete(id);
    this.publish();
    const langs = new Set();
    for (const item of items) {
      const lang = getFiletypeFromFileName(item.path);
      if (lang && lang !== "text") langs.add(lang);
    }
    if (langs.size) void preloadHighlighter({ themes: [MUXY_DIFF_THEME], langs: [...langs] }).catch(() => undefined);
  }

  publish() {
    const versions = new Map();
    this.view.setItems(
      this.items.map((item) => {
        const collapsed = this.collapsed.has(item.id);
        const signature = `${item.fileDiff.cacheKey}:${collapsed ? 1 : 0}`;
        const previous = this.versions.get(item.id);
        const version = previous && previous.signature === signature ? previous : { signature, version: (previous?.version ?? 0) + 1 };
        versions.set(item.id, version);
        return { id: item.id, type: "diff", fileDiff: item.fileDiff, collapsed, version: version.version };
      }),
    );
    this.versions = versions;
  }

  toggle(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    this.publish();
  }

  setAllCollapsed(value) {
    this.collapsed = value ? new Set(this.items.map((item) => item.id)) : new Set();
    this.publish();
  }

  reveal(id) {
    if (!this.byId.has(id)) return;
    if (this.collapsed.delete(id)) this.publish();
    this.setActive(id);
    this.suppress = true;
    this.view.scrollTo({ type: "item", id, align: "start", behavior: "instant" });
    requestAnimationFrame(() => {
      this.suppress = false;
    });
  }

  setActive(id) {
    if (id === this.active) return;
    this.active = id;
    this.onActive(id);
  }

  syncActive() {
    if (this.suppress || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const top = this.view.getScrollTop();
      let best = "";
      let bestTop = -Infinity;
      for (const entry of this.view.getRenderedItems()) {
        const itemTop = this.view.getTopForItem(entry.id);
        if (itemTop === undefined || itemTop > top + 4 || itemTop <= bestTop) continue;
        bestTop = itemTop;
        best = entry.id;
      }
      if (best) this.setActive(best);
    });
  }

  onClick(event) {
    const path = event.composedPath();
    const action = path.find((node) => node instanceof HTMLElement && node.dataset?.diffAction);
    const container = path.find((node) => node instanceof HTMLElement && node.tagName?.toLowerCase() === "diffs-container");
    const rendered = container ? this.view.getRenderedItems().find((entry) => entry.element === container) : null;
    if (action) {
      event.stopPropagation();
      const id = action.dataset.itemId || rendered?.id;
      if (id) this.onHeaderAction(action.dataset.diffAction, this.byId.get(id));
      return;
    }
    const header = path.find((node) => node instanceof HTMLElement && node.hasAttribute?.("data-diffs-header"));
    if (header && rendered) this.toggle(rendered.id);
  }

  themeChanged() {
    this.view.onThemeChange();
  }
}
