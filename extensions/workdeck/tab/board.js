/* Agent control room: every running agent as a live card with its terminal screen, a reply box and decision keys.
 * Data comes from the Muxy CLI (`activity`, `session`), so replies go to the agent's own terminal session. */
const B = { titles: new Map(), agents: [], events: [], sessions: new Map(), projects: new Map(), screens: new Map(), open: new Set(), filter: "all", busy: new Set(), draft: new Map() };
const grid = $("#grid"), alertsBox = $("#alerts");
const PROVIDER_STATE = { working: tr("작업 중"), waiting: tr("입력 대기"), idle: tr("대기") };
const RANK = { waiting: 0, working: 1, idle: 2 };

async function mx(args, timeoutMs = 20000, stdin) {
  const r = await muxyCLI(args, { timeoutMs, ...(stdin != null ? { stdin } : {}) });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 300));
  return r.stdout;
}

async function readActivity() {
  const snap = JSON.parse(await mx(["activity", "list", "--json"]));
  B.agents = (snap.agents || []).map((a) => ({ session: String(a.session), project: a.project, provider: a.provider, state: a.state }));
  // XITA is not recognized by Muxy; it is found from its processes and session files (see scanXita in shared.js)
  try {
    const xita = xitaAsAgents(await scanXita(), [...B.projects.values()], {});
    // inside a Muxy terminal XITA has a session, so the screen, replies, keys and ending work like any other agent;
    // otherwise only its state is known ("external")
    B.xitaTitles = new Map(xita.filter((x) => x.session && x.title).map((x) => [x.session, x.title]));
    for (const x of xita) B.agents.push({ session: x.session || x.paneID, project: x.projectID, provider: "XITA", state: x.status, external: !x.session, pid: x.paneID.replace("xita:", ""), cwd: x.cwd });
  } catch { /* the scan needs an approval the first time */ }
  B.events = (snap.events || []).map((e) => ({ ...e, id: String(e.id), session: e.session != null ? String(e.session) : null }));
  if (B.agents.some((a) => !a.external && !B.sessions.has(a.session))) {
    try { for (const s of JSON.parse(await mx(["session", "list", "--json"]))) B.sessions.set(String(s.id), s); } catch { /* the directory is only a label */ }
  }
}

/* The tab title an agent works under ("Checkout flow — payment step"). `activity` knows sessions, Muxy's agent list
 * knows panes, and tabs know pane titles; the two are matched by project + provider, narrowed by working folder when
 * a project has several of the same agent. A title is only shown when exactly one pane fits. */
const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z]/g, "");
async function readTitles() {
  try {
    const panes = await muxy.agents.list();
    const projectIDs = [...new Set(panes.map((m) => m.projectID))];
    const paneTitle = {}, wtPath = {};
    for (const pid of projectIDs) {
      for (const t of await muxy.tabs.list({ project: pid }).catch(() => [])) for (const pane of t.paneIDs || []) paneTitle[pane] = t.customTitle || t.title;
      for (const w of await muxy.worktrees.list(pid).catch(() => [])) wtPath[w.id] = String(w.path || "").replace(/\/+$/, "");
    }
    const titles = new Map();
    for (const a of B.agents.filter((x) => !x.external)) {
      let cands = panes.filter((m) => m.projectID === a.project && slug(m.providerID) === slug(a.provider));
      const dir = String((B.sessions.get(a.session) || {}).directory || "").replace(/\/+$/, "");
      if (cands.length > 1 && dir) cands = cands.filter((m) => wtPath[m.worktreeID] === dir);
      if (cands.length === 1 && paneTitle[cands[0].paneID]) titles.set(a.session, paneTitle[cands[0].paneID]);
    }
    for (const [sid, title] of B.xitaTitles || []) titles.set(sid, title); // XITA: first message of its session
    B.titles = titles;
  } catch { /* titles are a nicety */ }
}

async function readProjects() {
  try { B.projects = new Map((await muxy.projects.list()).map((p) => [p.id, p])); } catch { /* names are a convenience */ }
}

/* Screen text of one session; a few at a time so the first run doesn't flood Muxy with approval prompts. */
async function readScreen(a) {
  try {
    const out = await mx(["session", "read-screen", a.session, "--lines", "28"], 15000);
    // drop the terminal's horizontal rules (they only wrap into noise in a narrow card) and runs of blank lines
    const text = out.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => !/^[\s─━═—_│┃╌╍┄┈-]{6,}$/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    B.screens.set(a.session, { text, at: Date.now(), error: null });
  } catch (e) { B.screens.set(a.session, { text: "", at: Date.now(), error: e.message }); }
}

let screenRunning = false;
async function readScreens(force) {
  if (screenRunning) return;
  screenRunning = true;
  try {
    const want = B.agents.filter((a) => !a.external).filter((a) => a.state !== "idle" || B.open.has(a.session) || force).filter((a) => B.filter === "all" || B.filter === a.state);
    for (let i = 0; i < want.length; i += 2) await Promise.all(want.slice(i, i + 2).map(readScreen));
  } finally { screenRunning = false; }
}

const projectName = (a) => (B.projects.get(a.project) || {}).name || (B.sessions.get(a.session) || {}).directory?.split("/").pop() || tr("프로젝트");
const dirOf = (a) => (a.cwd || (B.sessions.get(a.session) || {}).directory || "").replace(/^\/Users\/[^/]+/, "~");
const eventsFor = (a) => B.events.filter((e) => e.session === a.session);
const eventText = (e) => e.message || e.text || e.event || e.kind || e.title || tr("알림");

async function act(a, fn) {
  B.busy.add(a.session); paint();
  try { await fn(); await new Promise((r) => setTimeout(r, 350)); await readScreen(a); }
  catch (e) { await muxy.dialog.alert({ title: tr("전달하지 못했어요"), message: String(e.message || e) }); }
  B.busy.delete(a.session); paint();
}
const sendText = (a, text, enter) => act(a, async () => {
  await mx(["session", "send", a.session, "--stdin"], 15000, text);
  if (enter) await mx(["session", "send-keys", a.session, "Enter"], 15000);
});
const sendKey = (a, key) => act(a, () => mx(["session", "send-keys", a.session, key], 15000));

/* Same monogram badges as the sidebar's Agents section. `activity` reports the display name ("Claude"), so it is
 * matched loosely; an unknown agent still gets a neutral badge with its first letter. */
const BRANDS = [
  ["claude", "C", "#d97757"], ["codex", "Cx", "#10a37f"], ["opencode", "O", "#6b7280"], ["cursor", "Cu", "#5b5bd6"],
  ["copilot", "Cp", "#8957e5"], ["droid", "D", "#e5484d"], ["grok", "G", "#3b82f6"], ["kiro", "K", "#9046ff"],
  ["antigravity", "A", "#4285f4"], ["hermes", "H", "#e67e22"], ["xal", "X", "#0ea5a5"], ["xita", "Xt", "#0ea5a5"], ["pi", "π", "#d6a100"],
];
function agentBadge(provider) {
  const key = String(provider || "").toLowerCase();
  const hit = BRANDS.find(([id]) => key.includes(id));
  const [, label, color] = hit || [null, (provider || "•").slice(0, 1).toUpperCase(), "#808080"];
  return el("span", { class: "abadge", style: `background:${color}`, title: provider }, label);
}

/* End the agent: a Muxy session is ended with `muxy session end` (saved output stays, its tab closes); XITA, which has
 * no Muxy session, gets SIGTERM. Both ask first because the running work is lost. */
async function endAgent(a) {
  const name = projectName(a);
  const ok = await muxy.dialog.confirm({
    title: tr("{0}의 {1}을(를) 종료할까요?", name, a.provider),
    message: a.external ? tr("프로세스에 종료 신호(SIGTERM)를 보내요. 하던 작업은 중단돼요.") : tr("터미널 세션 프로세스를 종료하고 그 탭도 닫혀요. 하던 작업은 중단되고 출력은 저장돼요."),
    buttons: [tr("종료"), tr("취소")], default: tr("취소"), cancel: tr("취소"),
  });
  if (!ok) return;
  await act(a, async () => {
    if (a.external) {
      const r = await muxy.exec(["kill", "-TERM", String(a.pid)], { timeoutMs: 10000 });
      if (r.exitCode !== 0) throw new Error((r.stderr || "kill failed").trim());
    } else await mx(["session", "end", a.session, "--yes"]);
  });
  B.screens.delete(a.session);
  await refresh();
}

function card(a) {
  const busy = B.busy.has(a.session);
  const scr = B.screens.get(a.session);
  const input = el("input", { type: "text", placeholder: tr("이 세션에 바로 답장… (Enter로 전송)"), value: B.draft.get(a.session) || "", disabled: busy });
  input.addEventListener("input", () => B.draft.set(a.session, input.value));
  const submit = () => { const v = input.value.trim(); if (!v) return; input.value = ""; B.draft.delete(a.session); sendText(a, v, true); }; // clear first: paint() restores a focused input's text
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) submit(); });
  const key = (label, k, cls = "") => el("button", { class: "btn " + cls, disabled: busy, onclick: () => sendKey(a, k) }, label);
  const txt = (label, t, cls = "") => el("button", { class: "btn " + cls, disabled: busy, onclick: () => sendText(a, t, false) }, label);
  const note = (t) => el("div", { class: "screen" }, el("div", { class: "meta" }, t));
  const screen = a.external ? note(tr("XITA는 상태만 표시해요 (화면 보기·답장은 지원하지 않아요)")) : scr ? (scr.error ? note(tr("화면을 읽지 못했어요: ") + scr.error) : scr.text ? renderScreen(scr.text) : note(tr("(빈 화면)"))) : note(a.state === "idle" ? tr("대기 중이에요 · ↻로 화면 보기") : tr("화면을 불러오는 중…"));
  const evs = eventsFor(a);
  const title = B.titles.get(a.session);
  const node = el("div", { class: "acard " + a.state, "data-s": a.session },
    title ? el("div", { class: "atitle", title }, title) : null,
    el("div", { class: "ahead" }, agentBadge(a.provider), el("span", { class: "prov" }, a.provider), el("span", { class: "name grow", title: dirOf(a) }, projectName(a)),
      evs.length ? el("span", { class: "bell", title: tr("알림 {0}개", evs.length) }, "🔔 " + evs.length) : null,
      el("span", { class: "st " + a.state }, PROVIDER_STATE[a.state] || a.state),
      el("button", { class: "btn mini", title: tr("이 세션 탭으로 이동"), onclick: () => (a.external ? muxy.projects.switchTo(a.project) : mx(["session", "show", a.session])).catch((e) => muxy.dialog.alert({ title: tr("열지 못했어요"), message: e.message })) }, tr("열기")),
      el("button", { class: "btn mini no", title: tr("세션 종료"), disabled: B.busy.has(a.session), onclick: () => endAgent(a) }, "×"),
      el("button", { class: "btn mini", title: tr("화면 새로고침"), onclick: async () => { if (!a.external) await readScreen(a); paint(); } }, "↻")),
    el("div", { class: "meta" }, dirOf(a)),
    el("div", { class: "screenwrap" }, screen,
      // overlaid on the screen so an incoming notification never changes the card's height
      evs.length ? el("div", { class: "toasts" }, ...evs.map((e) => el("div", { class: "toast" }, el("span", { class: "grow" }, "🔔 " + eventText(e)), el("button", { class: "btn mini", onclick: async () => { try { await mx(["activity", "ack", e.id]); } catch { /* it clears on the next refresh anyway */ } await refresh(); } }, tr("확인"))))) : null),
    !a.external && a.state === "waiting" ? el("div", { class: "keys" }, key(tr("승인 (Enter)"), "Enter", "go"), txt("1", "1"), txt("2", "2"), txt("3", "3"), key(tr("거절 (Esc)"), "Escape", "no")) : null,
    a.external ? null : el("div", { class: "reply" }, input, el("button", { class: "btn primary", disabled: busy, onclick: submit }, busy ? tr("전송 중…") : tr("보내기")),
      a.state === "working" ? el("button", { class: "btn no", disabled: busy, title: tr("작업 중단 (Ctrl+C)"), onclick: async () => { if (await muxy.dialog.confirm({ title: tr("작업을 중단할까요?"), message: tr("{0}의 {1}에 Ctrl+C를 보내요.", projectName(a), a.provider), buttons: [tr("중단"), tr("취소")], default: tr("취소"), cancel: tr("취소") })) sendKey(a, "Ctrl+C"); } }, tr("중단")) : null));
  requestAnimationFrame(() => { screen.scrollTop = screen.scrollHeight; });
  return node;
}

function paint() {
  const counts = { waiting: 0, working: 0, idle: 0 };
  for (const a of B.agents) counts[a.state] = (counts[a.state] || 0) + 1;
  $("#counts").textContent = tr("입력 대기 {0} · 작업 중 {1} · 대기 {2}", counts.waiting, counts.working, counts.idle);
  try { muxy.tabs.setTitle(counts.waiting ? tr("관제 · 대기 {0}", counts.waiting) : tr("에이전트 관제")); } catch { /* cosmetic */ }
  const shown = B.agents.filter((a) => B.filter === "all" || a.state === B.filter).sort((x, y) => RANK[x.state] - RANK[y.state]);
  // keep the text a user is typing: only the cards are rebuilt, and an input that has focus is restored afterwards
  const focused = document.activeElement && document.activeElement.closest(".acard");
  const fs = focused && focused.dataset.s, fv = focused && document.activeElement.tagName === "INPUT" ? document.activeElement.value : null;
  const scrolls = new Map([...grid.querySelectorAll(".acard")].map((c) => [c.dataset.s, c.querySelector(".screen").scrollTop]));
  grid.replaceChildren(...(shown.length ? shown.map(card) : [el("div", { class: "empty big" }, B.agents.length ? tr("이 상태의 에이전트가 없어요.") : tr("실행 중인 에이전트가 없어요."))]));
  if (fs) { const inp = grid.querySelector(`.acard[data-s="${fs}"] input`); if (inp) { inp.focus(); if (fv != null) { inp.value = fv; B.draft.set(fs, fv); } } }
  const unread = B.events.filter((e) => !B.agents.some((a) => a.session === e.session));
  alertsBox.replaceChildren(...unread.map((e) => el("div", { class: "toast" }, el("span", { class: "grow" }, "🔔 " + eventText(e)), el("button", { class: "btn mini", onclick: async () => { try { await mx(["activity", "ack", e.id]); } catch { /* ignore */ } refresh(); } }, tr("확인")))));
}

let refreshing = false;
async function refresh(force) {
  if (refreshing) return;
  refreshing = true;
  try { await readActivity(); await readTitles(); paint(); await readScreens(force); paint(); }
  catch (e) { grid.replaceChildren(errorBox(e)); }
  refreshing = false;
}

tabIcon("gauge.with.needle");
$("#refresh").addEventListener("click", () => refresh(true));
$("#filter").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  B.filter = b.dataset.f; $("#filter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  refresh();
});
muxy.events.subscribe("agent.status", () => refresh());
setInterval(() => { if (document.visibilityState === "visible" && !document.activeElement?.matches?.("input")) refresh(); }, 4000);
readProjects().then(() => refresh());
setInterval(readProjects, 20000);
