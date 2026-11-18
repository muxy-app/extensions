/* Quick-note modal: one memo into the chosen scope's running "빠른 메모" note. The scope defaults to the project that is
 * open (or "전역" without one). Opened by the topbar button, the palette command or the shortcut. */
let scopes = [], cur = 0;
const text = $("#text");

function paintScopes() {
  $("#scopes").replaceChildren(...scopes.map((s, i) => el("button", { class: i === cur ? "on" : "", onclick: () => { cur = i; paintScopes(); text.focus(); } }, s.kind === "global" ? tr("전역") : `${s.name} · ${s.kind === "ws" ? tr("워크스페이스") : tr("프로젝트")}`)));
}
const fail = (e) => { const b = $("#err"); b.textContent = String((e && e.message) || e); b.hidden = false; };

async function save(thenIssue) {
  const v = text.value.trim();
  if (!v) return;
  $("#err").hidden = true;
  try {
    const { note, entry } = await NS.quickAdd(scopes[cur], v);
    text.value = "";
    if (thenIssue) {
      await openNotesTab(scopes[cur], note.file, entry.id); // the issue form needs a project; the notes tab asks for one when the scope has none
      return;
    }
    await muxy.modal.submitWebview({ saved: true, file: note.file }).catch(() => muxy.modal.closeWebview());
  } catch (e) { fail(e); }
}

/* "저장 후 이슈로 등록" hands over to the notes tab, which already knows how to pick the project and open the issue form. */
async function openNotesTab(scope, file, entryId) {
  await store.set("notes.open", { file, entryId, issue: true, at: Date.now() });
  await muxy.tabs.open({ kind: "extensionWebView", extension: { id: muxy.extensionID, tabType: "notes", data: scope.kind === "global" ? {} : { scope }, singleton: false } });
  await muxy.modal.closeWebview();
}

$("#save").addEventListener("click", () => save(false));
$("#issue").addEventListener("click", () => save(true));
$("#close").addEventListener("click", () => muxy.modal.closeWebview());
$("#all").addEventListener("click", async () => { try { await muxy.tabs.open({ kind: "extensionWebView", extension: { id: muxy.extensionID, tabType: "notes", data: {}, singleton: true } }); } catch (e) { return fail(e); } await muxy.modal.closeWebview(); });
text.addEventListener("keydown", (e) => { if (e.isComposing) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(false); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") muxy.modal.closeWebview(); });

(async () => {
  const projects = await muxy.projects.list().catch(() => []);
  const active = projects.find((p) => p.isActive);
  const workspaces = await muxy.workspaces.list().catch(() => []);
  scopes = [{ kind: "global", name: "" }, ...(active ? [{ kind: "proj", id: active.id, name: active.name }] : []), ...workspaces.map((w) => ({ kind: "ws", id: w.id, name: w.name }))];
  cur = active ? 1 : 0;
  paintScopes();
  text.focus();
})();
