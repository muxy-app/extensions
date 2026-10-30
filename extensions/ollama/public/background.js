const STATUSBAR_ID = "ollama";

// Note: `Ollama: Launch Agent…` no longer routes through background.js. It is declared as a
// declarative `openModal` command action in the manifest, so the app opens the launcher
// webview modal directly. The background host cannot do that work — it has no `storage.*`
// or `modal.openWebview` verbs (see HostBridge dispatch) — so it only relays the
// panel-driven commands and keeps the status bar indicator in sync.

function relay(command, event) {
  muxy.events.subscribe(command, () => {
    try {
      muxy.events.emit(event, {});
    } catch (err) {
      console.warn("ollama: relay failed", err?.message || err);
    }
  });
}

relay("command.ollama-refresh", "extension.ollama.refresh");
relay("command.ollama-add-server", "extension.ollama.addServer");

muxy.events.subscribe("extension.ollama.status", (payload) => {
  const online = Number(payload?.online) || 0;
  const total = Number(payload?.total) || 0;
  try {
    muxy.statusbar.set({ id: STATUSBAR_ID, text: total > 0 ? `${online}/${total}` : "" });
    if (online > 0) muxy.statusbar.show(STATUSBAR_ID);
    else muxy.statusbar.hide(STATUSBAR_ID);
  } catch (err) {
    console.warn("ollama: statusbar update failed", err?.message || err);
  }
});
