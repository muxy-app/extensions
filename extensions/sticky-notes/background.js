// Sticky Notes background script.
// Owns note creation, restores notes at startup, and handles the commands.
// Each note is stored under "note:<instance>" and shown as one named
// instance of the detached "note" panel.

const PANEL = "note";
const PREFIX = "note:";
const VISIBLE_KEY = "visible";
const MAX_NOTES = 32; // Muxy keeps at most 32 panels open per extension.
const COLORS = ["yellow", "pink", "blue", "green", "purple", "orange"];
const DEFAULT_SIZE = { width: 240, height: 220 };

function noteIDs() {
  return (muxy.storage.keys() || [])
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => k.slice(PREFIX.length));
}

function openNote(id, note) {
  const options = { instance: id, scope: "global" };
  if (note && note.frame) options.frame = note.frame;
  muxy.panels.open(PANEL, { id }, options);
}

function showAll() {
  muxy.storage.set(VISIBLE_KEY, true);
  for (const id of noteIDs()) {
    try {
      openNote(id, muxy.storage.get(PREFIX + id));
    } catch (e) {
      console.error(`Couldn't open note ${id}: ${e && e.message}`);
    }
  }
}

function hideAll() {
  muxy.storage.set(VISIBLE_KEY, false);
  for (const id of noteIDs()) {
    try {
      muxy.panels.close(PANEL, id);
    } catch (e) {
      // Not open; nothing to do.
    }
  }
}

function anyOpen() {
  try {
    const open = muxy.panels.list() || [];
    return open.some((p) => (p.panelID || p.id) === PANEL);
  } catch (e) {
    return muxy.storage.get(VISIBLE_KEY) !== false;
  }
}

function newID() {
  return "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function newNote(from) {
  const ids = noteIDs();
  if (ids.length >= MAX_NOTES) {
    console.warn(`Sticky Notes: limit of ${MAX_NOTES} notes reached.`);
    return;
  }

  // Show any hidden notes too, so a new note never appears alone.
  if (muxy.storage.get(VISIBLE_KEY) === false) showAll();

  const count = ids.length;
  let color = COLORS[count % COLORS.length];
  let frame;
  if (from && from.frame) {
    const f = from.frame;
    frame = {
      x: (f.x || 0) + 28,
      y: (f.y || 0) + 28,
      width: f.width || DEFAULT_SIZE.width,
      height: f.height || DEFAULT_SIZE.height,
    };
    if (from.color) {
      color = COLORS[(COLORS.indexOf(from.color) + 1) % COLORS.length];
    }
  } else {
    const step = count % 8;
    frame = { x: 140 + step * 28, y: 120 + step * 28, ...DEFAULT_SIZE };
  }

  const id = newID();
  const now = Date.now();
  const note = { text: "", color, frame, createdAt: now, updatedAt: now };
  muxy.storage.set(PREFIX + id, note);
  muxy.storage.set(VISIBLE_KEY, true);
  openNote(id, note);
}

muxy.events.subscribe("command.new-note", () => newNote());
muxy.events.subscribe("command.show-notes", () => showAll());
muxy.events.subscribe("command.hide-notes", () => hideAll());
muxy.events.subscribe("command.toggle-notes", () => (anyOpen() ? hideAll() : showAll()));
muxy.events.subscribe("extension.new-note", (payload) => newNote(payload || {}));

const WELCOME =
  "Welcome to Sticky Notes!\n\n" +
  "• Drag the top strip to move me\n" +
  "• Drag my edges to resize\n" +
  "• ● changes color, + adds a note, × deletes\n" +
  "• Ctrl+Opt+N: new note\n" +
  "• Ctrl+Opt+Shift+N: show/hide notes";

// Restore notes when Muxy starts or the extension is enabled.
try {
  if (!muxy.storage.get("initialized")) {
    muxy.storage.set("initialized", true);
    if (noteIDs().length === 0) {
      const now = Date.now();
      const id = newID();
      muxy.storage.set(PREFIX + id, {
        text: WELCOME,
        color: "yellow",
        frame: { x: 140, y: 120, width: 260, height: 220 },
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  if (muxy.storage.get(VISIBLE_KEY) !== false) showAll();
} catch (e) {
  console.error(`Sticky Notes: restore failed: ${e && e.message}`);
}
