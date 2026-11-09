// Sticky Notes background script.
// Keeps the notes panel open over the window (it draws the notes along one
// edge), and handles the commands. The panel itself owns the notes and their storage.

const PANEL = "dock";
const VISIBLE_KEY = "visible";

function isOpen() {
  try {
    return (muxy.panels.list() || []).some((p) => (p.panelID || p.id) === PANEL);
  } catch (e) {
    return false;
  }
}

function show(data) {
  muxy.storage.set(VISIBLE_KEY, true);
  if (isOpen()) return false;
  muxy.panels.open(PANEL, data || {}, { scope: "global" });
  return true;
}

function hide() {
  muxy.storage.set(VISIBLE_KEY, false);
  try {
    muxy.panels.close(PANEL);
  } catch (e) {
    // Not open; nothing to do.
  }
}

function newNote() {
  // A freshly opened panel makes the note from its data; an open one hears it.
  if (!show({ action: "new" })) muxy.events.emit("extension.new-note", {});
}

function openSettings() {
  if (!show({ action: "settings" })) muxy.events.emit("extension.open-settings", {});
}

muxy.events.subscribe("command.new-note", () => newNote());
muxy.events.subscribe("command.settings", () => openSettings());
muxy.events.subscribe("command.show-notes", () => show());
muxy.events.subscribe("command.hide-notes", () => hide());
muxy.events.subscribe("command.toggle-notes", () => (isOpen() ? hide() : show()));

try {
  if (muxy.storage.get(VISIBLE_KEY) !== false) show();
} catch (e) {
  console.error(`Sticky Notes: couldn't open the notes: ${e && e.message}`);
}
