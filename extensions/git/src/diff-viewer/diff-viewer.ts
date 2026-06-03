import {
  CodeView,
  parsePatchFiles,
  registerCustomCSSVariableTheme,
  type CodeViewDiffItem,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import { DiffFileListView, type DiffFile, type DiffFileStatus } from "./diff-file-list";
import "@/styles/global.css";
import "./diff-viewer.css";

const viewerRoot = document.querySelector<HTMLElement>("#viewer")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const loadingState = document.querySelector<HTMLElement>("#loading-state")!;
const loadingLabel = document.querySelector<HTMLElement>("#loading-label")!;
const fileListNode = document.querySelector<HTMLElement>("#file-list")!;
const sourceLabelNode = document.querySelector<HTMLElement>("#source-label")!;
const summaryNode = document.querySelector<HTMLElement>("#summary")!;
const fileCountNode = document.querySelector<HTMLElement>("#file-count")!;
const statFilesNode = document.querySelector<HTMLElement>("#stat-files")!;
const statAdditionsNode = document.querySelector<HTMLElement>("#stat-additions")!;
const statDeletionsNode = document.querySelector<HTMLElement>("#stat-deletions")!;
const reloadButton = document.querySelector<HTMLButtonElement>("#reload")!;

type FileDiff = FileDiffMetadata;
type DiffItem = CodeViewDiffItem;

let currentItems: DiffItem[] = [];
let version = 0;
let largeDiffMode = false;

const LARGE_DIFF_FILE_LIMIT = 80;
const LARGE_DIFF_LINE_LIMIT = 4500;
const LARGE_DIFF_BYTE_LIMIT = 1_500_000;
const LARGE_DIFF_ITEM_CHUNK_SIZE = 24;

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;
const SELECTED_FILE_TOP_OFFSET = 0;

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(`muxy.git.diff.${key}`) as T) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(`muxy.git.diff.${key}`, value);
  } catch {
    void 0;
  }
}

let diffStyle: "split" | "unified" = readPref<"split" | "unified">("style", "split");
let zoom = Number(readPref("zoom", "1")) || 1;

const THEME_COLORS = {
  foreground: "#d5d0c8",
  background: "#181716",
  "ansi-black": "#1f1d1b",
  "ansi-red": "#ff5f57",
  "ansi-green": "#9bbf72",
  "ansi-yellow": "#d9b26c",
  "ansi-blue": "#7aa2c7",
  "ansi-magenta": "#c895bf",
  "ansi-cyan": "#7ab8aa",
  "ansi-white": "#d5d0c8",
  "ansi-bright-black": "#807872",
  "ansi-bright-red": "#ff776f",
  "ansi-bright-green": "#b2d487",
  "ansi-bright-yellow": "#e8c47f",
  "ansi-bright-blue": "#8fb9dd",
  "ansi-bright-magenta": "#d8a8cf",
  "ansi-bright-cyan": "#91cfc1",
  "ansi-bright-white": "#f0ece6",
  "token-comment": "#807872",
  "token-constant": "#d9b26c",
  "token-deleted": "#ff5f57",
  "token-function": "#7ab8aa",
  "token-inserted": "#9bbf72",
  "token-keyword": "#df805c",
  "token-link": "#7aa2c7",
  "token-parameter": "#c895bf",
  "token-punctuation": "#a8a09a",
  "token-string": "#9bbf72",
  "token-string-expression": "#b2d487",
  "token-changed": "#d9b26c",
};

registerCustomCSSVariableTheme("muxy-diff", THEME_COLORS, false);

function resolveThemeType(): "light" | "dark" {
  return window.muxy?.theme?.colorScheme === "light" ? "light" : "dark";
}

function createWorkerPool() {
  if (typeof Worker === "undefined") return undefined;

  const workerUrl = new URL("../diffs-worker.js", document.baseURI);
  const hardwareConcurrency = navigator.hardwareConcurrency || 4;
  const poolSize = Math.max(2, Math.min(4, Math.floor(hardwareConcurrency / 2)));

  try {
    return getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: () => new Worker(workerUrl),
        poolSize,
        totalASTLRUCacheSize: 60,
      },
      highlighterOptions: {
        theme: { dark: "muxy-diff", light: "muxy-diff" },
        useTokenTransformer: false,
        lineDiffType: "word",
        maxLineDiffLength: 900,
        tokenizeMaxLineLength: 800,
        preferredHighlighter: "shiki-js",
      },
    });
  } catch (error) {
    console.warn("Diff worker pool unavailable; falling back to main thread.", error);
    return undefined;
  }
}

const workerPool = createWorkerPool();
void workerPool?.initialize().catch((error) => {
  console.warn("Diff worker pool failed to initialize.", error);
});

const CHEVRON_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

const HEADER_CSS = [
  `[data-diffs-header]{cursor:pointer;box-sizing:border-box;height:36px;padding:0 12px;border-bottom:1px solid var(--diffs-bg-separator);font-size:13px;line-height:36px;}`,
  `[data-diffs-header]:hover{background:var(--diffs-bg-buffer);}`,
  `[data-diffs-header] [data-title]{cursor:pointer;}`,
].join("");

function headerPrefix(file: { name: string; prevName?: string }): HTMLElement {
  const item = currentItems.find(
    (i) => i.fileDiff.name === file.name && i.fileDiff.prevName === file.prevName,
  );
  const span = document.createElement("span");
  span.className = "file-chevron";
  span.dataset.collapsed = item?.collapsed ? "true" : "false";
  span.innerHTML = CHEVRON_SVG;
  return span;
}

function viewerOptions() {
  return {
    diffStyle,
    diffIndicators: "classic" as const,
    hunkSeparators: "metadata" as const,
    lineDiffType: largeDiffMode ? ("none" as const) : ("word" as const),
    maxLineDiffLength: largeDiffMode ? 120 : 900,
    tokenizeMaxLineLength: largeDiffMode ? 300 : 800,
    tokenizeMaxLength: largeDiffMode ? 120000 : 450000,
    overflow: largeDiffMode ? ("scroll" as const) : ("wrap" as const),
    stickyHeaders: false,
    pointerEventsOnScroll: true,
    theme: { dark: "muxy-diff", light: "muxy-diff" },
    themeType: resolveThemeType(),
    itemMetrics: { lineHeight: Math.round(20 * zoom), diffHeaderHeight: 36, spacing: 8, paddingBottom: 0 },
    layout: { paddingTop: 0, paddingBottom: 16, gap: 0 },
    renderHeaderPrefix: headerPrefix as never,
    unsafeCSS: HEADER_CSS,
  };
}

const viewer = new CodeView(
  viewerOptions(),
  workerPool,
);

viewer.setup(viewerRoot);

function fileStats(file: FileDiff) {
  return file.hunks.reduce(
    (stats, hunk) => {
      stats.additions += hunk.additionLines;
      stats.deletions += hunk.deletionLines;
      return stats;
    },
    { additions: 0, deletions: 0 },
  );
}

function summarize(files: FileDiff[]) {
  return files.reduce(
    (stats, file) => {
      const delta = fileStats(file);
      stats.additions += delta.additions;
      stats.deletions += delta.deletions;
      return stats;
    },
    { files: files.length, additions: 0, deletions: 0 },
  );
}

function gitStatusForFile(file: FileDiff): DiffFileStatus {
  if (file.type === "new") return "added";
  if (file.type === "deleted") return "deleted";
  if (file.type.startsWith("rename")) return "renamed";
  return "modified";
}

function renderStats(stats: { files: number; additions: number; deletions: number }) {
  fileCountNode.textContent = String(stats.files);
  statFilesNode.textContent = String(stats.files);
  statAdditionsNode.textContent = `+${stats.additions}`;
  statDeletionsNode.textContent = `-${stats.deletions}`;
  const modeLabel = largeDiffMode ? " · optimized" : "";
  summaryNode.innerHTML = `<span class="file-pill">${stats.files} ${stats.files === 1 ? "file" : "files"}${modeLabel}</span> <span class="added">+${stats.additions}</span> <span class="deleted">-${stats.deletions}</span>`;
}

function parsePatch(patch: string): FileDiff[] {
  const parsed = parsePatchFiles(patch, `muxy-${version}`, true);
  return parsed.flatMap((group) => group.files);
}

function getRenderedLineCount(files: FileDiff[]) {
  return files.reduce(
    (total, file) => total + Math.max(file.splitLineCount || 0, file.unifiedLineCount || 0),
    0,
  );
}

function shouldUseLargeDiffMode(files: FileDiff[], patch: string) {
  return (
    patch.length > LARGE_DIFF_BYTE_LIMIT ||
    files.length > LARGE_DIFF_FILE_LIMIT ||
    getRenderedLineCount(files) > LARGE_DIFF_LINE_LIMIT
  );
}

async function applyViewerOptions() {
  const options = viewerOptions();
  viewer.setOptions(options);

  try {
    await workerPool?.setRenderOptions({
      theme: options.theme,
      useTokenTransformer: false,
      lineDiffType: options.lineDiffType,
      maxLineDiffLength: options.maxLineDiffLength,
      tokenizeMaxLineLength: options.tokenizeMaxLineLength,
    });
  } catch (error) {
    console.warn("Diff worker pool rejected render options.", error);
  }

  viewer.render(true);
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function itemOffsetFromTop(itemId: string): number | undefined {
  const rendered = viewer.getRenderedItems().find((item) => item.id === itemId);
  if (!rendered) return undefined;
  return rendered.element.getBoundingClientRect().top - viewerRoot.getBoundingClientRect().top;
}

async function scrollToItemWhenSettled(itemId: string) {
  suppressScrollSync = true;
  try {
    let alignedFrames = 0;
    for (let attempt = 0; attempt < 60 && alignedFrames < 3; attempt += 1) {
      viewer.scrollTo({ type: "item", id: itemId, align: "start", offset: SELECTED_FILE_TOP_OFFSET, behavior: "instant" });
      await nextFrame();
      const offset = itemOffsetFromTop(itemId);
      const aligned = offset !== undefined && Math.abs(offset - SELECTED_FILE_TOP_OFFSET) <= 2;
      alignedFrames = aligned ? alignedFrames + 1 : 0;
    }
  } finally {
    suppressScrollSync = false;
  }
}

async function waitForItemAtTop(itemId: string) {
  let alignedFrames = 0;
  for (let attempt = 0; attempt < 90 && alignedFrames < 3; attempt += 1) {
    await nextFrame();
    const offset = itemOffsetFromTop(itemId);
    const aligned = offset !== undefined && Math.abs(offset - SELECTED_FILE_TOP_OFFSET) <= 4;
    alignedFrames = aligned ? alignedFrames + 1 : 0;
  }
}

let activeItemId = "";
let suppressScrollSync = false;

const sidebar = new DiffFileListView(fileListNode, (itemId) => {
  suppressScrollSync = true;
  setActiveItem(itemId);
  void waitForItemAtTop(itemId).then(() => {
    suppressScrollSync = false;
  });
});

function setActiveItem(itemId: string, shouldScroll = true) {
  activeItemId = itemId;
  sidebar.setActive(itemId);

  if (shouldScroll && itemId) {
    viewer.scrollTo({ type: "item", id: itemId, align: "start", offset: SELECTED_FILE_TOP_OFFSET, behavior: "smooth-auto" });
  }
}

function topVisibleItemId(): string {
  const viewportTop = viewerRoot.getBoundingClientRect().top;
  let bestId = "";
  let bestTop = -Infinity;
  for (const item of viewer.getRenderedItems()) {
    const top = item.element.getBoundingClientRect().top - viewportTop;
    if (top <= SELECTED_FILE_TOP_OFFSET + 4 && top > bestTop) {
      bestTop = top;
      bestId = item.id;
    }
  }
  return bestId;
}

viewer.subscribeToScroll(() => {
  if (suppressScrollSync) return;
  const id = topVisibleItemId();
  if (id && id !== activeItemId) setActiveItem(id, false);
});

function renderFileList(files: FileDiff[], items: DiffItem[], focusId: string) {
  const listFiles: DiffFile[] = files.map((file, index) => ({
    path: file.name,
    itemId: items[index].id,
    status: gitStatusForFile(file),
  }));
  sidebar.setFiles(listFiles);
  setActiveItem(focusId || items[0]?.id || "", false);
}

async function setViewerItems(items: DiffItem[]) {
  if (!largeDiffMode) {
    viewer.setItems(items);
    return;
  }

  viewer.setItems([]);
  await nextFrame();

  for (let index = 0; index < items.length; index += LARGE_DIFF_ITEM_CHUNK_SIZE) {
    viewer.addItems(items.slice(index, index + LARGE_DIFF_ITEM_CHUNK_SIZE));
    await nextFrame();
  }
}

function showLoading(label: string) {
  loadingLabel.textContent = label;
  loadingState.classList.remove("hidden");
  emptyState.classList.add("hidden");
}

function hideLoading() {
  loadingState.classList.add("hidden");
}

function clearDiff(message: string) {
  hideLoading();
  currentItems = [];
  largeDiffMode = false;
  viewer.setItems([]);
  sidebar.clear();
  emptyState.classList.remove("hidden");
  fileCountNode.textContent = "0";
  statFilesNode.textContent = "0";
  statAdditionsNode.textContent = "+0";
  statDeletionsNode.textContent = "-0";
  summaryNode.textContent = message;
}

function findFocusIndex(files: FileDiff[], focusPath: string): number {
  const matches = (name: string) =>
    name === focusPath || name.endsWith(`/${focusPath}`) || focusPath.endsWith(`/${name}`);
  const exact = files.findIndex((file) => file.name === focusPath);
  if (exact >= 0) return exact;
  return files.findIndex((file) => matches(file.name));
}

async function renderPatch(patch: string, focusPath: string) {
  const trimmed = patch.trim();
  if (!trimmed) {
    clearDiff("No changes");
    return;
  }

  const files = parsePatch(trimmed);
  if (!files.length) {
    clearDiff("No changes");
    return;
  }

  version += 1;
  largeDiffMode = shouldUseLargeDiffMode(files, trimmed);
  currentItems = files.map((fileDiff, index) => ({
    id: `${index}:${fileDiff.prevName || fileDiff.name}`,
    type: "diff",
    fileDiff,
    version,
  }));

  const focusIndex = focusPath ? findFocusIndex(files, focusPath) : -1;
  const focusId = focusIndex >= 0 ? currentItems[focusIndex].id : "";

  await applyViewerOptions();
  await setViewerItems(currentItems);
  hideLoading();
  emptyState.classList.add("hidden");
  renderFileList(files, currentItems, focusId);
  renderStats(summarize(files));

  if (focusId) {
    await scrollToItemWhenSettled(focusId);
    setActiveItem(focusId, false);
  }
}

function diffData() {
  return (window.muxy?.data ?? {}) as {
    focusPath?: string;
    source?: "pr";
    prNumber?: number;
    cwd?: string;
  };
}

async function loadGitDiff() {
  if (!window.muxy?.exec) {
    clearDiff("Muxy exec unavailable");
    return;
  }

  const data = diffData();
  summaryNode.textContent = "Loading diff…";

  try {
    if (data.source === "pr" && data.prNumber) {
      sourceLabelNode.textContent = `PR #${data.prNumber}`;
      showLoading(`Loading diff for PR #${data.prNumber}…`);
      const result = await window.muxy.exec(
        ["gh", "pr", "diff", String(data.prNumber), "--color", "never"],
        { timeoutMs: 30000, cwd: data.cwd },
      );
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        const reason = (result.stderr || "").trim().split("\n")[0];
        clearDiff(reason || `gh pr diff exited with ${result.exitCode}`);
        return;
      }
      await renderPatch(result.stdout, data.focusPath ?? "");
      return;
    }

    sourceLabelNode.textContent = "Working Tree";
    showLoading("Loading changes…");
    const base = ["git", "diff", "--no-ext-diff", "--no-color"];
    let result = await window.muxy.exec([...base, "HEAD"], { timeoutMs: 15000, cwd: data.cwd });
    if (result.exitCode !== 0) {
      result = await window.muxy.exec(base, { timeoutMs: 15000, cwd: data.cwd });
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `git diff exited with ${result.exitCode}`);
    }

    await renderPatch(result.stdout, data.focusPath ?? "");
  } catch (error) {
    clearDiff(error instanceof Error ? error.message : String(error));
  }
}

const zoomInButton = document.querySelector<HTMLButtonElement>("#zoom-in")!;
const zoomOutButton = document.querySelector<HTMLButtonElement>("#zoom-out")!;
const zoomResetButton = document.querySelector<HTMLButtonElement>("#zoom-reset")!;
const zoomLevelNode = document.querySelector<HTMLElement>("#zoom-reset")!;
const toggleStyleButton = document.querySelector<HTMLButtonElement>("#toggle-style")!;
const collapseAllButton = document.querySelector<HTMLButtonElement>("#collapse-all")!;
const expandAllButton = document.querySelector<HTMLButtonElement>("#expand-all")!;
const railResize = document.querySelector<HTMLElement>("#rail-resize")!;

const RAIL_MIN = 180;
const RAIL_MAX = 520;

function applyRailWidth(width: number) {
  const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)));
  document.documentElement.style.setProperty("--rail-width", `${clamped}px`);
  return clamped;
}

applyRailWidth(Number(readPref("rail", "260")) || 260);

railResize.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  railResize.setPointerCapture(event.pointerId);
  railResize.classList.add("dragging");
  document.body.classList.add("resizing");
  const startX = event.clientX;
  const startWidth = railResize.parentElement!.getBoundingClientRect().width;

  const onMove = (move: PointerEvent) => {
    applyRailWidth(startWidth + (move.clientX - startX));
  };
  const onUp = () => {
    railResize.classList.remove("dragging");
    document.body.classList.remove("resizing");
    railResize.releasePointerCapture(event.pointerId);
    railResize.removeEventListener("pointermove", onMove);
    railResize.removeEventListener("pointerup", onUp);
    const width = railResize.parentElement!.getBoundingClientRect().width;
    writePref("rail", String(Math.round(width)));
  };
  railResize.addEventListener("pointermove", onMove);
  railResize.addEventListener("pointerup", onUp);
});

function applyZoom() {
  document.documentElement.style.setProperty("--diff-zoom", String(zoom));
  zoomLevelNode.textContent = `${Math.round(zoom * 100)}%`;
  zoomOutButton.disabled = zoom <= ZOOM_MIN + 1e-6;
  zoomInButton.disabled = zoom >= ZOOM_MAX - 1e-6;
}

function setZoom(next: number) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
  writePref("zoom", String(zoom));
  applyZoom();
  if (currentItems.length) void applyViewerOptions();
}

function syncStyleButton() {
  toggleStyleButton.classList.toggle("active", diffStyle === "split");
  toggleStyleButton.title = diffStyle === "split" ? "Switch to unified view" : "Switch to split view";
}

function toggleStyle() {
  diffStyle = diffStyle === "split" ? "unified" : "split";
  writePref("style", diffStyle);
  syncStyleButton();
  if (currentItems.length) void applyViewerOptions();
}

function setAllCollapsed(collapsed: boolean) {
  if (!currentItems.length) return;
  version += 1;
  currentItems = currentItems.map((item) => ({ ...item, collapsed, version }));
  viewer.setItems(currentItems);
}

function toggleItemCollapsed(itemId: string) {
  const index = currentItems.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  version += 1;
  const next = {
    ...currentItems[index],
    collapsed: !currentItems[index].collapsed,
    version,
  };
  currentItems[index] = next;
  viewer.updateItem(next);
  setActiveItem(itemId, false);
}

viewerRoot.addEventListener("click", (event) => {
  const header = event
    .composedPath()
    .find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
    );
  if (!header) return;
  const title = header.querySelector<HTMLElement>("[data-title]")?.textContent?.trim();
  if (!title) return;
  const item = currentItems.find((i) => i.fileDiff.name === title || i.fileDiff.prevName === title);
  if (item) toggleItemCollapsed(item.id);
});

zoomInButton.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
zoomOutButton.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
zoomResetButton.addEventListener("click", () => setZoom(1));
toggleStyleButton.addEventListener("click", toggleStyle);
collapseAllButton.addEventListener("click", () => setAllCollapsed(true));
expandAllButton.addEventListener("click", () => setAllCollapsed(false));

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

reloadButton.addEventListener("click", () => void loadGitDiff());

window.muxy?.onThemeChange?.(() => {
  viewer.setOptions(viewerOptions());
  viewer.onThemeChange();
});

window.muxy?.onDataChange?.(() => void loadGitDiff());

applyZoom();
syncStyleButton();
void loadGitDiff();
