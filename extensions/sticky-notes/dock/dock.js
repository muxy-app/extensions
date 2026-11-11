// Sticky Notes: one frameless, click-through panel over the whole window.
//
// - Each note is a colored ribbon on a window edge (right by default; the
//   settings move it to any edge, at its start, middle, or end).
// - An invisible strip over the ribbons, wider than they are, takes the
//   pointer: ribbons swell toward it like the macOS Dock, a label names the
//   one under it, and a click anywhere on the strip opens the nearest note.
// - Esc, the tuck button, or clicking anywhere else in Muxy puts it away.
// - The panel hears the pointer only over the strip, the open note, the
//   settings, and the undo toast, so nothing waits for the pointer to leave.
//
// Notes live in storage under "note:<id>" as
// { title, text, color, project, createdAt, updatedAt }, and the settings
// under "settings" as { side, align, size }.

const PREFIX = "note:";
const MAX_NOTES = 64;
const PALETTE = {
  yellow: { paper: "#fbe490", tab: "#f0cb45" },
  orange: { paper: "#fdd6ae", tab: "#f4a35c" },
  pink:   { paper: "#fbd2df", tab: "#ec88ad" },
  purple: { paper: "#e2d9fc", tab: "#a690f0" },
  blue:   { paper: "#cfe1fb", tab: "#78aaec" },
  green:  { paper: "#cdeed5", tab: "#74c98f" },
};
const ORDER = Object.keys(PALETTE);

// Ribbon sizes. idle/active/max: how far a ribbon shows at rest, for the open
// note, and right under the pointer. len: its length along the edge. touch:
// how deep the strip that takes the pointer reaches into the window.
const SIZES = {
  slim:    { idle: 6,  active: 12, max: 20, len: 28, touch: 26 },
  regular: { idle: 10, active: 16, max: 26, len: 36, touch: 36 },
  large:   { idle: 14, active: 21, max: 32, len: 46, touch: 46 },
};
const SIDES = ["right", "left", "top", "bottom"];
const ALIGNS = ["start", "center", "end"];
const DEFAULTS = { side: "right", align: "center", size: "regular" };

const TUCK = 12;        // how far a ribbon runs past the window edge
const EL = 64;          // a ribbon element's depth; enough for max + TUCK
const GAP = 4;          // between ribbons
const HALO = 18;        // margin around the strip that notices the pointer leaving
const CARD_W = 300;
const CARD_MIN_H = 168;
const CARD_MAX_H = 460;
const CARD_GAP = 10;    // between the ribbons and what opens beside them
const MARGIN = 12;

const $ = (id) => document.getElementById(id);
const ribbons = $("ribbons");
const spine = $("spine");
const tip = $("tip");
const card = $("card");
const content = $("content");
const titleEl = $("title");
const textEl = $("text");
const footer = $("footer");
const swatches = $("swatches");
const scopeBtn = $("scope");
const whenEl = $("when");
const prefs = $("prefs");
const toast = $("toast");

let settings = { ...DEFAULTS };
let S = SIZES.regular;
let notes = [];            // every note, oldest first
let visible = [];          // the ones shown in this project
const tabs = new Map();    // id -> ribbon { id, el, glyph, center }
let addTab = null;
let openId = null;
const drafts = new Set();  // new notes not yet worth keeping
let pointerA = null;       // pointer position along the edge, while on the strip
let project = null;        // { id, name } of the active project, when known
let strip = { start: 0, total: 0, len: 0 };
let cardAnim = null;
let cardToken = 0;
let prefsAnim = null;
let prefsToken = 0;
let moveToken = 0;
const stage = $("stage");
let bounds = { width: window.innerWidth, height: window.innerHeight }; // the window, once known
let origin = { x: 0, y: 0 }; // where the panel's top left corner sits in the window
let W = window.innerWidth;  // the window's size, not the panel's
let H = window.innerHeight;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const byId = (id) => notes.find((n) => n.id === id);

// ---- Edges ----
// Layout works in two numbers: "along" the edge, and "out" from it into the
// window. These turn them into page coordinates for the current side.

const vertical = () => settings.side === "left" || settings.side === "right";
const edgeLength = () => (vertical() ? H : W);

function rectAt(a, len, o, depth) {
  switch (settings.side) {
    case "left":   return { x: o, y: a, w: depth, h: len };
    case "top":    return { x: a, y: o, w: len, h: depth };
    case "bottom": return { x: a, y: H - o - depth, w: len, h: depth };
    default:       return { x: W - o - depth, y: a, w: depth, h: len };
  }
}

function place(el, r) {
  el.style.left = `${Math.round(r.x)}px`;
  el.style.top = `${Math.round(r.y)}px`;
  el.style.width = `${Math.round(r.w)}px`;
  el.style.height = `${Math.round(r.h)}px`;
}

// A shift of d pixels toward the edge, as a `transform` and as a `translate`.
function towardEdge(d) {
  switch (settings.side) {
    case "left":   return `translateX(${-d}px)`;
    case "top":    return `translateY(${-d}px)`;
    case "bottom": return `translateY(${d}px)`;
    default:       return `translateX(${d}px)`;
  }
}
function towardEdgeT(d) {
  switch (settings.side) {
    case "left":   return `${-d}px 0`;
    case "top":    return `0 ${-d}px`;
    case "bottom": return `0 ${d}px`;
    default:       return `${d}px 0`;
  }
}

function alongOf(x, y) {
  return vertical() ? y : x;
}
function depthOf(x, y) {
  switch (settings.side) {
    case "left":   return x;
    case "top":    return y;
    case "bottom": return H - y;
    default:       return W - x;
  }
}

// The point on the ribbons' inner edge at a position along it.
function edgePoint(a) {
  switch (settings.side) {
    case "left":   return { x: S.max, y: a };
    case "top":    return { x: a, y: S.max };
    case "bottom": return { x: a, y: H - S.max };
    default:       return { x: W - S.max, y: a };
  }
}

// Puts an element beside the ribbons, centered on a position along the edge.
function placeBeside(el, a, gap) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const o = S.max + gap;
  let x;
  let y;
  switch (settings.side) {
    case "left":   x = o; y = a - h / 2; break;
    case "top":    x = a - w / 2; y = o; break;
    case "bottom": x = a - w / 2; y = H - o - h; break;
    default:       x = W - o - w; y = a - h / 2;
  }
  x = clamp(x, MARGIN, Math.max(MARGIN, W - w - MARGIN));
  y = clamp(y, MARGIN, Math.max(MARGIN, H - h - MARGIN));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  const p = edgePoint(a);
  el.style.transformOrigin = `${Math.round(p.x - x)}px ${Math.round(p.y - y)}px`;
}

// ---- Storage ----

const saveTimers = new Map();

function writeNote(note) {
  clearTimeout(saveTimers.get(note.id));
  saveTimers.delete(note.id);
  const { id, frame, ...data } = note;
  return Promise.resolve(muxy.storage.set(PREFIX + id, data))
    .catch((e) => console.error("Save failed:", e && e.message));
}

function scheduleSave(note) {
  note.updatedAt = Date.now();
  clearTimeout(saveTimers.get(note.id));
  saveTimers.set(note.id, setTimeout(() => writeNote(note), 300));
}

function flushSaves() {
  return Promise.all([...saveTimers.keys()].map((id) => {
    const note = byId(id);
    return note ? writeNote(note) : null;
  }));
}

async function readNotes() {
  const keys = ((await muxy.storage.keys()) || []).filter((k) => k.startsWith(PREFIX));
  const loaded = await Promise.all(keys.map(async (k) => {
    const stored = await muxy.storage.get(k);
    if (!stored || typeof stored !== "object") return null;
    return {
      title: "", text: "", color: "yellow", project: null, createdAt: 0, updatedAt: 0,
      ...stored,
      id: k.slice(PREFIX.length),
    };
  }));
  return loaded.filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function readSettings() {
  try {
    const s = (await muxy.storage.get("settings")) || {};
    return {
      side: SIDES.includes(s.side) ? s.side : DEFAULTS.side,
      align: ALIGNS.includes(s.align) ? s.align : DEFAULTS.align,
      size: SIZES[s.size] ? s.size : DEFAULTS.size,
    };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function newID() {
  return "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

// ---- Words ----

function firstLine(text) {
  return ((text || "").split("\n").find((l) => l.trim()) || "").trim();
}

function nameOf(note) {
  return (note.title || "").trim() || firstLine(note.text) || "Untitled";
}

function snippetOf(note) {
  const lines = (note.text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!(note.title || "").trim()) lines.shift();
  const open = lines.filter((l) => l.startsWith("☐")).length;
  const done = lines.filter((l) => l.startsWith("☑")).length;
  if (open + done > 0) return `${done} of ${open + done} done`;
  return lines[0] || "";
}

function ago(t) {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "Edited just now";
  if (s < 3600) return `Edited ${Math.round(s / 60)}m ago`;
  if (s < 86400) return `Edited ${Math.round(s / 3600)}h ago`;
  return "Edited " + new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---- Ribbons ----

function colorOf(note) {
  return PALETTE[note.color] ? note.color : "yellow";
}

function paintTab(note) {
  const t = tabs.get(note.id);
  if (!t) return;
  t.el.style.setProperty("--tab", PALETTE[colorOf(note)].tab);
  t.glyph.textContent = nameOf(note).charAt(0).toUpperCase();
}

function makeTab(id, isAdd) {
  const el = document.createElement("div");
  el.className = isAdd ? "tab add" : "tab";
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  el.appendChild(glyph);
  ribbons.appendChild(el);
  return { id, el, glyph, center: 0 };
}

function items() {
  return [...visible.map((n) => tabs.get(n.id)), addTab].filter(Boolean);
}

// Rebuilds the ribbons for the notes shown in this project. Ribbons that come
// or go slide in or out of the edge.
function syncTabs() {
  visible = notes.filter((n) => !n.project || (project && n.project === project.id));
  const ids = new Set(visible.map((n) => n.id));
  for (const [id, t] of tabs) {
    if (ids.has(id)) continue;
    tabs.delete(id);
    const a = t.el.animate(
      [{ translate: "0 0", opacity: 1 }, { translate: towardEdgeT(18), opacity: 0 }],
      { duration: 160, easing: "ease-in", fill: "forwards" }
    );
    a.onfinish = () => t.el.remove();
  }
  for (const note of visible) {
    if (tabs.has(note.id)) continue;
    const t = makeTab(note.id, false);
    tabs.set(note.id, t);
    t.el.animate(
      [{ translate: towardEdgeT(20) }, { translate: "0 0" }],
      { duration: 260, easing: "cubic-bezier(.2,.9,.25,1.15)" }
    );
  }
  for (const note of visible) paintTab(note);
  if (!addTab) {
    addTab = makeTab(null, true);
    addTab.glyph.textContent = "+";
  }
  if (openId && !ids.has(openId)) closeCard();
  if (menuFor && !ids.has(menuFor)) closeMenu();
}

function layout() {
  W = bounds.width;
  H = bounds.height;
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  document.body.dataset.side = settings.side;
  document.body.style.setProperty("--gmax", `${S.max}px`);

  const list = items();
  const count = list.length;
  const L = edgeLength();
  const margin = vertical() ? 52 : 84;
  const avail = Math.max(60, L - margin * 2);
  const len = clamp(Math.floor((avail - (count - 1) * GAP) / count), 10, S.len);
  const total = count * len + (count - 1) * GAP;
  let start;
  if (settings.align === "start") start = margin;
  else if (settings.align === "end") start = L - margin - total;
  else start = (L - total) / 2;
  start = Math.round(clamp(start, margin, Math.max(margin, L - margin - total)));
  strip = { start, total, len };

  place(spine, rectAt(start - HALO, total + HALO * 2, 0, S.touch + HALO));
  list.forEach((t, i) => {
    const a = start + i * (len + GAP);
    place(t.el, rectAt(a, len, -TUCK, EL));
    t.center = a + len / 2;
    t.showGlyph = len >= 18;
  });

  swell();
  placeCard();
  if (prefs.classList.contains("show")) placePrefs();
  if (menuFor && tabs.has(menuFor)) placeBeside(menu, tabs.get(menuFor).center, CARD_GAP);
  if (toast.classList.contains("show") && addTab) placeBeside(toast, addTab.center, CARD_GAP);
  fitFrame();
}

// Sizes each ribbon: the open note's sticks out a little, and ribbons near the
// pointer swell like the macOS Dock.
function swell() {
  let nearest = null;
  let nearestD = Infinity;
  for (const t of items()) {
    let v = t.id && (t.id === openId || t.id === menuFor) ? S.active : S.idle;
    if (pointerA != null) {
      const d = pointerA - t.center;
      const g = Math.exp(-((d / (S.len * 0.95)) ** 2));
      v = Math.max(v, S.idle + (S.max - S.idle) * g);
      if (Math.abs(d) < nearestD) {
        nearestD = Math.abs(d);
        nearest = t;
      }
    }
    t.el.style.transform = towardEdge(EL - TUCK - v);
    t.glyph.style.opacity = t.showGlyph ? String(clamp((v - S.max + 7) / 6, 0, 1)) : "0";
  }
  showTip(nearest && nearestD <= strip.len / 2 + GAP ? nearest : null);
}

function showTip(t) {
  const busy = prefs.classList.contains("show") || menuFor != null;
  if (!t || busy || (t.id && t.id === openId)) {
    tip.classList.remove("show");
    return;
  }
  const [b, s] = tip.children;
  if (t.id) {
    const note = byId(t.id);
    b.textContent = note ? nameOf(note) : "";
    s.textContent = note ? snippetOf(note) : "";
  } else {
    b.innerHTML = "New note<kbd>⌃⌥N</kbd>";
    s.textContent = "Right-click for settings";
  }
  placeBeside(tip, t.center, 8);
  tip.classList.add("show");
}

function setPointer(a) {
  if (pointerA === a) return;
  pointerA = a;
  swell();
}

function itemAt(a) {
  let best = null;
  let bestD = Infinity;
  for (const t of items()) {
    const d = Math.abs(a - t.center);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best && bestD <= strip.len / 2 + GAP ? best : null;
}

// Where a mouse event happened, in the window rather than the panel.
const at = (e) => [e.clientX + origin.x, e.clientY + origin.y];

spine.addEventListener("mousemove", (e) => {
  // The strip over the ribbons counts; the margin around it means leaving.
  const onStrip = depthOf(...at(e)) <= S.touch;
  setPointer(onStrip ? alongOf(...at(e)) : null);
});
spine.addEventListener("mouseleave", () => setPointer(null));
spine.addEventListener("mousedown", (e) => {
  e.preventDefault(); // keep focus where it is; we move it ourselves
  if (e.button !== 0) return;
  const t = depthOf(...at(e)) <= S.touch ? itemAt(alongOf(...at(e))) : null;
  if (!t) {
    closeAll();
    return;
  }
  closePrefs();
  closeMenu();
  if (!t.id) newNote();
  else if (openId === t.id) closeCard();
  else openNote(t.id);
});
// Right-click: a note's ribbon offers a menu for that note; + and the space
// around the ribbons open the settings.
spine.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const t = depthOf(...at(e)) <= S.touch ? itemAt(alongOf(...at(e))) : null;
  if (t && t.id) {
    if (menuFor === t.id) closeMenu();
    else openMenu(t);
  } else if (prefs.classList.contains("show")) {
    closePrefs();
  } else {
    openPrefs();
  }
});

// ---- The ribbon menu ----

const menu = $("menu");
const menuColors = $("menu-colors");
let menuFor = null;
let menuAnim = null;
let menuToken = 0;

for (const name of ORDER) {
  const b = document.createElement("button");
  b.className = "swatch";
  b.dataset.color = name;
  b.title = name[0].toUpperCase() + name.slice(1);
  b.style.background = PALETTE[name].tab;
  b.addEventListener("click", () => {
    const note = byId(menuFor);
    if (!note) return;
    note.color = name;
    paintTab(note);
    scheduleSave(note);
    paintMenu(note);
  });
  menuColors.appendChild(b);
}

function paintMenu(note) {
  $("menu-title").textContent = nameOf(note);
  for (const b of menuColors.children) b.setAttribute("aria-pressed", String(b.dataset.color === colorOf(note)));
}

function openMenu(t) {
  const note = byId(t.id);
  if (!note) return;
  closeCard();
  closePrefs();
  menuFor = t.id;
  paintMenu(note);
  const token = ++menuToken;
  menu.classList.add("show");
  placeBeside(menu, t.center, CARD_GAP);
  swell();
  if (menuAnim) menuAnim.cancel();
  menuAnim = menu.animate(
    [{ opacity: 0, transform: `${towardEdge(12)} scale(.94)` }, { opacity: 1, transform: "none" }],
    { duration: 200, easing: "cubic-bezier(.2,.9,.25,1.06)" }
  );
  menuAnim.onfinish = () => { if (token === menuToken) menuAnim = null; };
  if (muxy.panel) Promise.resolve(muxy.panel.raise()).catch(() => {});
  menu.focus({ preventScroll: true }); // so Esc and clicking elsewhere close it
}

function closeMenu() {
  if (!menuFor) return;
  menuFor = null;
  swell();
  const token = ++menuToken;
  if (menuAnim) menuAnim.cancel();
  menuAnim = menu.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `${towardEdge(8)} scale(.97)` }],
    { duration: 120, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }
  );
  menuAnim.onfinish = () => {
    if (token !== menuToken) return;
    menu.classList.remove("show");
    menuAnim.cancel();
    menuAnim = null;
  };
}

$("menu-open").addEventListener("click", () => {
  const id = menuFor;
  closeMenu();
  if (id) openNote(id);
});
$("menu-settings").addEventListener("click", () => {
  closeMenu();
  openPrefs();
});
$("menu-delete").addEventListener("click", () => {
  const id = menuFor;
  closeMenu();
  if (id) deleteNote(id);
});
menu.addEventListener("keydown", (e) => {
  if ((e.key === "Backspace" || e.key === "Delete") && menuFor) {
    e.preventDefault();
    const id = menuFor;
    closeMenu();
    deleteNote(id);
  } else if (e.key === "Enter" && menuFor) {
    e.preventDefault();
    $("menu-open").click();
  }
});

// ---- The open note ----

function placeCard() {
  if (!openId) return;
  const t = tabs.get(openId);
  if (!t) return;
  const h = parseFloat(card.style.height) || CARD_MIN_H;
  const o = S.max + CARD_GAP;
  let x;
  let y;
  if (vertical()) {
    y = clamp(Math.round(t.center - 26), MARGIN, Math.max(MARGIN, H - h - MARGIN));
    x = settings.side === "left" ? o : W - o - CARD_W;
  } else {
    x = clamp(Math.round(t.center - CARD_W / 2), MARGIN, Math.max(MARGIN, W - CARD_W - MARGIN));
    y = settings.side === "top" ? o : H - o - h;
  }
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  const p = edgePoint(t.center);
  card.style.transformOrigin = `${Math.round(p.x - x)}px ${Math.round(p.y - y)}px`;
}

function cardMaxH() {
  const room = vertical() ? H - MARGIN * 2 : H - S.max - CARD_GAP - MARGIN * 2;
  return Math.max(CARD_MIN_H, Math.min(CARD_MAX_H, room));
}

// Grows the note to fit its text, up to a limit; past that the text scrolls.
function fitCard() {
  textEl.style.flex = "none";
  textEl.style.height = "0px";
  const textH = textEl.scrollHeight;
  textEl.style.flex = "";
  textEl.style.height = "";
  const chrome = card.offsetHeight - textEl.offsetHeight || 84;
  const h = clamp(Math.ceil(textH + chrome), CARD_MIN_H, cardMaxH());
  if (Math.abs((parseFloat(card.style.height) || 0) - h) > 1) {
    card.style.height = `${h}px`;
    placeCard();
  }
}

function paintCard(note) {
  const c = PALETTE[colorOf(note)];
  card.style.setProperty("--paper", c.paper);
  card.style.setProperty("--tab", c.tab);
  for (const b of swatches.children) b.setAttribute("aria-pressed", String(b.dataset.color === colorOf(note)));
}

function paintScope(note) {
  if (!project) {
    scopeBtn.hidden = true;
    return;
  }
  scopeBtn.hidden = false;
  const here = note.project && note.project === project.id;
  scopeBtn.title = here
    ? "Shown only in this project. Click to show it everywhere."
    : "Shown in every project. Click to keep it to this one.";
  scopeBtn.innerHTML = here
    ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z"/></svg><span></span>'
    : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.8"/><path d="M2.4 8h11.2M8 2.2c1.8 1.7 2.6 3.6 2.6 5.8S9.8 12.1 8 13.8C6.2 12.1 5.4 10.2 5.4 8S6.2 3.9 8 2.2z"/></svg><span></span>';
  scopeBtn.lastChild.textContent = here ? project.name : "Everywhere";
}

function fill(note) {
  titleEl.value = note.title || "";
  textEl.value = note.text || "";
  textEl.scrollTop = 0;
  whenEl.textContent = ago(note.updatedAt);
  footer.classList.remove("picking");
  paintCard(note);
  paintScope(note);
}

function focusNote(note, where) {
  if (where === "title" || (!note.title && !note.text)) {
    titleEl.focus();
  } else {
    textEl.focus();
    const end = textEl.value.length;
    textEl.setSelectionRange(end, end);
  }
}

// Leaving a note: save it, or drop it if it's new and still empty.
function leaveNote(id) {
  const note = byId(id);
  if (!note) return;
  if (drafts.has(id)) {
    drafts.delete(id);
    if (!note.title.trim() && !note.text.trim()) {
      removeNote(id);
      return;
    }
  }
  if (saveTimers.has(id)) writeNote(note);
}

function openNote(id, { focus = "text", dir = 0 } = {}) {
  const note = byId(id);
  if (!note || !tabs.has(id)) return;
  closePrefs();
  closeMenu();
  const wasOpen = openId != null;
  const prev = openId;
  openId = id; // first, so dropping an empty draft below can't close the card
  cardToken++;
  if (prev && prev !== id) {
    leaveNote(prev);
    if (!byId(id)) return;
  }

  fill(note);
  card.classList.add("show");
  if (!wasOpen) card.style.height = `${CARD_MIN_H}px`;
  fitCard();
  if (!wasOpen) card.classList.add("instant");
  placeCard();
  if (!wasOpen) {
    void card.offsetWidth;
    card.classList.remove("instant");
  }
  swell();

  if (cardAnim) cardAnim.cancel();
  if (!wasOpen) {
    cardAnim = card.animate(
      [
        { opacity: 0, transform: `${towardEdge(22)} scale(.9)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 260, easing: "cubic-bezier(.2,.9,.25,1.08)" }
    );
  } else if (prev !== id) {
    const order = (x) => visible.findIndex((n) => n.id === x);
    const from = dir || (order(id) > order(prev) ? 1 : -1);
    const shift = vertical() ? `translateY(${from * 10}px)` : `translateX(${from * 12}px)`;
    content.animate(
      [{ opacity: 0, transform: shift }, { opacity: 1, transform: "none" }],
      { duration: 200, easing: "cubic-bezier(.2,.9,.25,1)" }
    );
  }

  if (muxy.panel) Promise.resolve(muxy.panel.raise()).catch(() => {});
  focusNote(note, focus);
}

function closeCard() {
  if (!openId) return;
  const id = openId;
  openId = null;
  const token = ++cardToken;
  footer.classList.remove("picking");
  if (card.contains(document.activeElement)) document.activeElement.blur();
  leaveNote(id);
  swell();

  if (cardAnim) cardAnim.cancel();
  cardAnim = card.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: `${towardEdge(16)} scale(.95)` },
    ],
    { duration: 150, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }
  );
  cardAnim.onfinish = () => {
    if (token !== cardToken) return;
    card.classList.remove("show");
    cardAnim.cancel();
    cardAnim = null;
  };
}

function step(delta) {
  if (!openId || visible.length < 2) return;
  const i = visible.findIndex((n) => n.id === openId);
  const next = visible[(i + delta + visible.length) % visible.length];
  openNote(next.id, { dir: delta });
}

// ---- Editing ----

titleEl.addEventListener("input", () => {
  const note = byId(openId);
  if (!note) return;
  note.title = titleEl.value;
  paintTab(note);
  scheduleSave(note);
});
titleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || (e.key === "ArrowDown" && !e.altKey)) {
    e.preventDefault();
    textEl.focus();
    textEl.setSelectionRange(0, 0);
  }
});

function insert(text) {
  // execCommand keeps the edit on the textarea's undo stack.
  if (!document.execCommand("insertText", false, text)) {
    textEl.setRangeText(text, textEl.selectionStart, textEl.selectionEnd, "end");
    textEl.dispatchEvent(new Event("input"));
  }
}

function lineStartAt(pos) {
  return textEl.value.lastIndexOf("\n", pos - 1) + 1;
}

textEl.addEventListener("input", () => {
  const note = byId(openId);
  if (!note) return;
  // "[] " or "[ ] " at the start of a line becomes a checkbox.
  const pos = textEl.selectionStart;
  const start = lineStartAt(pos);
  const m = /^(\s*)\[ ?\] $/.exec(textEl.value.slice(start, pos));
  if (m && textEl.selectionEnd === pos) {
    textEl.setSelectionRange(start + m[1].length, pos);
    insert("☐ ");
    return; // insert() fires input again
  }
  note.text = textEl.value;
  paintTab(note);
  scheduleSave(note);
  fitCard();
});

textEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.isComposing) return;
  const pos = textEl.selectionStart;
  if (pos !== textEl.selectionEnd) return;
  const start = lineStartAt(pos);
  const line = textEl.value.slice(start, pos);
  const m = /^(\s*)(☐ |☑ |- |• |\* |(\d+)\. )/.exec(line);
  if (!m) return;
  e.preventDefault();
  if (line.length === m[0].length) {
    // An empty item ends the list.
    textEl.setSelectionRange(start, pos);
    if (!document.execCommand("delete")) {
      textEl.setRangeText("", start, pos, "end");
      textEl.dispatchEvent(new Event("input"));
    }
    return;
  }
  let marker = m[2];
  if (marker === "☑ ") marker = "☐ ";
  if (m[3]) marker = `${Number(m[3]) + 1}. `;
  insert("\n" + m[1] + marker);
});

// Clicking a checkbox ticks it.
textEl.addEventListener("mouseup", () => {
  const pos = textEl.selectionStart;
  if (pos !== textEl.selectionEnd) return;
  const start = lineStartAt(pos);
  const m = /^(\s*)([☐☑])/.exec(textEl.value.slice(start));
  if (!m) return;
  const box = start + m[1].length;
  if (pos < box || pos > box + 1) return;
  textEl.setSelectionRange(box, box + 1);
  insert(m[2] === "☐" ? "☑" : "☐");
  const after = Math.min(textEl.value.length, box + 2);
  textEl.setSelectionRange(after, after);
});

$("tuck").addEventListener("click", () => closeCard());

// Colors: the dot opens the swatches in place.
for (const name of ORDER) {
  const b = document.createElement("button");
  b.className = "swatch";
  b.dataset.color = name;
  b.title = name[0].toUpperCase() + name.slice(1);
  b.style.background = PALETTE[name].tab;
  b.addEventListener("click", () => {
    const note = byId(openId);
    if (!note) return;
    note.color = name;
    paintCard(note);
    paintTab(note);
    scheduleSave(note);
    footer.classList.remove("picking");
  });
  swatches.appendChild(b);
}
$("color").addEventListener("click", () => footer.classList.toggle("picking"));

scopeBtn.addEventListener("click", () => {
  const note = byId(openId);
  if (!note || !project) return;
  note.project = note.project === project.id ? null : project.id;
  paintScope(note);
  scheduleSave(note);
});

// ---- Adding and deleting ----

function nextColor() {
  const last = notes[notes.length - 1];
  return last ? ORDER[(ORDER.indexOf(colorOf(last)) + 1) % ORDER.length] : ORDER[0];
}

function newNote() {
  if (notes.length >= MAX_NOTES) {
    console.warn(`Sticky Notes: limit of ${MAX_NOTES} notes reached.`);
    return;
  }
  const now = Date.now();
  const note = { id: newID(), title: "", text: "", color: nextColor(), project: null, createdAt: now, updatedAt: now };
  notes.push(note);
  drafts.add(note.id);
  syncTabs();
  layout();
  openNote(note.id, { focus: "title" });
}

function removeNote(id) {
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
  drafts.delete(id);
  notes = notes.filter((n) => n.id !== id);
  Promise.resolve(muxy.storage.delete(PREFIX + id)).catch((e) => console.error("Delete failed:", e && e.message));
  syncTabs();
  layout();
}

let toastTimer = null;
let toastAnim = null;
let lastDeleted = null;

function hideToast() {
  clearTimeout(toastTimer);
  if (!toast.classList.contains("show")) return;
  if (toastAnim) toastAnim.cancel();
  toastAnim = toast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
  toastAnim.onfinish = () => {
    toast.classList.remove("show");
    toastAnim.cancel();
  };
}

function showToast(text) {
  clearTimeout(toastTimer);
  if (toastAnim) toastAnim.cancel();
  $("toast-text").textContent = text;
  toast.classList.add("show");
  placeBeside(toast, addTab ? addTab.center : edgeLength() / 2, CARD_GAP);
  toastAnim = toast.animate(
    [{ opacity: 0, transform: `${towardEdge(10)} scale(.96)` }, { opacity: 1, transform: "none" }],
    { duration: 200, easing: "cubic-bezier(.2,.9,.25,1)" }
  );
  toastTimer = setTimeout(hideToast, 5000);
}

// Deletes a note at once, with Undo for a few seconds.
function deleteNote(id) {
  const note = byId(id);
  if (!note) return;
  const worthUndo = !drafts.has(id) || note.title.trim() || note.text.trim();
  lastDeleted = { ...note };
  removeNote(id); // also puts its card away, since its ribbon is gone
  if (openId === id) closeCard();
  if (worthUndo) showToast(`Deleted “${nameOf(lastDeleted)}”`.slice(0, 48));
}

$("trash").addEventListener("click", () => deleteNote(openId));

$("undo").addEventListener("click", () => {
  hideToast();
  if (!lastDeleted || byId(lastDeleted.id)) return;
  const note = lastDeleted;
  lastDeleted = null;
  notes.push(note);
  notes.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  writeNote(note);
  syncTabs();
  layout();
  openNote(note.id);
});

// ---- Settings ----

const screen = $("screen");
const ALONG_PCT = { start: 0.28, center: 0.55, end: 0.82 };   // on the left/right edges
const ACROSS_PCT = { start: 0.2, center: 0.5, end: 0.8 };     // on the top/bottom edges

for (const side of SIDES) {
  for (const align of ALIGNS) {
    const b = document.createElement("button");
    const v = side === "left" || side === "right";
    b.className = `spot ${v ? "v" : "h"}`;
    b.dataset.side = side;
    b.dataset.align = align;
    b.title = `${{ start: v ? "Top" : "Left", center: "Middle", end: v ? "Bottom" : "Right" }[align]} of the ${side} edge`;
    b.appendChild(document.createElement("i"));
    if (v) {
      Object.assign(b.style, { width: "18px", height: "32px", top: `calc(${ALONG_PCT[align] * 100}% - 16px)` });
      b.style[side] = "2px";
    } else {
      Object.assign(b.style, { width: "32px", height: "18px", left: `calc(${ACROSS_PCT[align] * 100}% - 16px)` });
      b.style[side] = side === "top" ? "15px" : "2px";
    }
    b.addEventListener("click", () => applySettings({ side, align }));
    screen.appendChild(b);
  }
}
for (const b of $("sizes").children) {
  b.addEventListener("click", () => applySettings({ size: b.dataset.size }));
}

function paintPrefs() {
  for (const b of screen.children) {
    b.setAttribute("aria-pressed", String(b.dataset.side === settings.side && b.dataset.align === settings.align));
  }
  for (const b of $("sizes").children) b.setAttribute("aria-pressed", String(b.dataset.size === settings.size));
}

function placePrefs() {
  placeBeside(prefs, strip.start + strip.total / 2, CARD_GAP);
}

function openPrefs() {
  closeCard();
  closeMenu();
  setPointer(null);
  paintPrefs();
  const token = ++prefsToken;
  prefs.classList.add("show", "instant");
  placePrefs();
  void prefs.offsetWidth;
  prefs.classList.remove("instant");
  if (prefsAnim) prefsAnim.cancel();
  prefsAnim = prefs.animate(
    [{ opacity: 0, transform: `${towardEdge(18)} scale(.94)` }, { opacity: 1, transform: "none" }],
    { duration: 240, easing: "cubic-bezier(.2,.9,.25,1.06)" }
  );
  prefsAnim.onfinish = () => { if (token === prefsToken) prefsAnim = null; };
  if (muxy.panel) Promise.resolve(muxy.panel.raise()).catch(() => {});
  prefs.focus({ preventScroll: true }); // so Esc and clicking elsewhere close it
}

function closePrefs() {
  if (!prefs.classList.contains("show")) return;
  const token = ++prefsToken;
  if (prefsAnim) prefsAnim.cancel();
  prefsAnim = prefs.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `${towardEdge(12)} scale(.96)` }],
    { duration: 140, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }
  );
  prefsAnim.onfinish = () => {
    if (token !== prefsToken) return;
    prefs.classList.remove("show");
    prefsAnim.cancel();
    prefsAnim = null;
  };
}

$("prefs-close").addEventListener("click", () => closePrefs());

async function applySettings(change) {
  const next = { ...settings, ...change };
  const moved = next.side !== settings.side || next.align !== settings.align;
  if (!moved && next.size === settings.size) return;
  const token = ++moveToken;
  Promise.resolve(muxy.storage.set("settings", next)).catch((e) => console.error("Couldn't save settings:", e && e.message));
  closeCard();
  setPointer(null);

  if (!moved) {
    settings = next;
    S = SIZES[settings.size];
    paintPrefs();
    layout();
    return;
  }

  // The ribbons slip into the old edge, then come out of the new one.
  for (const b of screen.children) {
    b.setAttribute("aria-pressed", String(b.dataset.side === next.side && b.dataset.align === next.align));
  }
  const list = items();
  await Promise.all(list.map((t, i) => t.el.animate(
    [{ translate: "0 0", opacity: 1 }, { translate: towardEdgeT(S.max + TUCK), opacity: 0 }],
    { duration: 130, delay: i * 10, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }
  ).finished.catch(() => {})));
  if (token !== moveToken) return; // a newer choice took over

  settings = next;
  S = SIZES[settings.size];
  paintPrefs();
  ribbons.classList.add("instant");
  layout();
  void ribbons.offsetWidth;
  ribbons.classList.remove("instant");
  items().forEach((t, i) => {
    t.el.getAnimations().forEach((a) => a.cancel());
    t.el.animate(
      [{ translate: towardEdgeT(S.max + TUCK), opacity: 0 }, { translate: "0 0", opacity: 1 }],
      { duration: 300, delay: i * 18, easing: "cubic-bezier(.2,.9,.25,1.12)", fill: "backwards" }
    );
  });
}

// ---- Putting things away ----

// After a command opens something (often from a shortcut pressed in a
// terminal), the keyboard still belongs to the terminal, and Muxy hands it back
// there when the keys come up. For a short while, keep asking for it until it
// sticks, and don't treat losing it as a click elsewhere.
//
// muxy.focused says where Muxy sends the keys; document.hasFocus() can be true
// while they still go to the terminal. raise() only reorders panels; opening
// the panel again is what moves the keyboard into it.
const CLAIM_MS = 2500;
let claimUntil = 0;
let claimTimer = null;

function claimTarget() {
  if (openId) return card.contains(document.activeElement) ? document.activeElement : (titleEl.value || textEl.value ? textEl : titleEl);
  if (menuFor) return menu;
  if (prefs.classList.contains("show")) return prefs;
  return null;
}

function claiming() {
  return Date.now() < claimUntil;
}

function claimFocus() {
  claimUntil = Date.now() + CLAIM_MS;
  clearTimeout(claimTimer);
  pulse();
}

function stopClaim() {
  claimUntil = 0;
  clearTimeout(claimTimer);
}

let lastRequest = 0;
function requestFocus() {
  if (Date.now() - lastRequest < 120) return;
  lastRequest = Date.now();
  Promise.resolve(muxy.panels.open("dock", {}, {}))
    .catch((e) => console.warn("Couldn't take the keyboard:", e && e.message));
}

function pulse() {
  if (!claiming()) return;
  const el = claimTarget();
  if (!el) {
    stopClaim();
    return;
  }
  if (!muxy.focused) requestFocus();
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  claimTimer = setTimeout(pulse, 150);
}

if (muxy.onFocus) {
  muxy.onFocus((focused) => {
    if (!focused && claiming()) {
      clearTimeout(claimTimer);
      claimTimer = setTimeout(pulse, 30);
    }
  });
}

// Typing or clicking here means focus has arrived.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return; // still the shortcut
  if (claiming() && muxy.focused) stopClaim();
}, true);
document.addEventListener("mousedown", () => stopClaim(), true);

function closeAll(fromFocusLoss = false) {
  if (fromFocusLoss && claiming()) return;
  stopClaim();
  closeCard();
  closePrefs();
  closeMenu();
  setPointer(null);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (footer.classList.contains("picking")) footer.classList.remove("picking");
    else closeAll();
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    step(e.key === "ArrowUp" ? -1 : 1);
  }
});

// Clicking anywhere else in Muxy moves focus away from this panel.
let blurTimer = null;
window.addEventListener("blur", () => {
  clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    if (!document.hasFocus()) closeAll(true);
  }, 40);
});
for (const event of ["pane.focused", "tab.focused"]) {
  muxy.events.subscribe(event, () => closeAll(true));
}

// ---- Projects ----

async function loadProject(id) {
  try {
    const list = (await muxy.projects.list()) || [];
    const p = (id && list.find((x) => x.id === id)) || list.find((x) => x.isActive);
    project = p ? { id: p.id, name: p.name || "This project" } : null;
  } catch (e) {
    project = null; // Without access to projects, every note shows everywhere.
  }
}

muxy.events.subscribe("project.switched", async (event) => {
  await loadProject(event && event.projectID);
  setPointer(null);
  syncTabs();
  layout();
});

// ---- How much of the window the panel covers ----
// Even with clicks passing through, a panel over the whole window catches
// files dragged onto it, so they never reach the terminal or tab underneath.
// At rest the panel covers only the ribbons, and it spreads over the window
// only while the pointer is on them or a note, menu, or settings is open.

const COLLAPSE_MS = 180; // lets closing animations finish first
let wanted = null;       // the frame last asked for
let collapseTimer = null;
let framing = false;     // on once the panel's real frame is known

function setOrigin(x, y) {
  x = Math.round(x || 0);
  y = Math.round(y || 0);
  if (x === origin.x && y === origin.y) return;
  origin = { x, y };
  stage.style.transform = x || y ? `translate(${-x}px, ${-y}px)` : "";
}

function needsWindow() {
  return pointerA != null || [card, prefs, menu, toast, tip].some((el) => el.classList.contains("show"));
}

// The ribbons, the strip that takes the pointer, and a little room for shadows.
function restFrame() {
  const pad = 8;
  const a0 = Math.max(0, strip.start - HALO - pad);
  const a1 = Math.min(edgeLength(), strip.start + strip.total + HALO + pad);
  const r = rectAt(a0, a1 - a0, 0, Math.max(S.touch, S.max) + HALO + pad);
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, width: Math.ceil(r.x + r.w) - x, height: Math.ceil(r.y + r.h) - y };
}

function request(f) {
  const w = wanted;
  if (w && w.x === f.x && w.y === f.y && w.width === f.width && w.height === f.height) return;
  wanted = f;
  Promise.resolve(muxy.panel.setFrame(f)).catch((e) => console.warn("Couldn't place the notes:", e && e.message));
}

function fitFrame(now = false) {
  if (!muxy.panel || !framing) return;
  if (needsWindow()) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
    request({ x: 0, y: 0, width: W, height: H });
    return;
  }
  if (now) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
    request(restFrame());
  } else if (!collapseTimer) {
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      if (!needsWindow()) request(restFrame());
    }, COLLAPSE_MS);
  }
}

// The page usually hears it was resized before Muxy reports the new frame, so
// line the stage up then, if the new size is the one asked for.
window.addEventListener("resize", () => {
  const f = wanted;
  if (f && Math.abs(window.innerWidth - f.width) < 1 && Math.abs(window.innerHeight - f.height) < 1) setOrigin(f.x, f.y);
});

function panelChanged(state) {
  if (!state) return;
  if (state.frame) setOrigin(state.frame.x, state.frame.y);
  const b = state.bounds;
  if (b && b.width && b.height && (b.width !== bounds.width || b.height !== bounds.height)) {
    bounds = { width: b.width, height: b.height };
    wanted = null; // the window changed size; place the panel again
    layout();
    fitFrame(!needsWindow());
  }
}

new MutationObserver(() => fitFrame()).observe(stage, { subtree: true, attributes: true, attributeFilter: ["class"] });

// ---- Startup ----

const WELCOME = {
  title: "Sticky Notes",
  text:
    "☐ Click a ribbon on the edge to open a note\n" +
    "☐ Type [] to start a checklist, click a box to tick it\n" +
    "☐ ⌃⌥N makes a new note from anywhere\n" +
    "☐ Right-click the ribbons to move them\n" +
    "☐ Esc puts the note away\n\n" +
    "Notes save as you type.",
};

async function init() {
  settings = await readSettings();
  S = SIZES[settings.size];
  await loadProject();
  notes = await readNotes();

  if (!(await muxy.storage.get("initialized"))) {
    await muxy.storage.set("initialized", true);
    if (notes.length === 0) {
      const now = Date.now();
      const note = { id: newID(), ...WELCOME, color: "yellow", project: null, createdAt: now, updatedAt: now };
      notes.push(note);
      writeNote(note);
    }
  }

  if (muxy.panel) {
    const state = await muxy.panel.get();
    if (state && state.bounds && state.bounds.width && state.bounds.height) {
      bounds = { width: state.bounds.width, height: state.bounds.height };
    }
    if (state && state.frame) setOrigin(state.frame.x, state.frame.y);
  }

  syncTabs();
  for (const t of tabs.values()) t.el.getAnimations().forEach((a) => a.finish());
  ribbons.classList.add("instant");
  layout();
  void ribbons.offsetWidth;
  ribbons.classList.remove("instant");

  if (muxy.panel) {
    framing = true;
    fitFrame(true);
    muxy.panel.onChange((s) => {
      panelChanged(s);
      if (s && s.focused === false && !document.hasFocus()) closeAll(true);
    });
    // Clicks land on these; everywhere else reaches Muxy.
    muxy.panel.trackHitElements(
      () => [spine, card, prefs, menu, toast].filter((el) => el === spine || el.offsetParent !== null),
      { interval: 32 }
    );
  }

  // These come from commands, often a shortcut pressed in a terminal.
  muxy.events.subscribe("extension.new-note", () => { newNote(); claimFocus(); });
  muxy.events.subscribe("extension.open-settings", () => { openPrefs(); claimFocus(); });

  muxy.lifecycle.onBeforeClose(async () => {
    if (openId) leaveNote(openId);
    await flushSaves();
    return false;
  });

  const action = muxy.data && muxy.data.action;
  if (action === "new") { newNote(); claimFocus(); }
  else if (action === "settings") { openPrefs(); claimFocus(); }

  setInterval(() => {
    const note = byId(openId);
    if (note) whenEl.textContent = ago(note.updatedAt);
  }, 30000);

  console.log(`Sticky notes ready: ${notes.length} note(s) on the ${settings.side} edge${project ? ` in ${project.name}` : ""}`);
}

init().catch((e) => console.error("Sticky notes failed to start:", e && e.message));
