import {
  CodeView,
  parsePatchFiles,
  registerCustomCSSVariableTheme,
  type CodeViewDiffItem,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import "./diff-viewer.css";

const viewerRoot = document.querySelector<HTMLElement>("#viewer")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
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

  const workerUrl = new URL("../dist/diffs-worker.js", document.baseURI);
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

const viewer = new CodeView(
  {
    diffStyle: "split",
    diffIndicators: "classic",
    hunkSeparators: "metadata",
    lineDiffType: "word",
    maxLineDiffLength: 900,
    tokenizeMaxLineLength: 800,
    tokenizeMaxLength: 450000,
    overflow: "wrap",
    stickyHeaders: true,
    pointerEventsOnScroll: true,
    theme: { dark: "muxy-diff", light: "muxy-diff" },
    themeType: resolveThemeType(),
    itemMetrics: { lineHeight: 20, diffHeaderHeight: 44, spacing: 8 },
    layout: { paddingTop: 10, paddingBottom: 16, gap: 8 },
  },
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

function statusForFile(file: FileDiff): string {
  if (file.type === "new") return "A";
  if (file.type === "deleted") return "D";
  if (file.type.startsWith("rename")) return "R";
  return "M";
}

function statusClass(letter: string): string {
  if (letter === "A" || letter === "U") return "s-add";
  if (letter === "D") return "s-del";
  return "s-mod";
}

const DOC_ICON = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>`;

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

function currentViewerOptions() {
  return {
    theme: { dark: "muxy-diff", light: "muxy-diff" },
    themeType: resolveThemeType(),
    diffStyle: "split" as const,
    overflow: largeDiffMode ? ("scroll" as const) : ("wrap" as const),
    stickyHeaders: !largeDiffMode,
    lineDiffType: largeDiffMode ? ("none" as const) : ("word" as const),
    maxLineDiffLength: largeDiffMode ? 120 : 900,
    tokenizeMaxLineLength: largeDiffMode ? 300 : 800,
    tokenizeMaxLength: largeDiffMode ? 120000 : 450000,
  };
}

async function applyViewerOptions() {
  const options = currentViewerOptions();
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

function setActiveItem(itemId: string, shouldScroll = true) {
  for (const row of fileListNode.querySelectorAll<HTMLElement>(".file-row")) {
    row.classList.toggle("active", row.dataset.itemId === itemId);
  }

  if (shouldScroll && itemId) {
    viewer.scrollTo({ type: "item", id: itemId, align: "start", offset: 8, behavior: "smooth-auto" });
  }
}

function escapeHTML(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFileList(files: FileDiff[], items: DiffItem[], focusId: string) {
  fileListNode.replaceChildren();
  const fragment = document.createDocumentFragment();

  files.forEach((file, index) => {
    const stats = fileStats(file);
    const item = items[index];
    const letter = statusForFile(file);
    const cls = statusClass(letter);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "file-row";
    row.dataset.itemId = item.id;
    row.innerHTML = `
      <span class="status ${cls}">${letter}</span>
      <span class="doc ${cls}">${DOC_ICON}</span>
      <span class="name" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</span>
      <span class="delta added">+${stats.additions}</span>
      <span class="delta deleted">-${stats.deletions}</span>
    `;
    fragment.append(row);
  });

  fileListNode.append(fragment);
  setActiveItem(focusId || items[0]?.id || "", false);
}

fileListNode.addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>(".file-row");
  if (!row?.dataset.itemId) return;
  setActiveItem(row.dataset.itemId);
});

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

function clearDiff(message: string) {
  currentItems = [];
  largeDiffMode = false;
  viewer.setItems([]);
  fileListNode.replaceChildren();
  emptyState.classList.remove("hidden");
  fileCountNode.textContent = "0";
  statFilesNode.textContent = "0";
  statAdditionsNode.textContent = "+0";
  statDeletionsNode.textContent = "-0";
  summaryNode.textContent = message;
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

  const focusIndex = focusPath ? files.findIndex((file) => file.name === focusPath) : -1;
  const focusId = focusIndex >= 0 ? currentItems[focusIndex].id : "";

  await applyViewerOptions();
  await setViewerItems(currentItems);
  emptyState.classList.add("hidden");
  renderFileList(files, currentItems, focusId);
  renderStats(summarize(files));

  if (focusId) {
    await nextFrame();
    setActiveItem(focusId, true);
  }
}

function diffData() {
  return (window.muxy?.data ?? {}) as { focusPath?: string };
}

async function loadGitDiff() {
  if (!window.muxy?.exec) {
    clearDiff("Muxy exec unavailable");
    return;
  }

  summaryNode.textContent = "Loading diff…";
  sourceLabelNode.textContent = "Working Tree";

  const base = ["git", "diff", "--no-ext-diff", "--no-color"];
  try {
    let result = await window.muxy.exec([...base, "HEAD"], { timeoutMs: 15000 });
    if (result.exitCode !== 0) {
      result = await window.muxy.exec(base, { timeoutMs: 15000 });
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `git diff exited with ${result.exitCode}`);
    }

    await renderPatch(result.stdout, diffData().focusPath ?? "");
  } catch (error) {
    clearDiff(error instanceof Error ? error.message : String(error));
  }
}

reloadButton.addEventListener("click", () => void loadGitDiff());

window.muxy?.onThemeChange?.(() => {
  viewer.setOptions({ themeType: resolveThemeType() });
  viewer.onThemeChange();
});

void loadGitDiff();
