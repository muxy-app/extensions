import { h, readPref, writePref } from "@/lib/dom";
import * as cmd from "@/lib/cmd";
import { highlight, language_for } from "@/lib/highlight";
import { DiffFileListView } from "./diff-file-list";
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
const railResize = document.querySelector("#rail-resize");
const MAX_RENDER_ROWS = 12000;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;
const RAIL_MIN = 180;
const RAIL_MAX = 520;
let files = [];
let activeItemId = "";
let diffStyle = readPref("muxy.git.diff.style", "split");
let wrapLines = readPref("muxy.git.diff.wrap", "true") !== "false";
let zoom = Number(readPref("muxy.git.diff.zoom", "1")) || 1;
let collapsed = new Set();
let suppressScrollSync = false;
let scrollFrame = 0;
const sidebar = new DiffFileListView(fileListNode, (itemId) => {
    setActiveItem(itemId);
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
    let totalRows = 0;
    const push = (row) => {
        if (!current)
            return;
        if (totalRows >= MAX_RENDER_ROWS) {
            current.truncated = true;
            return;
        }
        current.rows.push(row);
        totalRows += 1;
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
                truncated: false,
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
        stats.truncated ||= file.truncated;
        return stats;
    }, { files: nextFiles.length, additions: 0, deletions: 0, truncated: false });
}
function renderStats(stats) {
    fileCountNode.textContent = String(stats.files);
    statFilesNode.textContent = String(stats.files);
    statAdditionsNode.textContent = `+${stats.additions}`;
    statDeletionsNode.textContent = `-${stats.deletions}`;
    const mode = stats.truncated ? " · optimized" : "";
    summaryNode.replaceChildren(h("span", { class: "file-pill" }, `${stats.files} ${stats.files === 1 ? "file" : "files"}${mode}`), h("span", { class: "added" }, `+${stats.additions}`), h("span", { class: "deleted" }, `-${stats.deletions}`));
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
    const content = h("div", { class: `diff-content ${diffStyle}` });
    viewerRoot.appendChild(content);
    for (let index = 0; index < files.length; index += 1) {
        content.appendChild(renderFile(files[index]));
        if (index % 8 === 7)
            await nextFrame();
    }
}
function renderFile(file) {
    const isCollapsed = collapsed.has(file.id);
    return h("section", { class: "diff-file-section", "data-item-id": file.id }, h("button", {
        type: "button",
        class: "diff-file-header",
        "data-collapsed": isCollapsed ? "true" : "false",
        onclick: () => toggleItemCollapsed(file.id),
    }, h("span", { class: "file-chevron" }, chevronSvg()), h("span", { class: "diff-file-title", title: file.path }, file.path), file.oldPath ? h("span", { class: "diff-file-previous", title: file.oldPath }, file.oldPath) : null, h("span", { class: "diff-file-stat added" }, `+${file.additions}`), h("span", { class: "diff-file-stat deleted" }, `-${file.deletions}`)), isCollapsed ? null : h("div", { class: "diff-file-body" }, renderRows(file)));
}
function renderRows(file) {
    const lang = language_for(file.path);
    const rows = file.rows.map((row) => (diffStyle === "split" ? renderSplitRow(row, lang) : renderUnifiedRow(row, lang)));
    if (file.truncated) {
        rows.push(h("div", { class: "diff-row meta unified-row" }, h("span", { class: "line-no" }), h("span", { class: "line-no" }), h("span", { class: "code-cell" }, "Diff truncated for faster rendering.")));
    }
    return rows;
}
function codeCell(extraClass, mark, text, lang) {
    return h("span", { class: extraClass ? `code-cell ${extraClass}` : "code-cell", html: mark + highlight(text, lang) });
}
function renderUnifiedRow(row, lang) {
    if (row.kind === "hunk" || row.kind === "meta") {
        return h("div", { class: `diff-row ${row.kind} unified-row` }, h("span", { class: "line-no" }), h("span", { class: "line-no" }), h("span", { class: "code-cell" }, row.text));
    }
    const mark = row.kind === "addition" ? "+" : row.kind === "deletion" ? "-" : " ";
    return h("div", { class: `diff-row ${row.kind} unified-row` }, h("span", { class: "line-no" }, row.oldLineNumber === null ? "" : String(row.oldLineNumber)), h("span", { class: "line-no" }, row.newLineNumber === null ? "" : String(row.newLineNumber)), codeCell("", mark, row.text, lang));
}
function renderSplitRow(row, lang) {
    if (row.kind === "hunk" || row.kind === "meta") {
        return h("div", { class: `diff-row ${row.kind} split-row span-row` }, row.text);
    }
    const oldText = row.kind === "addition" ? "" : row.text;
    const newText = row.kind === "deletion" ? "" : row.text;
    return h("div", { class: `diff-row ${row.kind} split-row` }, h("span", { class: "line-no" }, row.oldLineNumber === null ? "" : String(row.oldLineNumber)), codeCell("old-cell", "", oldText, lang), h("span", { class: "line-no" }, row.newLineNumber === null ? "" : String(row.newLineNumber)), codeCell("new-cell", "", newText, lang));
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
    const target = Array.from(viewerRoot.querySelectorAll("[data-item-id]"))
        .find((section) => section.dataset.itemId === itemId);
    if (!target)
        return;
    suppressScrollSync = true;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    setTimeout(() => {
        suppressScrollSync = false;
    }, 180);
}
function syncActiveFromScroll() {
    if (suppressScrollSync)
        return;
    if (scrollFrame)
        cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const viewportTop = viewerRoot.getBoundingClientRect().top;
        let best = "";
        let bestTop = -Infinity;
        for (const section of viewerRoot.querySelectorAll("[data-item-id]")) {
            const top = section.getBoundingClientRect().top - viewportTop;
            if (top <= 4 && top > bestTop) {
                bestTop = top;
                best = section.dataset.itemId ?? "";
            }
        }
        if (best && best !== activeItemId)
            setActiveItem(best, false);
    });
}
function toggleItemCollapsed(itemId) {
    if (collapsed.has(itemId))
        collapsed.delete(itemId);
    else
        collapsed.add(itemId);
    void renderViewer().then(() => setActiveItem(itemId, false));
}
function setAllCollapsed(value) {
    collapsed = value ? new Set(files.map((file) => file.id)) : new Set();
    void renderViewer().then(() => setActiveItem(activeItemId, false));
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
        sourceLabelNode.textContent = "Working Tree";
        showLoading("Loading changes...");
        const [staged, unstaged] = await Promise.all([
            cmd.diff(cwd, { staged: true, lineLimit: MAX_RENDER_ROWS }),
            cmd.diff(cwd, { staged: false, lineLimit: MAX_RENDER_ROWS }),
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
}
function syncStyleButton() {
    toggleStyleButton.classList.toggle("active", diffStyle === "split");
    toggleStyleButton.title = diffStyle === "split" ? "Switch to unified view" : "Switch to split view";
}
function toggleStyle() {
    diffStyle = diffStyle === "split" ? "unified" : "split";
    writePref("muxy.git.diff.style", diffStyle);
    syncStyleButton();
    void renderViewer().then(() => setActiveItem(activeItemId, false));
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
viewerRoot.addEventListener("scroll", syncActiveFromScroll);
zoomInButton.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
zoomOutButton.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
zoomResetButton.addEventListener("click", () => setZoom(1));
toggleStyleButton.addEventListener("click", toggleStyle);
toggleWrapButton.addEventListener("click", toggleWrap);
collapseAllButton.addEventListener("click", () => setAllCollapsed(true));
expandAllButton.addEventListener("click", () => setAllCollapsed(false));
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
applyWrap();
void loadGitDiff();
