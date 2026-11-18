/* Notes tab: the list of notes, one note's memos, and the writing helper (a chat with an agent that is recorded into the
 * memo as it happens). Storage lives in store.js; opened from the sidebar menus (with a scope) or the quick-note
 * modal ("all notes"). */
const SC = ctx.scope || null; // the scope this tab was opened for; null shows every note
const S = { mode: "helper", hdraft: "", notes: [], filter: SC ? SC.kind : "all", cur: null, known: new Set(), editId: null, delId: null, draft: "", projects: [], workspaces: [], view: "note", panel: null };
let H = null; // the running helper session: { note, entry, agent, sid, screen, miss, busy, dirty, lastRaw }
const HELPER_SID_FILE = "/tmp/workdeck-helper-session";
const POLL_MS = 3000;
/* Safety net against stray agents: the notes page refreshes /tmp/workdeck-hb-<session> every few seconds while the helper
 * runs. This watchdog starts with the agent (in a detached subshell, so the terminal prints no job line) and, once that
 * file has not been touched for 3 minutes (the tab was closed, the page crashed, the extension reloaded), ends the
 * agent's session. It also stops by itself when its shell is gone. */
const MUXY_BIN = "/Applications/Muxy.app/Contents/MacOS/muxy";
const HELPER_WATCHDOG = `{ HB=/tmp/workdeck-hb-$MUXY_SESSION_ID; touch "$HB"; ( ( while sleep 15; do kill -0 $$ 2>/dev/null || exit; [ -n "$(find "$HB" -mmin -3 2>/dev/null)" ] || { ${MUXY_BIN} session end "$MUXY_SESSION_ID" --yes >/dev/null 2>&1; rm -f "$HB"; pkill -TERM -P $$ 2>/dev/null; exit; }; done ) & ); } &&`;

const IC = {
  chat: '<path d="M3 3.5h10v7H8.5L5.5 13v-2.5H3Z"/>',
  pen: '<path d="m10.5 3 2.5 2.5L6 12.5l-3 .5.5-3Z"/>',
  trash: '<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/>',
};
function ico(name) {
  const s = document.createElement("span");
  s.innerHTML = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name]}</svg>`;
  return s.firstChild;
}

const scopeKind = { global: tr("전역"), ws: tr("워크스페이스"), proj: tr("프로젝트") };
const scopeLabel = (sc) => (sc.kind === "global" ? tr("전역") : sc.name || scopeKind[sc.kind]);
const sameScope = (a, b) => a.kind === b.kind && (a.kind === "global" || a.id === b.id);
const hhmm = (ts) => ts.slice(11);
const dayLabel = (ts) => new Date(ts.slice(0, 10) + "T00:00:00").toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
const showErr = (e) => { const b = $("#banner"); b.replaceChildren(String((e && e.message) || e)); b.hidden = false; setTimeout(() => { b.hidden = true; }, 8000); };
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { showErr(e); } };

/* ---------- saving: memos another window added (the quick-note modal) are merged in rather than overwritten ---------- */
async function persist(note) {
  if (note.file) {
    const disk = await NS.read(note.file);
    if (disk != null) {
      const have = new Set(note.entries.map((e) => e.id));
      const added = NS.parse(disk, note.file).entries.filter((e) => !have.has(e.id) && !S.known.has(e.id));
      if (added.length) { note.entries.push(...added); note.entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); }
    }
  }
  await NS.save(note);
  if (note === S.cur) S.known = new Set(note.entries.map((e) => e.id));
}

/* ---------- list ---------- */
function visible() {
  return S.notes.filter((n) => (SC ? sameScope(n.scope, SC) : S.filter === "all" || n.scope.kind === S.filter));
}
function renderList() {
  const items = visible();
  $("#list").replaceChildren(items.length
    ? el("div", { class: "items" }, ...items.map((n) => el("div", { class: "item" + (S.cur && S.cur.file === n.file ? " on" : ""), onclick: () => openNote(n.file) },
      el("div", { class: "t" }, el("span", { class: "title" }, n.title)),
      el("div", { class: "meta" }, chip(scopeLabel(n.scope)), el("span", {}, tr("메모 {0}개", n.count)), el("span", {}, ago(new Date(n.mtime).toISOString()))))))
    : el("div", { class: "empty" }, tr("노트가 없어요.")));
}
async function refreshList() {
  S.notes = await NS.list();
  renderList();
}

async function openNote(file) {
  if (H && S.cur && H.note.file !== file) { showErr(new Error(tr("작성 도우미를 끝낸 뒤 다른 노트로 이동해 주세요."))); return; }
  S.view = "note"; S.editId = null; S.delId = null; S.panel = null;
  const note = H && H.note.file === file ? H.note : await NS.load(file);
  // a conversation recorded as "live" that no helper is running belongs to a session that ended abruptly
  for (const e of note.entries) if (e.thread && e.thread.state === "live" && !(H && H.entry.id === e.id)) e.thread.state = "dead";
  S.cur = note; S.known = new Set(note.entries.map((e) => e.id));
  renderList(); renderNote();
}

/* ---------- one note ---------- */
function threadBlock(e) {
  const t = e.thread;
  if (!t) return null;
  const live = H && H.entry === e;
  const label = live ? tr("대화 중 · {0}", t.agent) : t.state === "dead" ? tr("중단됨 · 여기까지 저장됨") : tr("대화 끝 · {0}", t.agent);
  const msgs = (t.msgs || []).map((m) => el("div", { class: "msg" }, tr("나") + ": " + m.x));
  return el("div", { class: "thread" },
    el("div", { class: "tst " + (live ? "live" : t.state === "dead" ? "dead" : "") }, label),
    t.summary ? renderMarkdown(t.summary) : el("div", { class: "empty-note" }, live ? tr("대화가 진행되면 여기에 정리돼요") : tr("정리된 내용이 없어요")),
    (msgs.length || t.raw) ? el("details", {}, el("summary", {}, tr("대화 원문")), ...msgs, t.raw ? el("pre", {}, t.raw) : null) : null);
}

function memoRow(e) {
  const busy = !!H;
  if (S.editId === e.id) {
    const ta = el("textarea", {}); ta.value = e.x;
    const save = guard(async () => { const v = ta.value.trim(); if (v !== e.x) { e.x = v; await persist(S.cur); } S.editId = null; renderNote(); });
    ta.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); save(); } else if (ev.key === "Escape") { S.editId = null; renderNote(); }
    });
    setTimeout(() => ta.focus(), 0);
    return el("div", { class: "memo" }, el("time", {}, hhmm(e.ts)), el("div", { class: "mb" }, ta,
      el("div", { class: "erow" }, el("button", { class: "btn primary", onclick: save }, tr("저장")), el("button", { class: "btn", onclick: () => { S.editId = null; renderNote(); } }, tr("취소")), el("span", { class: "hint" }, tr("Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소")))));
  }
  const confirming = S.delId === e.id;
  const acts = confirming
    ? el("div", { class: "acts on" }, el("span", { class: "ask" }, tr("삭제할까요?")),
      el("button", { class: "btn", onclick: guard(async () => { if (H && H.entry === e) await endHelper("done"); S.cur.entries = S.cur.entries.filter((x) => x.id !== e.id); S.known.delete(e.id); S.delId = null; await NS.save(S.cur); renderNote(); renderList(); }) }, tr("삭제")),
      el("button", { class: "btn", onclick: () => { S.delId = null; renderNote(); } }, tr("취소")))
    : el("div", { class: "acts" },
      el("button", { class: "btn", title: tr("에이전트와 대화로 이어가기"), disabled: busy, onclick: () => openHelperPicker(e) }, ico("chat")),
      el("button", { class: "btn", title: tr("편집"), onclick: () => { S.editId = e.id; S.delId = null; renderNote(); } }, ico("pen")),
      el("button", { class: "btn", title: tr("삭제"), onclick: () => { S.delId = e.id; S.editId = null; renderNote(); } }, ico("trash")));
  return el("div", { class: "memo" }, el("time", {}, hhmm(e.ts)),
    el("div", { class: "mb" }, e.x ? renderMarkdown(e.x) : (e.thread ? el("span", { class: "empty-note" }, tr("(작성 도우미 대화)")) : null),
      e.issue ? el("div", { class: "meta" }, el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); openUrl(e.issue.url); } }, e.issue.label)) : null, threadBlock(e)),
    acts);
}

function renderNote() {
  if (S.view === "settings") return renderSettings();
  const note = S.cur;
  const detail = $("#detail");
  if (!note) { detail.replaceChildren(el("div", { class: "empty" }, tr("왼쪽에서 노트를 고르거나 새 노트를 만드세요."))); renderHelper(); return; }
  const head = el("div", { class: "nhead" },
    el("h2", { title: tr("제목을 눌러 이름 바꾸기"), style: "cursor:pointer", onclick: guard(async () => { const n = await muxy.dialog.prompt({ title: tr("노트 제목"), placeholder: note.title }); if (n && n.trim()) { note.title = n.trim(); await persist(note); renderNote(); refreshList(); } }) }, note.title),
    chip(scopeLabel(note.scope)),
    el("span", { class: "path", title: note.file }, note.file),
    el("button", { class: "btn", disabled: !!H, onclick: () => openHelperPicker(null) }, tr("작성 도우미")),
    el("button", { class: "btn", onclick: guard(async () => {
      const c = await muxy.dialog.confirm({ title: tr("\"{0}\" 노트를 삭제할까요?", note.title), message: tr("파일은 휴지통으로 이동해요."), buttons: [tr("삭제"), tr("취소")], default: tr("취소"), cancel: tr("취소") });
      if (c !== tr("삭제")) return;
      if (H) await endHelper("done");
      await NS.trash(note.file); S.cur = null; await refreshList(); renderNote();
    }) }, tr("노트 삭제")));
  const entries = el("div", { class: "entries", id: "entries" });
  let lastDay = "";
  for (const e of note.entries) {
    const d = e.ts.slice(0, 10);
    if (d !== lastDay) { entries.append(el("div", { class: "day" }, dayLabel(e.ts))); lastDay = d; }
    entries.append(memoRow(e));
  }
  if (!note.entries.length) entries.append(el("div", { class: "empty" }, tr("아직 메모가 없어요. 아래에 적고 저장해 보세요.")));
  const ta = el("textarea", { placeholder: tr("메모 입력 · Enter 저장 / Shift+Enter 줄바꿈") });
  ta.value = S.draft;
  ta.addEventListener("input", () => { S.draft = ta.value; });
  const add = (thenIssue) => guard(async () => {
    const v = ta.value.trim();
    if (!v) return;
    const e = NS.entry(v);
    note.entries.push(e); S.draft = ""; ta.value = "";
    await persist(note); renderNote(); renderList();
    if (thenIssue) await registerIssue(e);
  });
  ta.addEventListener("keydown", (ev) => { if (ev.isComposing) return; if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); add(false)(); } });
  const mode = H && S.mode !== "memo" ? "helper" : "memo";
  const seg = () => el("div", { class: "seg", style: "margin-bottom:8px" },
    el("button", { class: mode === "helper" ? "on" : "", onclick: () => { S.mode = "helper"; renderNote(); } }, tr("도우미에게")),
    el("button", { class: mode === "memo" ? "on" : "", onclick: () => { S.mode = "memo"; renderNote(); } }, tr("메모 저장")));
  let compose;
  if (mode === "helper") {
    // while a helper runs, the box at the bottom of the note talks to it, so typing happens where the memo box normally is
    const ht = el("textarea", { placeholder: tr("도우미에게 보낼 메시지"), disabled: !H.sid });
    ht.value = S.hdraft || "";
    ht.addEventListener("input", () => { S.hdraft = ht.value; });
    const send = guard(async () => { const v = ht.value.trim(); if (!v) return; S.hdraft = ""; ht.value = ""; await sendToAgent(v); });
    ht.addEventListener("keydown", (ev) => { if (ev.isComposing) return; if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } });
    if (!S.editId && !S.panel) setTimeout(() => ht.focus(), 0);
    compose = el("div", { class: "compose helpermode" }, seg(), ht,
      el("div", { class: "crow2" }, el("span", { class: "hint", style: "margin:0" }, tr("Enter 전송 · Shift+Enter 줄바꿈")), el("span", { class: "grow" }), el("button", { class: "btn primary", disabled: !H.sid, onclick: send }, tr("보내기"))));
  } else {
    compose = el("div", { class: "compose" }, H ? seg() : null, ta,
      el("div", { class: "crow2" }, el("button", { class: "btn", onclick: add(false) }, tr("저장")), el("span", { class: "grow" }), el("button", { class: "btn primary", onclick: add(true) }, tr("저장 후 이슈로 등록"))),
      el("div", { class: "hint" }, tr("Enter 저장 · Shift+Enter 줄바꿈")));
  }
  const keep = $("#entries");
  const top = keep ? keep.scrollTop : 0, atEnd = !keep || keep.scrollHeight - keep.scrollTop - keep.clientHeight < 40;
  detail.replaceChildren(head, el("div", { class: "pp-slot", id: "slot" }), entries, H ? el("div", { class: "hpanel", id: "hpanel" }) : null, compose);
  if (S.panel) $("#slot").append(S.panel());
  entries.scrollTop = atEnd ? entries.scrollHeight : top;
  renderHelper();
}

/* ---------- new note / settings ---------- */
async function loadChoices() {
  S.projects = await muxy.projects.list().catch(() => []);
  S.workspaces = await muxy.workspaces.list().catch(() => []);
}
function scopeOptions() {
  return [{ kind: "global", name: "" }, ...S.workspaces.map((w) => ({ kind: "ws", id: w.id, name: w.name })), ...S.projects.map((p) => ({ kind: "proj", id: p.id, name: p.name }))];
}
function newNoteForm() {
  const title = el("input", { type: "text", placeholder: tr("제목") });
  const opts = scopeOptions();
  const sel = el("select", {}, ...opts.map((o, i) => el("option", { value: String(i) }, o.kind === "global" ? tr("전역") : `${scopeKind[o.kind]} · ${o.name}`)));
  if (SC) sel.value = String(opts.findIndex((o) => sameScope(o, SC)));
  else if (S.filter !== "all") { const i = opts.findIndex((o) => o.kind === S.filter); if (i >= 0) sel.value = String(i); }
  const make = guard(async () => {
    const n = NS.create(opts[+sel.value], title.value.trim() || tr("새 노트"));
    await NS.save(n); S.panel = null; await refreshList(); await openNote(n.file);
  });
  title.addEventListener("keydown", (ev) => { if (!ev.isComposing && ev.key === "Enter") { ev.preventDefault(); make(); } });
  setTimeout(() => title.focus(), 0);
  return el("div", { class: "pp" }, title, el("div", { class: "frow", style: "display:flex;gap:6px" }, sel, el("button", { class: "btn primary", onclick: make }, tr("만들기")), el("button", { class: "btn", onclick: () => { S.panel = null; renderNote(); } }, tr("취소"))));
}

async function renderSettings() {
  S.view = "settings";
  const { list, last } = await loadAgents();
  const def = (await store.get("notes.agent", null)) || last;
  const root = el("input", { type: "text" }); root.value = await NS.root();
  const agent = el("select", {}, ...list.map((a) => el("option", { value: a.id }, a.name))); agent.value = list.some((a) => a.id === def) ? def : last;
  const msg = el("div", { class: "fhint" });
  // the binding Muxy actually applies (it follows what the user set in Settings → Keyboard), not the manifest default
  let combo = "";
  try {
    const b = (await muxy.shortcuts.list()).find((x) => x.id === "quick-note");
    if (b) {
      const order = ["cmd", "ctrl", "opt", "shift"], names = { cmd: "Cmd", ctrl: "Ctrl", opt: "Option", shift: "Shift" };
      const parts = String(b.combo).toLowerCase().split("+");
      combo = [...order.filter((m) => parts.includes(m)).map((m) => names[m]), ...parts.filter((k) => !order.includes(k)).map((k) => k.toUpperCase())].join(" + ");
    }
  } catch { /* shown as not assigned */ }
  $("#detail").replaceChildren(el("div", { class: "sform" },
    el("h2", {}, tr("노트 설정")),
    el("label", {}, tr("저장 경로")),
    el("div", { class: "frow" }, root, el("button", { class: "btn", onclick: guard(async () => { const p = await muxy.dialog.pickFolder({ title: tr("노트를 저장할 폴더") }); if (p) root.value = p; }) }, tr("폴더 선택…"))),
    el("div", { class: "fhint" }, tr("범위별 하위 폴더(global, ws-…, proj-…)가 이 아래에 만들어져요. 경로를 바꿔도 기존 노트는 옮기거나 지우지 않아요.")),
    el("label", {}, tr("작성 도우미 기본 에이전트")), agent,
    el("label", {}, tr("빠른 메모 단축키")),
    el("div", { class: "frow" }, el("input", { type: "text", value: combo || tr("지정 안 됨"), disabled: true }), el("button", { class: "btn", onclick: () => muxy.ui.openSettings("keyboard") }, tr("키보드 설정 열기"))),
    el("div", { class: "fhint" }, tr("기본 단축키가 Muxy 내장 단축키나 다른 확장과 겹치면 적용되지 않아요. 바꾸거나 해제는 Settings → Keyboard에서 해요.")),
    el("div", { class: "fact" }, el("button", { class: "btn primary", onclick: guard(async () => {
      await NS.setRoot(root.value.trim() || NOTE_ROOT_DEFAULT); await store.set("notes.agent", agent.value);
      msg.textContent = tr("저장했어요."); await refreshList();
    }) }, tr("저장")), el("button", { class: "btn", onclick: () => { S.view = "note"; renderNote(); } }, tr("닫기"))), msg));
}

/* ---------- handing a memo (or the note) to the issue modal ---------- */
function pickProject() {
  return new Promise((resolve) => {
    const sc = S.cur.scope;
    if (sc.kind === "proj") { const p = S.projects.find((x) => x.id === sc.id); if (p) return resolve(p); }
    const sel = el("select", {}, ...S.projects.map((p) => el("option", { value: p.id }, p.name)));
    const done = (v) => { S.panel = null; renderNote(); resolve(v); };
    S.panel = () => el("div", { class: "pp" }, el("div", { class: "hint", style: "margin:0 0 6px" }, tr("이슈를 등록할 프로젝트")), el("div", { style: "display:flex;gap:6px" }, sel, el("button", { class: "btn primary", onclick: () => done(S.projects.find((p) => p.id === sel.value)) }, tr("계속")), el("button", { class: "btn", onclick: () => done(null) }, tr("취소"))));
    renderNote();
  });
}
async function registerIssue(e) {
  const p = await pickProject();
  if (!p) return;
  const first = (e.x.split("\n")[0] || tr("노트")).slice(0, 80);
  const summary = e.thread && e.thread.summary ? "\n\n" + e.thread.summary : "";
  const res = await muxy.modal.openWebview({ entry: "modal/create.html", width: 840, height: 760, dismissOnOutsideClick: false, data: { name: p.name, path: p.path, prefill: { title: first, body: e.x + summary } } });
  if (res && res.url) { e.issue = { label: String(res.url).split("/").pop(), url: res.url }; await persist(S.cur); renderNote(); }
}

/* ---------- writing helper ---------- */
async function openHelperPicker(entry) {
  const { list, last } = await loadAgents();
  const def = (await store.get("notes.agent", null)) || last;
  const sel = el("select", {}, ...list.map((a) => el("option", { value: a.id }, a.name))); sel.value = list.some((a) => a.id === def) ? def : last;
  const ctxBox = el("input", { type: "checkbox", id: "hctx" });
  S.panel = () => el("div", { class: "pp" },
    entry ? el("div", { class: "hint", style: "margin:0 0 6px" }, tr("이 메모를 이어서 대화해요: {0}", (entry.x || "").slice(0, 40))) : null,
    el("div", { style: "display:flex;gap:6px;align-items:center" }, sel,
      el("button", { class: "btn primary", onclick: guard(async () => { S.panel = null; await store.set("notes.agent", sel.value); await startHelper(list.find((a) => a.id === sel.value), entry, ctxBox.checked); }) }, tr("대화 시작")),
      el("button", { class: "btn", onclick: () => { S.panel = null; renderNote(); } }, tr("취소"))),
    el("label", { style: "display:flex;gap:6px;align-items:center;margin-top:6px;font-size:12px" }, ctxBox, tr("노트의 다른 메모도 대화 맥락으로 넘기기")));
  renderNote();
}

function helperPrompt(agentName, entry, draftPath, withNote, noteAbs) {
  const prev = entry.thread && (entry.thread.summary || (entry.thread.msgs || []).length) ? `\nEarlier conversation on this memo (summary):\n${entry.thread.summary || (entry.thread.msgs || []).map((m) => m.x).join("\n")}\n` : "";
  return [
    "You are my writing partner for a note. We talk here in this terminal: answer my messages normally, in the language I write in.",
    `After EVERY reply of yours, overwrite this file with a short Markdown bullet summary of the whole conversation so far: ${draftPath}`,
    'Use lines such as "- 논의: ..." for topics discussed and "- 결론: ..." for conclusions or decisions. Put nothing else in that file, and do not edit any other file unless I ask.',
    entry.x ? `\nThe memo we continue from:\n${entry.x}\n` : "",
    prev,
    withNote ? `The whole note is at ${noteAbs}; read it for context, but do not change it.` : "",
    entry.x ? "Start by asking how I want to continue from the memo." : "Start by asking what I want to think through.",
  ].filter((x) => x !== "").join("\n");
}

async function startHelper(agent, entry, withNote) {
  if (H) return;
  const note = S.cur;
  if (!entry) { entry = NS.entry(""); note.entries.push(entry); }
  entry.thread = { agent: agent.name, state: "live", summary: (entry.thread && entry.thread.summary) || "", raw: (entry.thread && entry.thread.raw) || "", msgs: (entry.thread && entry.thread.msgs) || [], at: NS.stampOf() };
  await persist(note);
  const draftPath = await NS.abs(`.threads/${entry.id}.md`);
  await NS.writeThread(entry.id, entry.thread.summary || "");
  const noteAbs = await NS.abs(note.file);
  await muxy.exec({ shell: `rm -f ${HELPER_SID_FILE}`, timeoutMs: 5000 });
  await muxy.exec({ shell: `cat > ${AGENT_FILE}`, stdin: helperPrompt(agent.name, entry, draftPath, withNote, noteAbs), timeoutMs: 10000 });
  const proj = note.scope.kind === "proj" ? S.projects.find((p) => p.id === note.scope.id) : null;
  const dir = proj ? shellQuote(proj.path) : '"$HOME"';
  const command = `cd ${dir} && echo "$MUXY_SESSION_ID" > ${HELPER_SID_FILE} && ${HELPER_WATCHDOG} ` + agent.command.split("{file}").join(AGENT_FILE).split("{dir}").join(dir);
  S.mode = "helper";
  H = { note, entry, agent, sid: null, tabId: null, screen: "", miss: 0, busy: false, dirty: false, lastRaw: 0, tries: 0, err: null };
  renderNote();
  try {
    H.tabId = await muxy.tabs.open({ kind: "terminal", command });
    await focusSelf();
  } catch (e) { await endHelper("dead"); throw e; }
  H.timer = setInterval(tick, POLL_MS);
  tick();
}

async function focusSelf() {
  try { const me = (await muxy.tabs.list()).find((t) => t.title === myTitle); if (me) await muxy.tabs.switchTo(me.id); } catch { /* staying on the terminal tab is fine */ }
}

const cleanScreen = (out) => out.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => !/^[\s─━═—_│┃╌╍┄┈-]{6,}$/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");

/* Every few seconds: pull the agent's own summary file into the memo, check the session is still alive and keep the last
 * screen. The memo is written to disk whenever something changed, so an agent that dies loses nothing recorded so far. */
async function tick() {
  if (!H || H.busy) return;
  const h = H; h.busy = true;
  let changed = false;
  try {
    const t = h.entry.thread;
    const d = await NS.readThread(h.entry.id, h.sid ? `/tmp/workdeck-hb-${h.sid}` : "");
    if (d != null && d.trim() !== (t.summary || "").trim()) { t.summary = d.trim(); h.dirty = true; changed = true; }
    if (!h.sid) {
      const r = await muxy.exec({ shell: `cat ${HELPER_SID_FILE} 2>/dev/null`, timeoutMs: 5000 });
      h.sid = r.stdout.trim() || null;
      if (!h.sid && ++h.tries > 10) h.err = tr("에이전트 세션을 찾지 못했어요. 터미널 탭에서 에이전트가 시작됐는지 확인해 주세요.");
    }
    if (h.sid) {
      const ls = await muxyCLI(["session", "list", "--json"], { timeoutMs: 15000 });
      let alive = true;
      if (ls.exitCode === 0) { try { alive = JSON.parse(ls.stdout).some((s) => String(s.id) === h.sid); } catch { alive = true; } }
      h.miss = alive ? 0 : h.miss + 1;
      if (alive) {
        const sc = await muxyCLI(["session", "read-screen", h.sid, "--lines", "60"], { timeoutMs: 15000 });
        if (sc.exitCode === 0) {
          h.screen = cleanScreen(sc.stdout);
          const raw = h.screen.slice(-4000);
          if (raw !== t.raw && Date.now() - h.lastRaw > 15000) { t.raw = raw; h.lastRaw = Date.now(); h.dirty = true; }
        }
      }
      if (h.miss >= 2) { h.busy = false; await endHelper("dead"); return; }
    }
    if (h.dirty) { h.dirty = false; t.at = NS.stampOf(); await persist(h.note); }
    h.err = h.err && !h.sid ? h.err : null;
  } catch (e) { h.err = String((e && e.message) || e); }
  h.busy = false;
  if (H === h) { renderHelper(); if (changed && S.cur === h.note && !S.editId && !document.activeElement?.closest?.(".compose")) renderNote(); }
}

async function sendToAgent(text) {
  if (!H || !H.sid) return;
  const h = H;
  await muxyCLI(["session", "send", h.sid, "--stdin"], { timeoutMs: 15000, stdin: text });
  await muxyCLI(["session", "send-keys", h.sid, "Enter"], { timeoutMs: 15000 });
  h.entry.thread.msgs.push({ t: NS.stampOf().slice(11), x: text });
  await persist(h.note); // the user's message is on disk before the agent has answered
  setTimeout(tick, 1500);
  renderNote();
}

/* Ending the helper also ends its agent session and closes the terminal tab it opened, so nothing is left behind. */
async function closeHelperTab(h) {
  if (h.sid) {
    await muxyCLI(["session", "end", h.sid, "--yes"], { timeoutMs: 15000 }).catch(() => {});
    await muxy.exec({ shell: `rm -f /tmp/workdeck-hb-${h.sid}`, timeoutMs: 5000 }).catch(() => {});
  }
  if (h.tabId) await Promise.resolve(muxy.tabs.close(h.tabId)).catch(() => {}); // already closed by the user is fine
}

async function endHelper(state) {
  const h = H;
  if (!h) return;
  clearInterval(h.timer); H = null;
  await closeHelperTab(h);
  const t = h.entry.thread;
  t.state = state; if (h.screen) t.raw = h.screen.slice(-4000);
  try { await persist(h.note); } catch (e) { showErr(e); }
  renderNote();
  renderList();
}

function renderHelper() {
  const box = $("#hpanel");
  if (!box || !H) return;
  const t = H.entry.thread;
  const scr = el("div", { class: "hscreen" }, H.screen ? renderScreen(H.screen) : el("div", { class: "empty-note" }, H.sid ? tr("화면을 불러오는 중…") : tr("에이전트를 시작하는 중…")));
  box.replaceChildren(
    el("div", { class: "hhead" }, el("b", {}, tr("작성 도우미")), chip(H.agent.name),
      el("span", { class: "hstat" }, tr("대화 내용은 메모에 자동 저장 · {0}", t.at ? t.at.slice(11) : "")),
      el("button", { class: "btn", onclick: guard(async () => { await endHelper("done"); }) }, tr("끝내기"))),
    H.err ? el("div", { class: "err hwarn" }, H.err) : null,
    scr);
  scr.scrollTop = scr.scrollHeight;
}

/* ---------- closing the tab ends the helper (and its agent) first ---------- */
try {
  muxy.lifecycle.onBeforeClose(async () => {
    if (H) await Promise.race([endHelper("done"), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
    return false;
  });
} catch { /* without the hook the agent's watchdog still ends it */ }

/* ---------- boot ---------- */
const myTitle = SC ? `${tr("노트")} · ${SC.name || tr("전역")}` : tr("노트");
$("#title").textContent = SC ? myTitle : tr("노트");
$("#scopes").hidden = !!SC;
$("#scopes").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (H) { showErr(new Error(tr("작성 도우미를 끝낸 뒤 다른 노트로 이동해 주세요."))); return; }
  S.filter = b.dataset.s;
  $("#scopes").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  // choosing another scope clears the open note (and whatever was half done in it)
  S.cur = null; S.known = new Set(); S.editId = null; S.delId = null; S.panel = null; S.draft = ""; S.view = "note";
  renderList(); renderNote();
});
$("#new").addEventListener("click", () => { S.view = "note"; S.panel = newNoteForm; renderNote(); });
$("#settings").addEventListener("click", () => { if (S.view === "settings") { S.view = "note"; renderNote(); } else renderSettings(); });
window.addEventListener("focus", guard(async () => {
  if (H || S.editId || S.view === "settings") return;
  await refreshList();
  if (S.cur && !S.draft) { const note = await NS.load(S.cur.file).catch(() => null); if (note && JSON.stringify(note.entries.map((e) => e.id)) !== JSON.stringify(S.cur.entries.map((e) => e.id))) { S.cur = note; S.known = new Set(note.entries.map((e) => e.id)); renderNote(); } }
}));
(async () => {
  try { await muxy.tabs.setTitle(myTitle); } catch { /* the default title stays */ }
  tabIcon("note.text");
  await loadChoices();
  try { await refreshList(); } catch (e) { showErr(e); renderList(); }
  const handoff = await store.get("notes.open", null); // "저장 후 이슈로 등록" from the quick-note modal
  if (handoff && Date.now() - handoff.at < 60000) {
    await store.set("notes.open", null);
    try {
      await openNote(handoff.file);
      const e = S.cur.entries.find((x) => x.id === handoff.entryId);
      if (e && handoff.issue) await registerIssue(e);
      return;
    } catch (err) { showErr(err); }
  }
  const first = visible()[0];
  if (first) await openNote(first.file); else renderNote();
})();
