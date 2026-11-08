// One sticky note. Each note is a named instance of the detached "note" panel,
// and its text, color, and frame live in storage under "note:<instance>".

const PREFIX = "note:";
const COLORS = {
  yellow: "#fff1a8",
  pink: "#ffd6e0",
  blue: "#d3e9ff",
  green: "#d7f5cc",
  purple: "#e7dcff",
  orange: "#ffdfbd",
};

const noteEl = document.getElementById("note");
const header = document.getElementById("header");
const tools = document.getElementById("tools");
const textEl = document.getElementById("text");
const palette = document.getElementById("palette");
const colorBtn = document.getElementById("color");
const addBtn = document.getElementById("add");
const deleteBtn = document.getElementById("delete");

const id = muxy.panelInstanceID || (muxy.panel && muxy.panel.instanceID);
const key = PREFIX + id;

let note = { text: "", color: "yellow", frame: null };
let deleted = false;
let saveTimer = null;

// ---- Saving ----

function save() {
  if (deleted || !id) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  note.updatedAt = Date.now();
  return muxy.storage.set(key, note).catch((e) => console.error("Save failed:", e && e.message));
}

function scheduleSave(delay = 400) {
  if (deleted) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, delay);
}

// ---- Rendering ----

function applyColor(color) {
  if (!COLORS[color]) color = "yellow";
  note.color = color;
  noteEl.dataset.color = color;
  for (const b of palette.children) {
    b.setAttribute("aria-pressed", String(b.dataset.color === color));
  }
}

for (const [name, hex] of Object.entries(COLORS)) {
  const b = document.createElement("button");
  b.dataset.color = name;
  b.title = name[0].toUpperCase() + name.slice(1);
  b.style.background = hex;
  b.addEventListener("click", () => {
    applyColor(name);
    palette.classList.remove("open");
    save();
    textEl.focus();
  });
  palette.appendChild(b);
}

// The header strip moves the panel, except over the buttons on its right.
function updateDragRegion() {
  if (!muxy.panel) return;
  const h = header.getBoundingClientRect();
  const t = tools.getBoundingClientRect();
  Promise.resolve(
    muxy.panel.setDragRegions([{ x: h.left, y: h.top, width: Math.max(0, t.left - h.left), height: h.height }])
  ).catch((e) => console.warn("Drag region failed:", e && e.message));
}

// ---- Interactions ----

textEl.addEventListener("input", () => {
  note.text = textEl.value;
  scheduleSave();
});
textEl.addEventListener("blur", () => save());
textEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") textEl.blur();
});

colorBtn.addEventListener("click", () => palette.classList.toggle("open"));
document.addEventListener("mousedown", (e) => {
  if (!palette.contains(e.target) && !colorBtn.contains(e.target)) palette.classList.remove("open");
});

addBtn.addEventListener("click", async () => {
  await save();
  muxy.events.emit("extension.new-note", { frame: note.frame, color: note.color });
});

let confirmTimer = null;
function resetDelete() {
  clearTimeout(confirmTimer);
  deleteBtn.classList.remove("confirm");
  deleteBtn.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  updateDragRegion();
}

async function deleteNote() {
  deleted = true;
  clearTimeout(saveTimer);
  try {
    await muxy.storage.delete(key);
  } catch (e) {
    console.error("Delete failed:", e && e.message);
  }
  muxy.panels.close();
}

deleteBtn.addEventListener("click", () => {
  // Empty notes go right away; notes with text ask once.
  if (!textEl.value.trim() || deleteBtn.classList.contains("confirm")) {
    deleteNote();
    return;
  }
  deleteBtn.classList.add("confirm");
  deleteBtn.textContent = "Delete?";
  updateDragRegion();
  confirmTimer = setTimeout(resetDelete, 3000);
});

// ---- Startup ----

async function init() {
  if (!id) {
    console.warn("Sticky note opened without an instance; closing it.");
    muxy.panels.close();
    return;
  }

  const stored = await muxy.storage.get(key);
  if (stored) note = { ...note, ...stored };
  textEl.value = note.text || "";
  applyColor(note.color);

  if (muxy.panel) {
    const state = await muxy.panel.get();
    if (state && state.frame) note.frame = state.frame;
    muxy.panel.onChange((s) => {
      if (s && s.frame) {
        note.frame = s.frame;
        scheduleSave(600);
      }
      updateDragRegion();
    });
  }

  // Save the note the first time it is created (so it is restored later).
  if (!stored) save();

  updateDragRegion();
  window.addEventListener("resize", updateDragRegion);

  muxy.lifecycle.onBeforeClose(async () => {
    if (!deleted && saveTimer) await save();
    return false;
  });

  console.log(`Sticky note ${id} ready (${note.color})`);
  if (!note.text) textEl.focus();
}

init().catch((e) => console.error("Sticky note failed to start:", e && e.message));
