import { h, readPref, writePref } from "@/lib/dom";
import * as cmd from "@/lib/cmd";
import { CodeView, parsePatchFiles, preloadHighlighter, getFiletypeFromFileName } from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import { DiffFileListView } from "./diff-file-list";
import { registerMuxyDiffTheme, MUXY_DIFF_THEME, HEADER_CSS } from "./theme";
import { openInEditor, revealInFinder } from "@/lib/file-actions";
import "@/styles/global.css";
import "./diff-viewer.css";

const viewerRoot = document.querySelector("#viewer");
const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const loadingLabel = document.querySelector("#loading-label");
const fileListNode = document.querySelector("#file-list");
const sourceLabelNode = document.querySelector("#source-label");
const summaryNode = document.querySelector("#summary");
const fileCountNode = document.querySelector("#file-count");
const statFilesNode = document.querySelector("#stat-files");
const statAdditionsNode = document.querySelector("#stat-additions");
const statDeletionsNode = document.querySelector("#stat-deletions");
const reloadButton = document.querySelector("#reload");
const zoomInButton = document.querySelector("#zoom-in");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomResetButton = document.querySelector("#zoom-reset");
const zoomLevelNode = document.querySelector("#zoom-reset");
const toggleStyleButton = document.querySelector("#toggle-style");
const toggleWrapButton = document.querySelector("#toggle-wrap");
const collapseAllButton = document.querySelector("#collapse-all");
const expandAllButton = document.querySelector("#expand-all");
const toggleTreeButton = document.querySelector("#toggle-tree");
const railResize = document.querySelector("#rail-resize");

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;
const RAIL_MIN = 180;
const RAIL_MAX = 520;

const STATUS_FOR_TYPE = {
  new: "added",
  deleted: "deleted",
  change: "modified",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
};

const BASE_LINE_HEIGHT = 19;
const BASE_HEADER_HEIGHT = 35;

let items = [];
let activeItemId = "";
let diffStyle = readPref("muxy.git.diff.style", "split");
let wrapLines = readPref("muxy.git.diff.wrap", "true") !== "false";
let zoom = Number(readPref("muxy.git.diff.zoom", "1")) || 1;
let collapsed = new Set();
let versions = new Map();
let suppressScrollSync = false;
let syncFrame = 0;

registerMuxyDiffTheme();

function itemMetrics() {
  return {
    lineHeight: Math.round(BASE_LINE_HEIGHT * zoom),
    diffHeaderHeight: Math.round(BASE_HEADER_HEIGHT * zoom),
  };
}

function createWorkerPool() {
  try {
    return getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: () =>
          new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
        poolSize: 4,
      },
      highlighterOptions: {
        theme: MUXY_DIFF_THEME,
        lineDiffType: "word",
        preferredHighlighter: "shiki-js",
      },
    });
  } catch {
    return undefined;
  }
}

function viewerOptions() {
  return {
    theme: MUXY_DIFF_THEME,
    useCSSClasses: true,
    diffStyle,
    diffIndicators: "bars",
    lineDiffType: "word",
    hunkSeparators: "metadata",
    stickyHeaders: true,
    overflow: wrapLines ? "wrap" : "scroll",
    itemMetrics: itemMetrics(),
    layout: { gap: 0, paddingTop: 0, paddingBottom: 0 },
    unsafeCSS: HEADER_CSS,
    onPostRender: (node, _instance, phase, context) => {
      if (phase === "unmount") return;
      node.toggleAttribute("data-diffs-collapsed", collapsed.has(context?.item?.id));
    },
  };
}

const codeView = new CodeView(viewerOptions(), createWorkerPool());
codeView.setup(viewerRoot);
codeView.subscribeToScroll(() => syncActiveFromScroll());
viewerRoot.addEventListener("click", onViewerClick);

const sidebar = new DiffFileListView(
  fileListNode,
  (itemId) => setActiveItem(itemId),
  {
    onOpenEditor: (path) => void openInEditor(diffData().cwd, path),
    onReveal: (path) => void revealInFinder(diffData().cwd, path),
  },
);

function fileAdditions(fileDiff) {
  return fileDiff.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
}

function fileDeletions(fileDiff) {
  return fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
}

function itemFromFileDiff(fileDiff, index) {
  fileDiff.cacheKey =
    `${fileDiff.prevObjectId ?? ""}:${fileDiff.newObjectId ?? ""}:${fileDiff.name}:${fileDiff.hunks.length}`;
  return {
    id: `${index}:${fileDiff.name}`,
    fileDiff,
    meta: {
      path: fileDiff.name,
      oldPath: fileDiff.prevName && fileDiff.prevName !== fileDiff.name ? fileDiff.prevName : null,
      status: STATUS_FOR_TYPE[fileDiff.type] ?? "modified",
      additions: fileAdditions(fileDiff),
      deletions: fileDeletions(fileDiff),
    },
  };
}

function parseItems(patch) {
  const parsed = parsePatchFiles(patch);
  const result = [];
  for (const commit of parsed) {
    for (const fileDiff of commit.files) {
      result.push(itemFromFileDiff(fileDiff, result.length));
    }
  }
  return result;
}

function warmHighlighter() {
  const langs = new Set();
  for (const item of items) {
    const lang = getFiletypeFromFileName(item.meta.path);
    if (lang && lang !== "text") langs.add(lang);
  }
  if (langs.size) void preloadHighlighter({ themes: [MUXY_DIFF_THEME], langs: [...langs] });
}

function summarize() {
  return items.reduce(
    (stats, item) => {
      stats.additions += item.meta.additions;
      stats.deletions += item.meta.deletions;
      return stats;
    },
    { files: items.length, additions: 0, deletions: 0 },
  );
}

function renderStats() {
  const stats = summarize();
  fileCountNode.textContent = String(stats.files);
  statFilesNode.textContent = String(stats.files);
  statAdditionsNode.textContent = `+${stats.additions}`;
  statDeletionsNode.textContent = `-${stats.deletions}`;
  summaryNode.replaceChildren(
    h("span", { class: "file-pill" }, `${stats.files} ${stats.files === 1 ? "file" : "files"}`),
    h("span", { class: "added" }, `+${stats.additions}`),
    h("span", { class: "deleted" }, `-${stats.deletions}`),
  );
}

function renderFileList(focusId) {
  sidebar.setFiles(
    items.map((item) => ({ path: item.meta.path, itemId: item.id, status: item.meta.status })),
  );
  setActiveItem(focusId || items[0]?.id || "", false);
}

function syncCodeViewItems() {
  codeView.setItems(
    items.map((item) => {
      const isCollapsed = collapsed.has(item.id);
      const previous = versions.get(item.id);
      const revision = previous && previous.collapsed === isCollapsed ? previous : { collapsed: isCollapsed, revision: (previous?.revision ?? 0) + 1 };
      versions.set(item.id, revision);
      return {
        id: item.id,
        type: "diff",
        fileDiff: item.fileDiff,
        collapsed: isCollapsed,
        version: revision.revision,
      };
    }),
  );
}

function findFocusId(focusPath) {
  if (!focusPath) return "";
  const matches = (name) =>
    name === focusPath || name.endsWith(`/${focusPath}`) || focusPath.endsWith(`/${name}`);
  return items.find((item) => matches(item.meta.path) || (item.meta.oldPath ? matches(item.meta.oldPath) : false))?.id ?? "";
}

function renderPatch(patch, focusPath) {
  const trimmed = patch.trim();
  if (!trimmed) {
    clearDiff("No changes");
    return;
  }
  items = parseItems(trimmed);
  const ids = new Set(items.map((item) => item.id));
  collapsed = new Set([...collapsed].filter((id) => ids.has(id)));
  versions = new Map([...versions].filter(([id]) => ids.has(id)));
  if (!items.length) {
    clearDiff("No changes");
    return;
  }
  const focusId = findFocusId(focusPath);
  syncCodeViewItems();
  warmHighlighter();
  hideLoading();
  emptyState.classList.add("hidden");
  renderFileList(focusId);
  renderStats();
  if (focusId) setActiveItem(focusId);
}

function setActiveItem(itemId, shouldScroll = true) {
  activeItemId = itemId;
  sidebar.setActive(itemId);
  if (!shouldScroll || !itemId) return;
  if (collapsed.has(itemId)) {
    collapsed.delete(itemId);
    syncCodeViewItems();
  }
  suppressScrollSync = true;
  codeView.scrollTo({ type: "item", id: itemId, align: "start", behavior: "instant" });
  requestAnimationFrame(() => {
    suppressScrollSync = false;
  });
}

function syncActiveFromScroll() {
  if (suppressScrollSync || syncFrame) return;
  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0;
    const scrollTop = codeView.getScrollTop();
    let best = "";
    let bestTop = -Infinity;
    for (const entry of codeView.getRenderedItems()) {
      const top = codeView.getTopForItem(entry.id);
      if (top === undefined || top > scrollTop + 4 || top <= bestTop) continue;
      bestTop = top;
      best = entry.id;
    }
    if (best && best !== activeItemId) {
      activeItemId = best;
      sidebar.setActive(best);
    }
  });
}

function onViewerClick(event) {
  const path = event.composedPath();
  const header = path.find((node) => node instanceof HTMLElement && node.hasAttribute("data-diffs-header"));
  if (!header) return;
  const container = path.find((node) => node instanceof HTMLElement && node.tagName.toLowerCase() === "diffs-container");
  if (!container) return;
  const rendered = codeView.getRenderedItems().find((entry) => entry.element === container);
  if (rendered) toggleItemCollapsed(rendered.id);
}

function toggleItemCollapsed(itemId) {
  if (collapsed.has(itemId)) collapsed.delete(itemId);
  else collapsed.add(itemId);
  syncCodeViewItems();
}

function setAllCollapsed(value) {
  collapsed = value ? new Set(items.map((item) => item.id)) : new Set();
  syncCodeViewItems();
}

function showLoading(label) {
  loadingLabel.textContent = label;
  loadingState.classList.remove("hidden");
  emptyState.classList.add("hidden");
}

function hideLoading() {
  loadingState.classList.add("hidden");
}

function clearDiff(message) {
  hideLoading();
  items = [];
  collapsed.clear();
  activeItemId = "";
  codeView.setItems([]);
  sidebar.clear();
  emptyState.classList.remove("hidden");
  fileCountNode.textContent = "0";
  statFilesNode.textContent = "0";
  statAdditionsNode.textContent = "+0";
  statDeletionsNode.textContent = "-0";
  summaryNode.textContent = message;
}

function diffData() {
  return window.muxy?.data ?? {};
}

async function loadGitDiff() {
  if (!window.muxy?.exec) {
    clearDiff("Muxy unavailable");
    return;
  }
  const data = diffData();
  const cwd = data.cwd;
  summaryNode.textContent = "Loading diff...";
  try {
    if (data.source === "pr" && data.prNumber) {
      sourceLabelNode.textContent = `PR #${data.prNumber}`;
      showLoading(`Loading diff for PR #${data.prNumber}...`);
      const { diff } = await cmd.prDiff(cwd, data.prNumber);
      renderPatch(diff, data.focusPath ?? "");
      return;
    }
    if (data.source === "commit" && data.hash) {
      const label = data.shortHash || data.hash.slice(0, 7);
      sourceLabelNode.textContent = `Commit ${label}`;
      showLoading(`Loading diff for ${label}...`);
      const res = await window.muxy.exec(["git", "show", "--format=", "--no-color", data.hash], { cwd });
      if (res.exitCode !== 0) {
        clearDiff(res.stderr.trim() || "Could not load commit diff.");
        return;
      }
      renderPatch(res.stdout, data.focusPath ?? "");
      return;
    }
    if (data.source === "incoming") {
      const ref = data.ref || "@{upstream}";
      sourceLabelNode.textContent = "Incoming changes";
      showLoading("Loading incoming changes...");
      const res = await window.muxy.exec(["git", "diff", "--no-color", `HEAD...${ref}`], { cwd });
      if (res.exitCode !== 0) {
        clearDiff(res.stderr.trim() || "Could not load incoming changes.");
        return;
      }
      renderPatch(res.stdout, data.focusPath ?? "");
      return;
    }
    sourceLabelNode.textContent = "Working Tree";
    showLoading("Loading changes...");
    const [staged, unstaged] = await Promise.all([
      cmd.diff(cwd, { staged: true }),
      cmd.diff(cwd, { staged: false }),
    ]);
    renderPatch([staged.diff, unstaged.diff].filter((diff) => diff.trim()).join("\n"), data.focusPath ?? "");
  } catch (error) {
    clearDiff(error instanceof Error ? error.message : String(error));
  }
}

function applyRailWidth(width) {
  const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)));
  document.documentElement.style.setProperty("--rail-width", `${clamped}px`);
  return clamped;
}

function applyZoom() {
  document.documentElement.style.setProperty("--diff-zoom", String(zoom));
  zoomLevelNode.textContent = `${Math.round(zoom * 100)}%`;
  zoomOutButton.disabled = zoom <= ZOOM_MIN + 1e-6;
  zoomInButton.disabled = zoom >= ZOOM_MAX - 1e-6;
}

function setZoom(next) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
  writePref("muxy.git.diff.zoom", String(zoom));
  applyZoom();
  codeView.setOptions(viewerOptions());
}

function syncStyleButton() {
  toggleStyleButton.classList.toggle("active", diffStyle === "split");
  toggleStyleButton.title = diffStyle === "split" ? "Switch to unified view" : "Switch to split view";
}

function syncTreeButton() {
  const tree = sidebar.isTree();
  toggleTreeButton.classList.toggle("active", tree);
  toggleTreeButton.title = tree ? "List view" : "Tree view";
}

function toggleTree() {
  sidebar.toggleView();
  syncTreeButton();
}

function toggleStyle() {
  diffStyle = diffStyle === "split" ? "unified" : "split";
  writePref("muxy.git.diff.style", diffStyle);
  syncStyleButton();
  codeView.setOptions(viewerOptions());
}

function applyWrap() {
  toggleWrapButton.classList.toggle("active", wrapLines);
  toggleWrapButton.title = wrapLines ? "Disable line wrap" : "Enable line wrap";
}

function toggleWrap() {
  wrapLines = !wrapLines;
  writePref("muxy.git.diff.wrap", String(wrapLines));
  applyWrap();
  codeView.setOptions(viewerOptions());
}

applyRailWidth(Number(readPref("muxy.git.diff.rail", "260")) || 260);
railResize.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  railResize.setPointerCapture(event.pointerId);
  railResize.classList.add("dragging");
  document.body.classList.add("resizing");
  const startX = event.clientX;
  const startWidth = railResize.parentElement.getBoundingClientRect().width;
  const onMove = (move) => {
    applyRailWidth(startWidth + (move.clientX - startX));
  };
  const onUp = () => {
    railResize.classList.remove("dragging");
    document.body.classList.remove("resizing");
    railResize.releasePointerCapture(event.pointerId);
    railResize.removeEventListener("pointermove", onMove);
    railResize.removeEventListener("pointerup", onUp);
    const width = railResize.parentElement.getBoundingClientRect().width;
    writePref("muxy.git.diff.rail", String(Math.round(width)));
  };
  railResize.addEventListener("pointermove", onMove);
  railResize.addEventListener("pointerup", onUp);
});

zoomInButton.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
zoomOutButton.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
zoomResetButton.addEventListener("click", () => setZoom(1));
toggleStyleButton.addEventListener("click", toggleStyle);
toggleWrapButton.addEventListener("click", toggleWrap);
collapseAllButton.addEventListener("click", () => setAllCollapsed(true));
expandAllButton.addEventListener("click", () => setAllCollapsed(false));
toggleTreeButton.addEventListener("click", toggleTree);
reloadButton.addEventListener("click", () => void loadGitDiff());

window.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key === "=" || event.key === "+") {
    event.preventDefault();
    setZoom(zoom + ZOOM_STEP);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    setZoom(zoom - ZOOM_STEP);
  } else if (event.key === "0") {
    event.preventDefault();
    setZoom(1);
  }
});

window.muxy?.onThemeChange?.(() => codeView.onThemeChange());
window.muxy?.onDataChange?.(() => void loadGitDiff());
applyZoom();
applyWrap();
syncStyleButton();
syncTreeButton();
void loadGitDiff();
