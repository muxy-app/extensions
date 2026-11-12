// The Dockerfile editor tab. One tab edits one file: a textarea over a
// highlighted copy of its text, saved through muxy.files (files:write, and
// Muxy asks before each change), and a Preview mode like the sidebar's.
// The sidebar opens it with { filePath, key, mode, line }.
import { highlightDockerfile, codeHtml } from "./highlight.js";
import { parseDockerfile } from "./project.js";
import { icon } from "./icons.js";

const $ = (sel) => document.querySelector(sel);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
const mx = () => window.muxy;
const LINE = 19; // px, the editor's line height in editor.css

const ed = { path: "", key: "", mode: "edit", info: null, content: null, crlf: false, saving: false, savedAt: 0, loadError: "", banner: null, diskText: null };
const find = { open: false, query: "", hits: [], current: -1 };
let ta;
let hl;
let marks;
let gutter;
let lineCount = 0;
let activeLine = -1;
let title = "";

const dirty = () => ed.content != null && ta.value !== ed.content;
const fileName = (p) => String(p).split("/").pop();
const fileDir = (p) => {
  const i = String(p).lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
};
const normalize = (raw) => String(raw ?? "").replace(/\r\n?/g, "\n");

// ---------------------------------------------------------------- view

function mountEditor() {
  $("#ed-main").innerHTML = `<div class="editor">
    <div class="editor-gutter" aria-hidden="true"><div class="gutter-lines"></div></div>
    <div class="editor-main">
      <pre class="editor-marks" aria-hidden="true"></pre>
      <pre class="editor-hl" aria-hidden="true"></pre>
      <textarea class="editor-input" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" wrap="off" readonly aria-label="Dockerfile"></textarea>
    </div>
  </div>
  <div class="ed-preview" id="ed-preview"></div>`;
  ta = $(".editor-input");
  hl = $(".editor-hl");
  marks = $(".editor-marks");
  gutter = $(".gutter-lines");
  ta.addEventListener("input", () => {
    paint();
    if (find.open) runFind(false);
    renderState();
  });
  ta.addEventListener("scroll", syncScroll);
  ta.addEventListener("keydown", onEditorKey);
  for (const ev of ["keyup", "click", "select", "focus"]) ta.addEventListener(ev, renderCursor);
}

function paint() {
  const lines = highlightDockerfile(ta.value);
  hl.innerHTML = `${lines.join("\n")}\n `;
  if (lines.length !== lineCount) {
    lineCount = lines.length;
    gutter.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join("");
    activeLine = -1;
  }
  paintMarks();
  syncScroll();
  renderCursor();
}

function paintMarks() {
  if (!find.open || !find.hits.length) {
    marks.innerHTML = "";
    return;
  }
  const text = ta.value;
  const n = find.query.length;
  let html = "";
  let last = 0;
  find.hits.forEach((at, i) => {
    html += `${esc(text.slice(last, at))}<mark${i === find.current ? ' class="current"' : ""}>${esc(text.slice(at, at + n))}</mark>`;
    last = at + n;
  });
  marks.innerHTML = `${html}${esc(text.slice(last))}\n `;
}

function syncScroll() {
  for (const el of [hl, marks]) {
    el.scrollTop = ta.scrollTop;
    el.scrollLeft = ta.scrollLeft;
  }
  gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
}

function cursorPos() {
  const at = ta.selectionStart;
  const before = ta.value.slice(0, at);
  return { line: before.split("\n").length, col: at - before.lastIndexOf("\n") };
}

function renderCursor() {
  const { line, col } = cursorPos();
  $("#ed-pos").textContent = ed.content == null ? "" : ed.mode === "preview" ? "Preview" : `Ln ${line}, Col ${col}`;
  if (line !== activeLine) {
    gutter.children[activeLine - 1]?.classList.remove("active");
    gutter.children[line - 1]?.classList.add("active");
    activeLine = line;
  }
}

function renderTitle() {
  const name = ed.path ? fileName(ed.path) : "Dockerfile";
  const dir = fileDir(ed.path);
  $("#ed-title").innerHTML = `<span class="ed-name">${esc(name)}</span>${dir ? `<span class="ed-dir" title="${esc(ed.path)}">${esc(dir)}</span>` : ""}`;
  const next = `${ta && dirty() ? "● " : ""}${name}`;
  if (next !== title) {
    title = next;
    document.title = next;
    mx()?.tabs?.setTitle?.(next)?.catch?.(() => {});
  }
}

function renderState() {
  const el = $("#ed-state");
  const isDirty = dirty();
  el.textContent = ed.saving ? "Saving…" : ed.content == null ? "" : isDirty ? "Edited" : "Saved";
  el.classList.toggle("dirty", isDirty && !ed.saving);
  $("#save-btn").disabled = !isDirty || ed.saving;
  $("#ed-eol").textContent = ed.content == null ? "" : ed.crlf ? "CRLF" : "LF";
  renderTitle();
}

function renderBanner() {
  const el = $("#banner");
  const b = ed.banner;
  el.hidden = !b;
  if (!b) return;
  el.className = `ed-banner${b.kind === "error" ? " error" : ""}`;
  const buttons =
    b.kind === "stale"
      ? `<button class="button" data-action="reload">Load It</button><button class="button" data-action="keep">Keep Mine</button>`
      : `<button class="button" data-action="dismiss">OK</button>`;
  el.innerHTML = `${icon("alert")}<span>${esc(b.text)}</span><span class="spacer"></span>${buttons}`;
}

function renderBody() {
  ta.readOnly = ed.content == null;
  const main = $("#ed-main");
  main.querySelector(".ed-empty")?.remove();
  if (ed.content == null) {
    const note = document.createElement("div");
    note.className = "ed-empty";
    note.innerHTML = ed.loadError
      ? `${icon("alert")}<div>Couldn't open ${esc(ed.path || "the file")}</div><div class="muted">${esc(ed.loadError)}</div><button class="button" data-action="retry">Try Again</button>`
      : ed.path
      ? `<span class="spin"></span>`
      : `${icon("whale")}<div>No Dockerfile to edit</div>`;
    main.append(note);
  }
}

function renderAll() {
  renderBody();
  renderState();
  renderBanner();
  renderCursor();
  if (ed.mode === "preview") renderPreview();
}

// ---------------------------------------------------------------- preview

function setMode(mode, line = 0) {
  ed.mode = mode === "preview" ? "preview" : "edit";
  document.body.classList.toggle("preview-mode", ed.mode === "preview");
  $("#mode-edit").classList.toggle("active", ed.mode === "edit");
  $("#mode-preview").classList.toggle("active", ed.mode === "preview");
  $("#mode-edit").setAttribute("aria-selected", String(ed.mode === "edit"));
  $("#mode-preview").setAttribute("aria-selected", String(ed.mode === "preview"));
  if (ed.mode === "preview") {
    if (find.open) closeFind();
    preview._html = "";
    renderPreview();
    loadInfo();
  } else if (ed.content != null) {
    if (line) gotoLine(line);
    else ta.focus({ preventScroll: true });
  }
  renderCursor();
}

async function loadInfo() {
  if (!ed.key) return;
  try {
    const next = (await mx().storage.get("dfinfo"))?.[ed.key] || null;
    if (JSON.stringify(next) === JSON.stringify(ed.info)) return;
    ed.info = next;
    if (ed.mode === "preview") renderPreview();
  } catch {
    /* the preview shows what the file itself says */
  }
}

const preview = { get el() { return $("#ed-preview"); }, _html: "" };

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

function applyElapsed() {
  for (const el of document.querySelectorAll("[data-since]")) {
    const text = fmtElapsed(Date.now() - Number(el.dataset.since));
    if (el.textContent !== text) el.textContent = text;
  }
}

const shortImage = (ref) =>
  String(ref || "")
    .replace(/^docker\.io\/(?:library\/)?/, "")
    .replace(/@sha256:([0-9a-f]{7})[0-9a-f]+/, "@$1…");

function kv(label, value, { mono = false, html = false } = {}) {
  if (value == null || value === "") return "";
  return `<div class="kv"><div class="k">${esc(label)}</div><div class="v${mono ? " mono" : ""}">${html ? value : esc(value)}</div></div>`;
}

function statusHtml(info) {
  const b = info?.build;
  if (b?.status === "building") {
    const how = { terminal: "in a terminal", background: "in the background", external: "outside the sidebar" }[b.mode] || "";
    return `<span class="badge warn live-badge"><span class="spin tiny"></span>Building${b.steps ? ` ${esc(b.steps)}` : ""}</span> <span class="elapsed" data-since="${Number(b.since) || Date.now()}"></span>${how ? ` <span class="muted">${how}</span>` : ""}`;
  }
  if (b?.status === "failed") return `<span class="badge bad">Build failed</span> <span class="muted">${esc(b.message)}</span>`;
  if (info?.running) return `<span class="badge ok live-badge"><span class="pulse"></span>${info.running > 1 ? `${info.running} running` : "Running"}</span>`;
  return "";
}

function stagesHtml(stages) {
  if (stages.length < 2) return "";
  return `<div class="stage-flow">${stages
    .map((s, i) => `<span class="stage-chip"><span>${esc(s.name || `#${i + 1}`)}</span><span class="muted">${esc(shortImage(s.image))}</span></span>`)
    .join('<span class="stage-arrow">→</span>')}</div>`;
}

function renderPreview() {
  const el = preview.el;
  if (!el || ed.content == null) return;
  const text = ta.value;
  const parsed = parseDockerfile(text);
  const info = ed.info;
  const built = info ? (info.built === "yes" ? "Yes" : info.built || (info.built === "" ? "Not yet" : "")) : "";
  const overview =
    kv("Image", info?.tag, { mono: true }) +
    kv("Status", statusHtml(info), { html: true }) +
    kv("Built", built) +
    kv("Context", info ? (info.context === "." ? "project folder" : info.context) : "", { mono: true }) +
    kv("Base", shortImage(parsed.base), { mono: true }) +
    kv("Stages", stagesHtml(parsed.stages), { html: true }) +
    kv("Ports", parsed.ports.map((p) => `${p.port}/${p.proto}`).join(", "), { mono: true });
  const html = `<div class="ed-preview-inner">
    ${dirty() ? '<div class="d-note">Showing your unsaved changes.</div>' : ""}
    ${overview ? `<section class="d-section"><h3>Overview</h3>${overview}</section>` : ""}
    <section class="d-section"><h3>${esc(fileName(ed.path))}</h3>${codeHtml(text, "line")}</section>
  </div>`;
  if (preview._html === html) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return;
  el.innerHTML = html;
  preview._html = html;
  applyElapsed();
}

// ---------------------------------------------------------------- editing

function lineStart(at) {
  return ta.value.lastIndexOf("\n", at - 1) + 1;
}

function onEditorKey(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "s") {
    e.preventDefault();
    save();
  } else if (mod && e.shiftKey && key === "v") {
    e.preventDefault();
    setMode("preview");
  } else if (mod && key === "f") {
    e.preventDefault();
    openFind();
  } else if (e.key === "Escape" && find.open) {
    e.preventDefault();
    closeFind();
  } else if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) outdent();
    else document.execCommand("insertText", false, "    ");
  } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
    // Keep the indent, and indent the line after a `\` continuation.
    const start = lineStart(ta.selectionStart);
    const line = ta.value.slice(start, ta.selectionStart);
    const prev = ta.value.slice(lineStart(start - 1), Math.max(0, start - 1));
    let indent = /^[ \t]*/.exec(line)[0];
    if (/\\\s*$/.test(line)) indent = indent || "    ";
    else if (indent && /\\\s*$/.test(prev)) indent = "";
    e.preventDefault();
    document.execCommand("insertText", false, `\n${indent}`);
  }
}

function outdent() {
  const start = lineStart(ta.selectionStart);
  const n = /^ {1,4}/.exec(ta.value.slice(start))?.[0].length || 0;
  if (!n) return;
  const [a, b] = [ta.selectionStart, ta.selectionEnd];
  ta.setSelectionRange(start, start + n);
  document.execCommand("insertText", false, "");
  ta.setSelectionRange(Math.max(start, a - n), Math.max(start, b - n));
}

function scrollToLine(line) {
  const top = (line - 1) * LINE;
  if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - LINE * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
  syncScroll();
}

function gotoLine(line) {
  const n = Math.max(1, Math.floor(Number(line) || 1));
  const lines = ta.value.split("\n");
  let at = 0;
  for (let i = 0; i < Math.min(n, lines.length) - 1; i++) at += lines[i].length + 1;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(at, at);
  scrollToLine(Math.min(n, lines.length));
  renderCursor();
}

let charW = 0;
function charWidth() {
  if (charW) return charW;
  const probe = document.createElement("span");
  probe.className = "ed-probe";
  probe.textContent = "0".repeat(20);
  $(".editor").append(probe);
  charW = probe.getBoundingClientRect().width / 20 || 7;
  probe.remove();
  return charW;
}

// ---------------------------------------------------------------- find

function openFind() {
  if (ed.mode !== "edit") setMode("edit");
  find.open = true;
  $("#findbar").hidden = false;
  const input = $("#find-input");
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes("\n")) input.value = sel;
  input.focus();
  input.select();
  runFind(true);
}

function closeFind() {
  find.open = false;
  find.hits = [];
  $("#findbar").hidden = true;
  paintMarks();
  ta.focus({ preventScroll: true });
}

function runFind(jump) {
  find.query = $("#find-input").value;
  find.hits = [];
  if (find.query) {
    const hay = ta.value.toLowerCase();
    const needle = find.query.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0 && find.hits.length < 5000; i = hay.indexOf(needle, i + needle.length)) find.hits.push(i);
  }
  if (!find.hits.length) find.current = -1;
  else if (jump || find.current < 0 || find.current >= find.hits.length) {
    find.current = Math.max(0, find.hits.findIndex((h) => h >= ta.selectionStart));
  }
  paintMarks();
  renderCount();
  if (jump) revealCurrent();
}

function step(dir) {
  if (!find.hits.length) return;
  find.current = (find.current + dir + find.hits.length) % find.hits.length;
  paintMarks();
  renderCount();
  revealCurrent();
}

function revealCurrent() {
  const at = find.hits[find.current];
  if (at == null) return;
  ta.setSelectionRange(at, at + find.query.length);
  scrollToLine(ta.value.slice(0, at).split("\n").length);
  const x = (at - lineStart(at)) * charWidth();
  if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 60) ta.scrollLeft = Math.max(0, x - ta.clientWidth / 2);
  syncScroll();
  renderCursor();
}

function renderCount() {
  $("#find-count").textContent = !find.query ? "" : find.hits.length ? `${find.current + 1} of ${find.hits.length}` : "No results";
}

// ---------------------------------------------------------------- files

function setText(text, { keepPlace = false } = {}) {
  const [a, b, top, left] = [ta.selectionStart, ta.selectionEnd, ta.scrollTop, ta.scrollLeft];
  ta.value = text;
  if (keepPlace) {
    ta.setSelectionRange(Math.min(a, text.length), Math.min(b, text.length));
    ta.scrollTop = top;
    ta.scrollLeft = left;
  }
  paint();
  if (find.open) runFind(false);
}

async function loadFile() {
  if (!ed.path) return renderAll();
  try {
    const raw = String((await mx().files.read(ed.path))?.content ?? "");
    ed.crlf = raw.includes("\r\n");
    ed.content = normalize(raw);
    ed.loadError = "";
    ed.banner = null;
    setText(ed.content);
  } catch (e) {
    ed.loadError = e?.message || String(e);
  }
  renderAll();
}

async function save() {
  if (ed.saving || !dirty()) return !dirty();
  const draft = ta.value;
  ed.saving = true;
  renderState();
  try {
    await mx().files.write(ed.path, ed.crlf ? draft.replace(/\n/g, "\r\n") : draft);
    ed.content = draft;
    ed.savedAt = Date.now();
    if (ed.banner?.kind === "stale") ed.banner = null;
    return true;
  } catch (e) {
    ed.banner = { kind: "error", text: `Couldn't save: ${e?.message || e}` };
    return false;
  } finally {
    ed.saving = false;
    renderAll();
  }
}

async function onDiskChange() {
  if (ed.content == null || ed.saving || Date.now() - ed.savedAt < 1500) return;
  let raw;
  try {
    raw = String((await mx().files.read(ed.path))?.content ?? "");
  } catch {
    return; // moved or deleted; keep what's on screen
  }
  const text = normalize(raw);
  if (text === ed.content) return;
  if (!dirty()) {
    ed.content = text;
    ed.crlf = raw.includes("\r\n");
    setText(text, { keepPlace: true });
  } else {
    ed.diskText = text;
    ed.banner = { kind: "stale", text: "This file changed on disk. Saving replaces that version." };
  }
  renderAll();
}

// The tab stays open while the user decides; closing is done here after.
async function askBeforeClose() {
  const choice = await mx().dialog.confirm({
    title: `Save your changes to ${fileName(ed.path)}?`,
    message: "They're lost if you don't save them.",
    buttons: ["Save", "Don't Save", "Cancel"],
    default: "Save",
    cancel: "Cancel",
  });
  if (choice === "Save") {
    if (await save()) mx().lifecycle.close();
  } else if (choice === "Don't Save") {
    ed.content = ta.value;
    mx().lifecycle.close();
  }
}

function matchesFile(path, projectPath) {
  const p = String(path || "");
  const root = String(projectPath || "").replace(/\/+$/, "");
  return p === ed.path || (root ? p === `${root}/${ed.path}` : p.endsWith(`/${ed.path}`));
}

// The sidebar leaves a line to jump to when it switches to an open tab.
async function takeGoto() {
  try {
    const g = await mx().storage.get("goto");
    if (g && g.path === ed.path && Date.now() - g.at < 15000) {
      await mx().storage.delete("goto");
      setMode(g.mode === "preview" ? "preview" : "edit", g.line);
    }
    loadInfo();
  } catch {
    /* nothing to jump to */
  }
}

// ---------------------------------------------------------------- start

function handleAction(action, el) {
  switch (action) {
    case "save":
      return save();
    case "find":
      return find.open ? closeFind() : openFind();
    case "find-next":
      return step(1);
    case "find-prev":
      return step(-1);
    case "find-close":
      return closeFind();
    case "retry":
      return loadFile();
    case "mode-edit":
      return setMode("edit");
    case "mode-preview":
      return setMode("preview");
    case "line":
      return setMode("edit", Number(el.dataset.line));
    case "reload":
      if (ed.diskText != null) {
        ed.content = ed.diskText;
        setText(ed.diskText, { keepPlace: true });
      }
      ed.banner = null;
      return renderAll();
    case "keep":
    case "dismiss":
      ed.banner = null;
      return renderBanner();
    default:
      return undefined;
  }
}

function bind() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    e.preventDefault();
    handleAction(el.dataset.action, el);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target === ta) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
      e.preventDefault();
      setMode(ed.mode === "preview" ? "edit" : "preview");
    } else if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
    } else if (e.target.id === "find-input" && e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape" && find.open) {
      e.preventDefault();
      closeFind();
    }
  });
  $("#find-input").addEventListener("input", () => runFind(true));
  window.addEventListener("resize", syncScroll);

  const m = mx();
  m.events?.subscribe?.("file.changed", (e) => {
    if (matchesFile(e?.path, e?.projectPath)) onDiskChange();
  });
  m.onDataChange?.((data) => {
    if (data?.filePath && data.filePath === ed.path) setMode(data.mode === "preview" ? "preview" : "edit", data.line);
  });
  // Status from the sidebar, and running clocks, while the preview shows.
  setInterval(() => {
    if (ed.mode === "preview" && document.visibilityState === "visible") loadInfo();
  }, 2000);
  setInterval(applyElapsed, 500);
  m.onFocus?.((focused) => {
    if (focused !== false) takeGoto();
  });
  m.lifecycle?.onBeforeClose?.(() => {
    if (!dirty()) return false;
    setTimeout(askBeforeClose, 0);
    return true;
  });
  const applyScheme = (theme) => {
    if (theme?.colorScheme) document.documentElement.style.colorScheme = theme.colorScheme;
  };
  applyScheme(m.theme);
  m.onThemeChange?.(applyScheme);
}

function waitForMuxy(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.muxy) return resolve(window.muxy);
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (window.muxy) {
        clearInterval(timer);
        resolve(window.muxy);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(timer);
        reject(new Error("The Muxy API isn't available"));
      }
    }, 25);
  });
}

async function init() {
  $("#ed-whale").innerHTML = icon("whale");
  $("#find-btn").innerHTML = icon("search");
  $("#find-icon").innerHTML = icon("search");
  $("#find-prev").innerHTML = icon("chevron-up");
  $("#find-next").innerHTML = icon("chevron-down");
  $("#find-close").innerHTML = icon("x");
  $("#save-btn").title = `Save (${isMac ? "⌘S" : "Ctrl+S"})`;
  $("#find-btn").title = `Find (${isMac ? "⌘F" : "Ctrl+F"})`;
  mountEditor();
  let m;
  try {
    m = await waitForMuxy();
  } catch (e) {
    ed.loadError = e.message;
    return renderAll();
  }
  m.tabs?.setIcon?.({ svg: "assets/docker-color.svg" })?.catch?.((e) => console.warn("[docker] couldn't set the tab icon:", e?.message || e));
  bind();
  ed.path = String(m.data?.filePath || "");
  ed.key = String(m.data?.key || "");
  renderAll();
  await Promise.all([loadFile(), loadInfo()]);
  setMode(m.data?.mode === "preview" ? "preview" : "edit", m.data?.line);
}

init().catch((e) => console.error("[docker] editor failed to start:", e?.stack || e));
