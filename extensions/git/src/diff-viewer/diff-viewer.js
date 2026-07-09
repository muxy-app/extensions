import { h, readPref, writePref } from "@/lib/dom";
import * as cmd from "@/lib/cmd";
import { highlight, language_for } from "@/lib/highlight";
import { DiffFileListView } from "./diff-file-list";
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
const FILE_HEADER_HEIGHT = 34;
const FILE_BORDER_HEIGHT = 1;
const ROW_HEIGHT = 19;
const META_ROW_HEIGHT = 24;
const VIEWER_PADDING_BOTTOM = 16;
const ROW_VIRTUAL_THRESHOLD = 300;
const IS_WEBKIT = /AppleWebKit/.test(navigator.userAgent) &&
    !/(Chrome|Chromium|CriOS|Edg|Firefox|FxiOS)/.test(navigator.userAgent);
const FILE_VIRTUAL_OVERSCAN = IS_WEBKIT ? 2400 : 2000;
const FILE_REUSE_MARGIN = IS_WEBKIT ? 800 : 600;
const ROW_VIRTUAL_OVERSCAN = IS_WEBKIT ? 2800 : 2400;
const ROW_REUSE_MARGIN = IS_WEBKIT ? 900 : 800;
let files = [];
let activeItemId = "";
let diffStyle = readPref("muxy.git.diff.style", "split");
let wrapLines = readPref("muxy.git.diff.wrap", "true") !== "false";
let zoom = Number(readPref("muxy.git.diff.zoom", "1")) || 1;
let collapsed = new Set();
let suppressScrollSync = false;
let scrollFrame = 0;
let renderFrame = 0;
let measureFrame = 0;
let contentNode = null;
let topSpacer = null;
let bottomSpacer = null;
let renderedSections = new Map();
let layout = [];
let renderedRange = { start: -1, end: -1 };
let totalHeight = 0;
let lastViewTop = 0;
let lastViewerWidth = 0;
const charWidths = new Map();
const measureContext = document.createElement("canvas").getContext("2d");
document.documentElement.classList.toggle("webkit-host", IS_WEBKIT);
const sidebar = new DiffFileListView(fileListNode, (itemId) => {
    setActiveItem(itemId);
}, {
    onOpenEditor: (path) => void openInEditor(diffData().cwd, path),
    onReveal: (path) => void revealInFinder(diffData().cwd, path),
});
function cleanPath(path) {
    const text = path.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"');
    if (text === "/dev/null")
        return text;
    return text.replace(/^[ab]\//, "");
}
function parseHeaderPath(line) {
    const body = line.slice("diff --git ".length);
    if (body.startsWith("a/")) {
        const index = body.lastIndexOf(" b/");
        if (index > 0)
            return { oldPath: cleanPath(body.slice(0, index)), path: cleanPath(body.slice(index + 1)) };
    }
    const tokens = splitHeaderTokens(body);
    return { oldPath: cleanPath(tokens[0] ?? "unknown"), path: cleanPath(tokens[1] ?? tokens[0] ?? "unknown") };
}
function splitHeaderTokens(text) {
    const tokens = [];
    let token = "";
    let quoted = false;
    let escaped = false;
    for (const char of text) {
        if (escaped) {
            token += char;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            token += char;
            continue;
        }
        if (char === '"') {
            quoted = !quoted;
            token += char;
            continue;
        }
        if (char === " " && !quoted) {
            if (token)
                tokens.push(token);
            token = "";
            continue;
        }
        token += char;
    }
    if (token)
        tokens.push(token);
    return tokens;
}
function parsePatch(patch) {
    const result = [];
    const lines = patch.replace(/\r\n/g, "\n").split("\n");
    let current = null;
    let oldLine = 0;
    let newLine = 0;
    const push = (row) => {
        if (!current)
            return;
        current.rows.push(row);
        if ((row.kind === "context" || row.kind === "addition" || row.kind === "deletion") && row.text.length > current.maxLen)
            current.maxLen = row.text.length;
    };
    for (const raw of lines) {
        if (raw.startsWith("diff --git ")) {
            const paths = parseHeaderPath(raw);
            current = {
                id: `${result.length}:${paths.path}`,
                path: paths.path,
                oldPath: paths.oldPath === paths.path ? null : paths.oldPath,
                status: "modified",
                additions: 0,
                deletions: 0,
                rows: [],
                maxLen: 0,
            };
            result.push(current);
            oldLine = 0;
            newLine = 0;
            continue;
        }
        if (!current)
            continue;
        if (raw.startsWith("new file mode")) {
            current.status = "added";
            continue;
        }
        if (raw.startsWith("deleted file mode")) {
            current.status = "deleted";
            continue;
        }
        if (raw.startsWith("rename from ")) {
            current.status = "renamed";
            current.oldPath = cleanPath(raw.slice("rename from ".length));
            continue;
        }
        if (raw.startsWith("rename to ")) {
            current.status = "renamed";
            current.path = cleanPath(raw.slice("rename to ".length));
            current.id = `${result.length - 1}:${current.path}`;
            continue;
        }
        if (raw.startsWith("--- ")) {
            const path = cleanPath(raw.slice(4));
            current.oldPath = path === "/dev/null" ? null : path;
            continue;
        }
        if (raw.startsWith("+++ ")) {
            const path = cleanPath(raw.slice(4));
            if (path !== "/dev/null")
                current.path = path;
            continue;
        }
        const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            push({ kind: "hunk", oldLineNumber: null, newLineNumber: null, text: raw });
            continue;
        }
        if (raw.startsWith("+")) {
            current.additions += 1;
            push({ kind: "addition", oldLineNumber: null, newLineNumber: newLine, text: raw.slice(1) });
            newLine += 1;
            continue;
        }
        if (raw.startsWith("-")) {
            current.deletions += 1;
            push({ kind: "deletion", oldLineNumber: oldLine, newLineNumber: null, text: raw.slice(1) });
            oldLine += 1;
            continue;
        }
        if (raw.startsWith(" ")) {
            push({ kind: "context", oldLineNumber: oldLine, newLineNumber: newLine, text: raw.slice(1) });
            oldLine += 1;
            newLine += 1;
            continue;
        }
        if (raw.startsWith("Binary files") || raw.startsWith("\\")) {
            push({ kind: "meta", oldLineNumber: null, newLineNumber: null, text: raw });
        }
    }
    return result.map((file, index) => ({ ...file, id: `${index}:${file.path}` }));
}
function summarize(nextFiles) {
    return nextFiles.reduce((stats, file) => {
        stats.additions += file.additions;
        stats.deletions += file.deletions;
        return stats;
    }, { files: nextFiles.length, additions: 0, deletions: 0 });
}
function renderStats(stats) {
    fileCountNode.textContent = String(stats.files);
    statFilesNode.textContent = String(stats.files);
    statAdditionsNode.textContent = `+${stats.additions}`;
    statDeletionsNode.textContent = `-${stats.deletions}`;
    summaryNode.replaceChildren(h("span", { class: "file-pill" }, `${stats.files} ${stats.files === 1 ? "file" : "files"}`), h("span", { class: "added" }, `+${stats.additions}`), h("span", { class: "deleted" }, `-${stats.deletions}`));
}
function renderFileList(focusId) {
    const listFiles = files.map((file) => ({
        path: file.path,
        itemId: file.id,
        status: file.status,
    }));
    sidebar.setFiles(listFiles);
    setActiveItem(focusId || files[0]?.id || "", false);
}
async function renderViewer() {
    viewerRoot.replaceChildren();
    contentNode = h("div", { class: `diff-content ${diffStyle}` });
    topSpacer = h("div", { class: "virtual-spacer" });
    bottomSpacer = h("div", { class: "virtual-spacer" });
    contentNode.append(topSpacer, bottomSpacer);
    viewerRoot.appendChild(contentNode);
    renderedSections = new Map();
    lastViewerWidth = viewerRoot.clientWidth;
    rebuildLayout();
    renderedRange = { start: -1, end: -1 };
    renderVisibleFiles(true);
    await nextFrame();
    measureRenderedFiles();
}
function renderFile(file, index, view) {
    const isCollapsed = collapsed.has(file.id);
    const body = isCollapsed ? null : h("div", { class: "diff-file-body", style: bodyStyle(file) });
    if (body)
        fillFileBody(body, file, index, view);
    return h("section", { class: "diff-file-section", "data-item-id": file.id, "data-file-index": String(index) }, h("button", {
        type: "button",
        class: "diff-file-header",
        "data-collapsed": isCollapsed ? "true" : "false",
        onclick: () => toggleItemCollapsed(file.id),
    }, h("span", { class: "file-chevron" }, chevronSvg()), h("span", { class: "diff-file-title", title: file.path }, file.path), file.oldPath ? h("span", { class: "diff-file-previous", title: file.oldPath }, file.oldPath) : null, h("span", { class: "diff-file-stat added" }, `+${file.additions}`), h("span", { class: "diff-file-stat deleted" }, `-${file.deletions}`)), body);
}
function rebuildLayout() {
    layout = files.map((file) => ({ id: file.id, top: 0, height: estimateFileHeight(file), bottom: 0 }));
    updateLayoutFrom(0);
}
function updateLayoutFrom(start) {
    let top = start > 0 ? layout[start - 1].bottom : 0;
    for (let index = start; index < layout.length; index += 1) {
        layout[index].top = top;
        layout[index].bottom = top + layout[index].height;
        top = layout[index].bottom;
    }
    totalHeight = top;
}
function estimateFileHeight(file) {
    let height = FILE_HEADER_HEIGHT + FILE_BORDER_HEIGHT;
    if (collapsed.has(file.id))
        return height;
    return height + rowLayoutForFile(file).total;
}
function estimateRowHeight(file, row) {
    if (row.kind === "hunk" || row.kind === "meta")
        return META_ROW_HEIGHT * zoom;
    if (!wrapLines)
        return ROW_HEIGHT * zoom;
    const cellWidth = estimateCodeCellWidth();
    if (diffStyle === "split") {
        const sideWidth = Math.max(80, (cellWidth - 112) / 2 - 20);
        const oldText = row.kind === "addition" ? "" : row.text;
        const newText = row.kind === "deletion" ? "" : row.text;
        return Math.max(wrappedLineCount(oldText, sideWidth), wrappedLineCount(newText, sideWidth)) * ROW_HEIGHT * zoom;
    }
    return wrappedLineCount(row.text, Math.max(80, cellWidth - 112 - 20)) * ROW_HEIGHT * zoom;
}
function estimateCodeCellWidth() {
    return Math.max(240, viewerRoot.clientWidth || 800);
}
function estimatedCharWidth() {
    if (!charWidths.has(zoom)) {
        const style = getComputedStyle(contentNode ?? viewerRoot);
        measureContext.font = `${style.fontSize} ${style.fontFamily}`;
        charWidths.set(zoom, measureContext.measureText("0".repeat(80)).width / 80 || 7.2 * zoom);
    }
    return charWidths.get(zoom);
}
function wrappedLineCount(text, width) {
    const columns = Math.max(8, Math.floor(width / estimatedCharWidth() + 0.001));
    return Math.max(1, Math.ceil((text.length || 1) / columns));
}
function rowLayoutKey() {
    return [diffStyle, wrapLines ? "wrap" : "nowrap", zoom, Math.round(estimateCodeCellWidth())].join(":");
}
function rowLayoutForFile(file) {
    const key = rowLayoutKey();
    if (file.rowLayout?.key === key)
        return file.rowLayout;
    const rows = [];
    let top = 0;
    for (const row of file.rows) {
        const height = estimateRowHeight(file, row);
        rows.push({ top, height, bottom: top + height });
        top += height;
    }
    file.rowLayout = { key, rows, total: top };
    return file.rowLayout;
}
function shouldVirtualizeRows(file) {
    return file.rows.length > ROW_VIRTUAL_THRESHOLD;
}
function viewSnapshot() {
    return { top: viewerRoot.scrollTop, height: viewerRoot.clientHeight };
}
function renderVisibleFiles(force = false) {
    if (!contentNode || !layout.length)
        return;
    const view = viewSnapshot();
    const covered = !force && renderedFileRangeCoversViewport(view);
    if (force)
        clearRenderedSections();
    if (!covered)
        applyFileRange(visibleRange(view), view);
    const stale = staleRowFiles(view);
    for (const index of stale)
        updateFileRows(index, view);
    if (covered && !stale.length)
        return;
    queueMeasure();
}
function clearRenderedSections() {
    for (const section of renderedSections.values())
        section.remove();
    renderedSections.clear();
    for (const file of files)
        file.renderedRowRange = null;
    renderedRange = { start: -1, end: -1 };
}
function applyFileRange(range, view) {
    for (const [index, section] of renderedSections) {
        if (index >= range.start && index < range.end)
            continue;
        section.remove();
        renderedSections.delete(index);
        files[index].renderedRowRange = null;
    }
    let anchor = bottomSpacer;
    for (let index = range.end - 1; index >= range.start; index -= 1) {
        const existing = renderedSections.get(index);
        if (existing) {
            anchor = existing;
            continue;
        }
        const section = renderFile(files[index], index, view);
        contentNode.insertBefore(section, anchor);
        renderedSections.set(index, section);
        anchor = section;
    }
    renderedRange = range;
    updateSpacers();
}
function updateSpacers() {
    const before = renderedRange.start >= 0 && renderedRange.start < layout.length ? layout[renderedRange.start].top : 0;
    const after = renderedRange.end > 0 ? Math.max(0, totalHeight - layout[renderedRange.end - 1].bottom + VIEWER_PADDING_BOTTOM) : totalHeight + VIEWER_PADDING_BOTTOM;
    topSpacer.style.height = `${before}px`;
    bottomSpacer.style.height = `${after}px`;
}
function staleRowFiles(view) {
    const stale = [];
    for (const index of renderedSections.keys()) {
        const file = files[index];
        if (!collapsed.has(file.id) && shouldVirtualizeRows(file) && !rowRangeCoversViewport(file, index, view))
            stale.push(index);
    }
    return stale;
}
function renderedFileRangeCoversViewport(view) {
    if (renderedRange.start < 0 || renderedRange.end <= renderedRange.start || !layout.length)
        return false;
    const start = Math.max(0, renderedRange.start);
    const end = Math.min(layout.length, renderedRange.end);
    if (start >= end)
        return false;
    const viewportBottom = view.top + view.height;
    const rangeTop = layout[start]?.top ?? 0;
    const rangeBottom = layout[end - 1]?.bottom ?? 0;
    const topCovered = start === 0 || view.top >= rangeTop + FILE_REUSE_MARGIN;
    const bottomCovered = end >= layout.length || viewportBottom <= rangeBottom - FILE_REUSE_MARGIN;
    return topCovered && bottomCovered;
}
function visibleRange(view) {
    if (!layout.length)
        return { start: 0, end: 0 };
    const top = Math.max(0, view.top - FILE_VIRTUAL_OVERSCAN);
    const bottom = view.top + view.height + FILE_VIRTUAL_OVERSCAN;
    const start = Math.max(0, findFirstBottomAtLeast(top) - 1);
    const end = Math.min(layout.length, findFirstTopAfter(bottom) + 1);
    return { start, end: Math.max(start + 1, end) };
}
function findFirstBottomAtLeast(value) {
    let low = 0;
    let high = layout.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (layout[mid].bottom < value)
            low = mid + 1;
        else
            high = mid;
    }
    return low;
}
function findFirstTopAfter(value) {
    let low = 0;
    let high = layout.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (layout[mid].top <= value)
            low = mid + 1;
        else
            high = mid;
    }
    return low;
}
function queueRenderVisible() {
    if (renderFrame)
        return;
    renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        renderVisibleFiles();
    });
}
function queueMeasure() {
    if (measureFrame)
        return;
    measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        measureRenderedFiles();
    });
}
function measureRenderedFiles() {
    if (!renderedSections.size)
        return;
    let changedAt = Infinity;
    let scrollDelta = 0;
    const scrollTop = viewerRoot.scrollTop;
    for (const [index, section] of renderedSections) {
        const measured = Math.ceil(section.getBoundingClientRect().height);
        if (!layout[index] || measured <= 0)
            continue;
        const delta = measured - layout[index].height;
        if (Math.abs(delta) <= 1)
            continue;
        if (layout[index].top < scrollTop)
            scrollDelta += delta;
        layout[index].height = measured;
        changedAt = Math.min(changedAt, index);
    }
    if (changedAt === Infinity)
        return;
    updateLayoutFrom(changedAt);
    updateSpacers();
    if (scrollDelta)
        viewerRoot.scrollTop = Math.max(0, viewerRoot.scrollTop + scrollDelta);
    queueRenderVisible();
}
function rerenderVirtualViewer() {
    if (!contentNode)
        return;
    contentNode.className = `diff-content ${diffStyle}`;
    rebuildLayout();
    renderVisibleFiles(true);
}
function bodyStyle(file) {
    const chars = file.maxLen + 1;
    return `--code-w: calc(${chars}ch + 20px)`;
}
function rowVirtualRange(file, fileIndex, view) {
    if (!shouldVirtualizeRows(file))
        return null;
    const rowLayout = rowLayoutForFile(file);
    if (!rowLayout.rows.length)
        return null;
    if (rowRangeCoversViewport(file, fileIndex, view))
        return file.renderedRowRange;
    const fileTop = layout[fileIndex]?.top ?? 0;
    const bodyTop = fileTop + FILE_HEADER_HEIGHT;
    const top = Math.max(0, view.top - ROW_VIRTUAL_OVERSCAN - bodyTop);
    const bottom = Math.min(rowLayout.total, view.top + view.height + ROW_VIRTUAL_OVERSCAN - bodyTop);
    const start = Math.max(0, findFirstRowBottomAtLeast(rowLayout.rows, top) - 4);
    const end = Math.min(rowLayout.rows.length, findFirstRowTopAfter(rowLayout.rows, bottom) + 4);
    const safeEnd = Math.max(start + 1, end);
    const range = {
        key: rowLayout.key,
        start,
        end: safeEnd,
        before: rowLayout.rows[start]?.top ?? 0,
        after: Math.max(0, rowLayout.total - (rowLayout.rows[safeEnd - 1]?.bottom ?? 0)),
    };
    file.renderedRowRange = range;
    return range;
}
function rowRangeCoversViewport(file, fileIndex, view) {
    if (!shouldVirtualizeRows(file))
        return true;
    const rowLayout = rowLayoutForFile(file);
    const range = file.renderedRowRange;
    if (!range || range.key !== rowLayout.key || !rowLayout.rows.length)
        return false;
    const fileTop = layout[fileIndex]?.top ?? 0;
    const bodyTop = fileTop + FILE_HEADER_HEIGHT;
    const viewportTop = Math.max(0, view.top - bodyTop);
    const viewportBottom = Math.min(rowLayout.total, view.top + view.height - bodyTop);
    const rangeTop = rowLayout.rows[range.start]?.top ?? 0;
    const rangeBottom = rowLayout.rows[range.end - 1]?.bottom ?? rowLayout.total;
    const topCovered = range.start === 0 || viewportTop >= rangeTop + ROW_REUSE_MARGIN;
    const bottomCovered = range.end >= rowLayout.rows.length || viewportBottom <= rangeBottom - ROW_REUSE_MARGIN;
    return topCovered && bottomCovered;
}
function findFirstRowBottomAtLeast(rows, value) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (rows[mid].bottom < value)
            low = mid + 1;
        else
            high = mid;
    }
    return low;
}
function findFirstRowTopAfter(rows, value) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (rows[mid].top <= value)
            low = mid + 1;
        else
            high = mid;
    }
    return low;
}
function escapeText(text) {
    return text.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
}
function escapeAttr(text) {
    return text.replace(/[&"<\t]/g, (ch) => (ch === "&" ? "&amp;" : ch === '"' ? "&quot;" : ch === "<" ? "&lt;" : "&#9;"));
}
function lineNoHtml(kind, lineNumber) {
    return `<span class="line-no${kind ? ` ${kind}` : ""}">${lineNumber === null ? "" : lineNumber}</span>`;
}
function codeCellHtml(extraClass, text, lang, present, rowIndex, side) {
    const body = highlight(text, lang);
    const copy = present ? ` data-copy-row="${rowIndex}" data-copy-side="${side}" data-copy-text="${escapeAttr(text)}"` : "";
    return `<span class="code-cell${extraClass ? ` ${extraClass}` : ""}"${copy}>${present && !body ? "\n" : body}</span>`;
}
function rowBuilders(lang) {
    if (diffStyle !== "split") {
        return [(row, index) => {
                if (row.kind === "hunk" || row.kind === "meta")
                    return `<div class="diff-row ${row.kind} unified-row span-row">${escapeText(row.text)}</div>`;
                return `<div class="diff-row ${row.kind} unified-row">${lineNoHtml("", row.oldLineNumber)}${lineNoHtml("", row.newLineNumber)}${codeCellHtml("", row.text, lang, true, index, "unified")}</div>`;
            }];
    }
    if (wrapLines) {
        return [(row, index) => {
                if (row.kind === "hunk" || row.kind === "meta")
                    return `<div class="diff-row ${row.kind} split-row span-row">${escapeText(row.text)}</div>`;
                const oldText = row.kind === "addition" ? "" : row.text;
                const newText = row.kind === "deletion" ? "" : row.text;
                return `<div class="diff-row ${row.kind} split-row">${lineNoHtml("", row.oldLineNumber)}${codeCellHtml("old-cell", oldText, lang, row.oldLineNumber !== null, index, "old")}${lineNoHtml("", row.newLineNumber)}${codeCellHtml("new-cell", newText, lang, row.newLineNumber !== null, index, "new")}</div>`;
            }];
    }
    const sideBuilder = (side) => (row, index) => {
        if (row.kind === "hunk" || row.kind === "meta")
            return `<div class="diff-row meta span-row">${side === "old" ? escapeText(row.text) : ""}</div>`;
        const text = side === "old" ? (row.kind === "addition" ? "" : row.text) : (row.kind === "deletion" ? "" : row.text);
        const lineNumber = side === "old" ? row.oldLineNumber : row.newLineNumber;
        return `<div class="diff-row split-row">${lineNoHtml(row.kind, lineNumber)}${codeCellHtml(`${side}-cell ${row.kind}`, text, lang, lineNumber !== null, index, side)}</div>`;
    };
    return [sideBuilder("old"), sideBuilder("new")];
}
function rowsHtml(file, start, end, build) {
    let html = "";
    for (let index = start; index < end; index += 1)
        html += build(file.rows[index], index);
    return html;
}
function rowSpacerHtml(height) {
    return `<div class="row-virtual-spacer" style="height:${height}px"></div>`;
}
function fillFileBody(body, file, index, view) {
    const range = rowVirtualRange(file, index, view);
    const builders = rowBuilders(language_for(file.path));
    const start = range ? range.start : 0;
    const end = range ? range.end : file.rows.length;
    const panes = builders.map((build) => {
        const rows = rowsHtml(file, start, end, build);
        return range ? rowSpacerHtml(range.before) + rows + rowSpacerHtml(range.after) : rows;
    });
    body.innerHTML = builders.length === 2 ? panes.map((pane) => `<div class="split-pane">${pane}</div>`).join("") : panes[0];
}
function updateFileRows(index, view) {
    const file = files[index];
    const section = renderedSections.get(index);
    const body = section?.lastElementChild;
    if (!body || !body.classList.contains("diff-file-body"))
        return;
    const prev = file.renderedRowRange;
    const next = rowVirtualRange(file, index, view);
    if (!next)
        return;
    if (!prev || prev.key !== next.key || next.start >= prev.end || next.end <= prev.start) {
        fillFileBody(body, file, index, view);
        return;
    }
    const builders = rowBuilders(language_for(file.path));
    const panes = builders.length === 2 ? [...body.children] : [body];
    panes.forEach((pane, side) => patchRows(pane, file, builders[side], prev, next));
}
function patchRows(pane, file, build, prev, next) {
    const top = pane.firstElementChild;
    const bottom = pane.lastElementChild;
    for (let index = prev.start; index < next.start; index += 1)
        top.nextElementSibling.remove();
    for (let index = next.end; index < prev.end; index += 1)
        bottom.previousElementSibling.remove();
    if (next.start < prev.start)
        top.insertAdjacentHTML("afterend", rowsHtml(file, next.start, prev.start, build));
    if (next.end > prev.end)
        bottom.insertAdjacentHTML("beforebegin", rowsHtml(file, prev.end, next.end, build));
    top.style.height = `${next.before}px`;
    bottom.style.height = `${next.after}px`;
}
function chevronSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m6 9 6 6 6-6");
    svg.appendChild(path);
    return svg;
}
function findFocusId(focusPath) {
    if (!focusPath)
        return "";
    const matches = (name) => name === focusPath || name.endsWith(`/${focusPath}`) || focusPath.endsWith(`/${name}`);
    return files.find((file) => matches(file.path) || (file.oldPath ? matches(file.oldPath) : false))?.id ?? "";
}
async function renderPatch(patch, focusPath) {
    const trimmed = patch.trim();
    if (!trimmed) {
        clearDiff("No changes");
        return;
    }
    files = parsePatch(trimmed);
    collapsed = new Set([...collapsed].filter((id) => files.some((file) => file.id === id)));
    if (!files.length) {
        clearDiff("No changes");
        return;
    }
    const focusId = findFocusId(focusPath);
    await renderViewer();
    hideLoading();
    emptyState.classList.add("hidden");
    renderFileList(focusId);
    renderStats(summarize(files));
    if (focusId)
        setActiveItem(focusId);
}
function setActiveItem(itemId, shouldScroll = true) {
    activeItemId = itemId;
    sidebar.setActive(itemId);
    if (!shouldScroll || !itemId)
        return;
    const index = files.findIndex((file) => file.id === itemId);
    if (index < 0 || !layout[index])
        return;
    suppressScrollSync = true;
    viewerRoot.scrollTo({ top: layout[index].top, behavior: "smooth" });
    queueRenderVisible();
    setTimeout(() => {
        suppressScrollSync = false;
    }, 180);
}
function activeIndexForScroll() {
    if (!layout.length)
        return -1;
    const top = lastViewTop + 4;
    let index = findFirstBottomAtLeast(top);
    if (index >= layout.length)
        index = layout.length - 1;
    return index;
}
function syncActiveFromScroll() {
    if (suppressScrollSync)
        return;
    if (scrollFrame)
        cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const index = activeIndexForScroll();
        const best = index >= 0 ? files[index]?.id : "";
        if (best && best !== activeItemId)
            setActiveItem(best, false);
    });
}
function toggleItemCollapsed(itemId) {
    if (collapsed.has(itemId))
        collapsed.delete(itemId);
    else
        collapsed.add(itemId);
    rerenderVirtualViewer();
    setActiveItem(itemId, false);
}
function setAllCollapsed(value) {
    collapsed = value ? new Set(files.map((file) => file.id)) : new Set();
    rerenderVirtualViewer();
    setActiveItem(activeItemId, false);
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
    files = [];
    collapsed.clear();
    contentNode = null;
    topSpacer = null;
    bottomSpacer = null;
    renderedSections = new Map();
    layout = [];
    renderedRange = { start: -1, end: -1 };
    totalHeight = 0;
    lastViewTop = 0;
    viewerRoot.replaceChildren();
    sidebar.clear();
    emptyState.classList.remove("hidden");
    fileCountNode.textContent = "0";
    statFilesNode.textContent = "0";
    statAdditionsNode.textContent = "+0";
    statDeletionsNode.textContent = "-0";
    summaryNode.textContent = message;
}
function diffData() {
    return (window.muxy?.data ?? {});
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
            await renderPatch(diff, data.focusPath ?? "");
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
            await renderPatch(res.stdout, data.focusPath ?? "");
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
            await renderPatch(res.stdout, data.focusPath ?? "");
            return;
        }
        sourceLabelNode.textContent = "Working Tree";
        showLoading("Loading changes...");
        const [staged, unstaged] = await Promise.all([
            cmd.diff(cwd, { staged: true }),
            cmd.diff(cwd, { staged: false }),
        ]);
        await renderPatch([staged.diff, unstaged.diff].filter((diff) => diff.trim()).join("\n"), data.focusPath ?? "");
    }
    catch (error) {
        clearDiff(error instanceof Error ? error.message : String(error));
    }
}
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
    if (files.length)
        rerenderVirtualViewer();
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
    rerenderVirtualViewer();
    setActiveItem(activeItemId, false);
}
function applyWrap() {
    document.documentElement.classList.toggle("no-wrap", !wrapLines);
    toggleWrapButton.classList.toggle("active", wrapLines);
    toggleWrapButton.title = wrapLines ? "Disable line wrap" : "Enable line wrap";
}
function toggleWrap() {
    wrapLines = !wrapLines;
    writePref("muxy.git.diff.wrap", String(wrapLines));
    applyWrap();
    rerenderVirtualViewer();
    setActiveItem(activeItemId, false);
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
function selectionToText(selection) {
    const groups = new Map();
    for (const cell of viewerRoot.querySelectorAll(".code-cell[data-copy-text]")) {
        if (!selection.containsNode(cell, true))
            continue;
        const section = cell.closest("[data-item-id]");
        const fileIndex = Number(section?.dataset.fileIndex);
        if (!Number.isFinite(fileIndex))
            continue;
        const order = fileIndex * 1e7 + Number(cell.dataset.copyRow);
        const existing = groups.get(order);
        if (!existing || sidePriority(cell.dataset.copySide) > sidePriority(existing.dataset.copySide))
            groups.set(order, cell);
    }
    if (!groups.size)
        return null;
    return Array.from(groups.keys()).sort((a, b) => a - b)
        .map((order) => groups.get(order).dataset.copyText).join("\n");
}
function sidePriority(side) {
    return side === "unified" ? 2 : side === "new" ? 1 : 0;
}
function handleViewerScroll() {
    lastViewTop = viewerRoot.scrollTop;
    queueRenderVisible();
    syncActiveFromScroll();
}
viewerRoot.addEventListener("copy", (event) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed)
        return;
    const text = selectionToText(selection);
    if (text === null)
        return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", text);
});
viewerRoot.addEventListener("scroll", handleViewerScroll, { passive: true });
if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
        if (!files.length)
            return;
        if (viewerRoot.clientWidth === lastViewerWidth) {
            queueRenderVisible();
            return;
        }
        lastViewerWidth = viewerRoot.clientWidth;
        rerenderVirtualViewer();
    }).observe(viewerRoot);
}
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
    if (!(event.metaKey || event.ctrlKey))
        return;
    if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoom(zoom + ZOOM_STEP);
    }
    else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom(zoom - ZOOM_STEP);
    }
    else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
    }
});
window.muxy?.onDataChange?.(() => void loadGitDiff());
applyZoom();
syncStyleButton();
syncTreeButton();
applyWrap();
void loadGitDiff();
