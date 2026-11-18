/* Issue manager for one project: GitHub issues through `gh`, Linear issues through its GraphQL API.
 * Every issue can be handed to an AI agent, and new issues are written in a markdown editor. */
const S = { source: "github", slug: null, slugError: null, list: [], selected: null, query: "", ghState: "open", lnScope: "mine", teams: [], lnProjects: null, lnProject: null, lnAuto: false };
const items = $("#items"), detail = $("#detail"), filters = $("#filters"), banner = $("#banner");
const mapKey = () => "linearMap:" + (S.slug || norm(ctx.path));

async function init() {
  $("#title").replaceChildren(document.createTextNode(tr("이슈 관리")), el("small", {}, ctx.name || ""));
  try { muxy.tabs.setTitle(tr("이슈 · {0}", ctx.name || "")); } catch { /* title is cosmetic */ }
  tabIcon("exclamationmark.bubble");
  try { S.slug = await repoSlug(ctx.path); } catch (e) { S.slugError = e.message; S.source = "linear"; }
  $("#source").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.src === S.source));
  renderFilters();
  await load();
}

$("#source").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.source = b.dataset.src; S.selected = null; S.query = "";
  $("#source").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  detail.replaceChildren(el("div", { class: "empty" }, tr("왼쪽에서 이슈를 고르세요.")));
  renderFilters(); load();
});
$("#refresh").addEventListener("click", () => load());
$("#new").addEventListener("click", () => showCreate());
$("#agents").addEventListener("click", () => manageAgents());

function renderFilters() {
  const q = el("input", { type: "text", placeholder: tr("검색 (Enter)"), value: S.query });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { S.query = q.value.trim(); load(); } });
  const sel = el("select", {});
  const opts = S.source === "github" ? [["open", tr("열림")], ["closed", tr("닫힘")], ["all", tr("전체")]]
    : [...(S.lnProject ? [["project", tr("이 프로젝트")]] : []), ["mine", tr("내 이슈")]];
  for (const [v, t] of opts) sel.append(el("option", { value: v }, t));
  sel.value = S.source === "github" ? S.ghState : opts.some(([v]) => v === S.lnScope) ? S.lnScope : "mine";
  sel.addEventListener("change", () => { if (S.source === "github") S.ghState = sel.value; else { S.lnScope = sel.value; S.lnTouched = true; } load(); });
  filters.replaceChildren(q, sel);
}

async function load() {
  items.replaceChildren(el("div", { class: "loading" }, tr("불러오는 중…")));
  try {
    if (S.source === "linear") { await ensureLinearProject(); renderFilters(); renderBanner(); } else { banner.hidden = true; }
    S.list = S.source === "github" ? await loadGithub() : await loadLinear();
    renderList();
  } catch (e) { items.replaceChildren(errorBox(e)); }
}

function renderList() {
  if (!S.list.length) { items.replaceChildren(el("div", { class: "empty" }, tr("이슈가 없어요."))); return; }
  items.replaceChildren(...S.list.map((it) => el("div", { class: "item" + (S.selected === it.key ? " on" : "") + (it.isGroup ? " group" : "") + (it.depth ? " child" : ""), onclick: () => select(it) },
    el("div", { class: "t" }, el("span", { class: "num" }, it.num), it.isGroup ? el("span", { class: "gbadge" }, tr("그룹 {0}", it.kids)) : null, el("span", { class: "title" }, it.title),
      el("button", { class: "btn mini", title: it.isGroup ? tr("하위 이슈까지 한 번에 에이전트로 진행") : tr("에이전트로 바로 진행"), onclick: (e) => { e.stopPropagation(); select(it, true); } }, it.isGroup ? tr("▶ 그룹 진행") : tr("▶ 진행"))),
    el("div", { class: "meta" }, it.meta))));
}

function select(it, toAgent) {
  S.selected = it.key; renderList();
  detail.replaceChildren(el("div", { class: "loading" }, tr("불러오는 중…")));
  (S.source === "github" ? showGithub(it) : showLinear(it))
    .then(() => { if (toAgent) { const box = detail.querySelector(".agentbox"); if (box) { box.scrollIntoView({ block: "center" }); const go = box.querySelector(".btn.primary"); if (go) go.click(); } } })
    .catch((e) => detail.replaceChildren(errorBox(e)));
}

/* ---------------- prompts handed to agents ---------------- */

function issuePrompt(kind, d, extra) {
  const comments = (d.comments || []).map((c) => `- ${c.who}: ${c.body}`).join("\n");
  return [
    tr("다음 {0} 이슈를 이 저장소({1})에서 해결해 주세요.", kind, S.slug || ctx.name),
    "",
    tr("제목: {0}", d.title), tr("번호: {0}", d.num), tr("주소: {0}", d.url), "",
    tr("## 이슈 본문"), d.body || tr("(본문 없음)"),
    comments ? tr("\n## 코멘트\n{0}", comments) : "",
    (d.children || []).length ? tr("\n## 하위 이슈 ({0}개 — 위 이슈와 함께 한 번에 모두 처리)\n", d.children.length) + d.children.map((k) => `### ${k.identifier} ${k.title} [${k.state.name}]\n${k.url}\n${k.description || tr("(본문 없음)")}`).join("\n\n") : "",
    extra ? tr("\n## 추가 지시\n{0}", extra) : "",
    "",
    tr("## 진행 방식"),
    tr("1. 먼저 관련 코드를 조사하고(하위 이슈가 있으면 전부 함께 파악하고) 접근 계획을 짧게 알려주세요."),
    tr("2. 구현한 뒤 이 프로젝트의 테스트/린트/빌드 스크립트로 검증하세요."),
    tr("3. 커밋·푸시는 하지 말고, 변경 내용과 검증 결과를 요약해 주세요."),
  ].filter((l) => l !== null).join("\n");
}

/* ---------------- GitHub ---------------- */

/* Assignee shown on every list row; unassigned issues say so instead of showing nothing. */
const who = (name) => el("span", { class: "assignee" + (name ? "" : " none") }, name ? "👤 " + name : tr("담당자 없음"));

async function loadGithub() {
  if (!S.slug) throw new Error(S.slugError || tr("GitHub 저장소를 찾지 못했어요"));
  const args = ["issue", "list", "-R", S.slug, "--state", S.ghState, "--limit", "60", "--json", "number,title,state,labels,assignees,updatedAt,author,comments"];
  if (S.query) args.push("--search", S.query);
  const rows = await ghJSON(args);
  return rows.map((r) => ({
    key: "gh" + r.number, num: "#" + r.number, title: r.title, raw: r,
    meta: [chip(r.state === "OPEN" ? tr("열림") : tr("닫힘")), ...r.labels.slice(0, 3).map((l) => chip(l.name, l.color)), who(r.assignees.map((a) => a.login).join(", ")), ago(r.updatedAt), r.comments && r.comments.length ? tr("댓글 {0}", r.comments.length) : null].filter(Boolean)
      .map((m) => (typeof m === "string" ? el("span", {}, m) : m)),
  }));
}

async function showGithub(it) {
  const n = it.raw.number;
  const d = await ghJSON(["issue", "view", String(n), "-R", S.slug, "--json", "number,title,body,state,labels,assignees,author,createdAt,comments,url"]);
  const open = d.state === "OPEN";
  const comment = el("textarea", { placeholder: tr("댓글 작성…") });
  const btns = [];
  const act = async (fn) => {
    btns.forEach((b) => { b.disabled = true; });
    try { await fn(); await load(); await showGithub(it); } catch (e) { detail.prepend(errorBox(e)); btns.forEach((b) => { b.disabled = false; }); }
  };
  const send = el("button", { class: "btn primary", onclick: () => comment.value.trim() && act(() => gh(["issue", "comment", String(n), "-R", S.slug, "-b", comment.value.trim()])) }, tr("댓글 달기"));
  const toggle = el("button", { class: "btn " + (open ? "danger" : ""), onclick: async () => {
    const ok = await muxy.dialog.confirm({ title: open ? tr("#{0} 이슈를 닫을까요?", n) : tr("#{0} 이슈를 다시 열까요?", n), message: d.title, buttons: [open ? tr("닫기") : tr("다시 열기"), tr("취소")], default: tr("취소"), cancel: tr("취소") });
    if (ok) act(() => gh(["issue", open ? "close" : "reopen", String(n), "-R", S.slug]));
  } }, open ? tr("이슈 닫기") : tr("다시 열기"));
  const web = el("button", { class: "btn", onclick: () => openUrl(d.url) }, tr("브라우저에서 열기"));
  btns.push(send, toggle, web);
  const agent = await agentForm({ verb: tr("진행하기"), buildPrompt: (extra) => issuePrompt("GitHub", { title: d.title, num: "#" + d.number, url: d.url, body: d.body, comments: d.comments.map((c) => ({ who: (c.author || {}).login, body: c.body })) }, extra) });
  detail.replaceChildren(
    el("h2", {}, `#${d.number} ${d.title}`),
    el("div", { class: "bar" }, el("span", { class: "state " + (open ? "open" : "closed") }, open ? tr("열림") : tr("닫힘")),
      ...d.labels.map((l) => chip(l.name, l.color)), el("span", { class: "meta" }, `${(d.author || {}).login || ""} · ${ago(d.createdAt)}`),
      el("span", { class: "meta" }, tr("담당: ") + (d.assignees.length ? d.assignees.map((a) => a.login).join(", ") : tr("없음")))),
    el("div", { class: "body" }, renderMarkdown(d.body || tr("(본문 없음)"))),
    ...d.comments.map((c) => el("div", { class: "cmt" }, el("div", { class: "who" }, `${(c.author || {}).login || ""} · ${ago(c.createdAt)}`), el("div", { class: "body" }, renderMarkdown(c.body)))),
    agent,
    el("div", { class: "form" }, comment, el("div", { class: "row" }, toggle, web, send))
  );
}

/* ---------------- Linear ---------------- */

const LN_FIELDS = "id identifier title url updatedAt priorityLabel state { id name type color } team { id key name } assignee { name } project { id name } parent { id identifier title }";
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

/* Linear caps query complexity, so projects come in pages of 100 with only a few teams each (up to 300 projects). */
async function loadLinearProjects() {
  if (S.lnProjects) return S.lnProjects;
  const all = [];
  let after = null;
  for (let page = 0; page < 3; page++) {
    const r = (await linear(`query($after: String) { projects(first: 100, after: $after) { nodes { id name state teams(first: 5) { nodes { id key name } } } pageInfo { hasNextPage endCursor } } }`, { after })).projects;
    all.push(...r.nodes);
    if (!r.pageInfo.hasNextPage) break;
    after = r.pageInfo.endCursor;
  }
  S.lnProjects = all;
  return all;
}

/* A project is matched to a Linear project by name (repo name or folder name); a saved choice always wins. */
function autoMatch(projects) {
  const repo = normName((S.slug || "").split("/").pop()), folder = normName(ctx.name);
  const exact = projects.filter((p) => { const n = normName(p.name); return n && (n === repo || n === folder); });
  if (exact.length === 1) return exact[0];
  const fuzzy = projects.filter((p) => { const n = normName(p.name); return n.length >= 4 && ((repo && (n.includes(repo) || repo.includes(n))) || (folder && (n.includes(folder) || folder.includes(n)))); });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

async function ensureLinearProject() {
  const projects = await loadLinearProjects();
  const saved = await store.get(mapKey(), null);
  if (saved && saved.id) { S.lnProject = projects.find((p) => p.id === saved.id) || { id: saved.id, name: saved.name, teams: { nodes: [] } }; S.lnAuto = false; }
  else if (saved && saved.none) { S.lnProject = null; S.lnAuto = false; }
  else { S.lnProject = autoMatch(projects); S.lnAuto = !!S.lnProject; }
  if (S.lnProject && S.lnScope === "mine" && !S.lnTouched) S.lnScope = "project";
  if (!S.lnProject && S.lnScope === "project") S.lnScope = "mine";
}

/* Searchable project chooser: a filter box over a scrolling list. `extra` are fixed entries shown first (e.g. "none"). */
function projectPicker({ current, extra, onPick }) {
  const q = el("input", { type: "text", placeholder: tr("프로젝트 검색…") });
  const list = el("div", { class: "pplist" });
  const draw = () => {
    const f = normName(q.value);
    const rows = [...extra.map((e) => ({ ...e, fixed: true })), ...(S.lnProjects || [])].filter((p) => p.fixed || !f || normName(p.name).includes(f));
    list.replaceChildren(...(rows.length ? rows.map((p) => el("div", { class: "ppitem" + (p.fixed ? " fixed" : "") + (current && p.id === current ? " cur" : ""), onclick: () => onPick(p) },
      el("span", { class: "title" }, p.name), p.teams && p.teams.nodes.length ? el("span", { class: "meta" }, p.teams.nodes.map((t) => t.key).join(", ")) : null))
      : [el("div", { class: "empty" }, tr("일치하는 프로젝트가 없어요"))]));
  };
  q.addEventListener("input", draw);
  draw();
  setTimeout(() => q.focus(), 0);
  return el("div", { class: "pp" }, q, list);
}

function renderBanner(forceSelect) {
  banner.hidden = false;
  const choose = forceSelect || !S.lnProject;
  if (!choose) {
    banner.replaceChildren(el("span", { class: "grow" }, tr("Linear 프로젝트: "), el("b", {}, S.lnProject.name), S.lnAuto ? tr("  (이름으로 자동 매칭됨)") : ""),
      el("button", { class: "btn", onclick: () => renderBanner(true) }, tr("변경")));
    return;
  }
  const pick = async (p) => {
    await store.set(mapKey(), p.id === "__none__" ? { none: true } : { id: p.id, name: p.name });
    S.lnTouched = false; load();
  };
  banner.replaceChildren(el("div", { class: "grow" },
    el("div", { class: "bhead" }, el("span", { class: "grow" }, S.lnProject ? tr("이 저장소에 연결할 Linear 프로젝트") : tr("이 저장소와 매칭되는 Linear 프로젝트를 찾지 못했어요. 직접 선택해 주세요.")),
      S.lnProject ? el("button", { class: "btn", onclick: () => renderBanner(false) }, tr("취소")) : null),
    projectPicker({ current: S.lnProject && S.lnProject.id, extra: [{ id: "__none__", name: tr("매칭 없음 (내 이슈만 보기)") }], onPick: pick })));
}

async function loadLinear() {
  const filter = { state: { type: { nin: ["completed", "canceled"] } } };
  if (S.lnScope === "project" && S.lnProject) filter.project = { id: { eq: S.lnProject.id } };
  else filter.assignee = { isMe: { eq: true } };
  if (S.query) filter.or = [{ title: { containsIgnoreCase: S.query } }, { number: { eq: Number(S.query.replace(/\D/g, "")) || -1 } }];
  const data = await linear(`query($filter: IssueFilter) { issues(first: 60, filter: $filter, orderBy: updatedAt) { nodes { ${LN_FIELDS} } } }`, { filter });
  const rows = data.issues.nodes.map((r) => ({
    key: "ln" + r.id, num: r.identifier, title: r.title, raw: r,
    meta: [chip(r.state.name, r.state.color), r.team && r.team.key, who(r.assignee && r.assignee.name), ago(r.updatedAt), r.priorityLabel !== "No priority" ? r.priorityLabel : null].filter(Boolean)
      .map((m) => (typeof m === "string" ? el("span", {}, m) : m)),
  }));
  return groupByParent(rows);
}

/* Linear "group" issues are parents with sub-issues. Children are listed right under their parent; a parent that is
 * not itself in the result (filtered out) still gets a header so the group stays visible. */
function groupByParent(rows) {
  const byId = new Map(rows.map((r) => [r.raw.id, r]));
  const kids = new Map();
  for (const r of rows) { const pid = r.raw.parent && r.raw.parent.id; if (pid) (kids.get(pid) || kids.set(pid, []).get(pid)).push(r); }
  const out = [], done = new Set();
  const addGroup = (head, children) => {
    head.isGroup = true; head.kids = children.length;
    out.push(head); done.add(head.key);
    for (const c of children) { c.depth = 1; out.push(c); done.add(c.key); }
  };
  for (const r of rows) {
    if (done.has(r.key)) continue;
    const pid = r.raw.parent && r.raw.parent.id;
    if (kids.has(r.raw.id)) addGroup(r, kids.get(r.raw.id).filter((c) => !done.has(c.key)));
    else if (pid && !byId.has(pid)) {
      const pr = r.raw.parent, siblings = kids.get(pid).filter((c) => !done.has(c.key));
      addGroup({ key: "ln" + pid, num: pr.identifier, title: pr.title, raw: { id: pid }, meta: [el("span", {}, tr("상위 이슈 (이 목록 밖)"))] }, siblings);
    } else if (!pid) out.push(r), done.add(r.key);
  }
  return out;
}

async function showLinear(it) {
  const d = (await linear(`query($id: String!) { issue(id: $id) { ${LN_FIELDS} description createdAt comments { nodes { id body createdAt user { name } } } team { states { nodes { id name type color } } } children(first: 50) { nodes { id identifier title description url state { name type color } assignee { name } } } } }`, { id: it.raw.id })).issue;
  const kids = d.children.nodes;
  const openKids = kids.filter((k) => k.state.type !== "completed" && k.state.type !== "canceled"); // finished sub-issues are not handed to the agent
  const comment = el("textarea", { placeholder: tr("댓글 작성…") });
  const btns = [];
  const act = async (fn) => {
    btns.forEach((b) => { b.disabled = true; });
    try { await fn(); await load(); await showLinear(it); } catch (e) { detail.prepend(errorBox(e)); btns.forEach((b) => { b.disabled = false; }); }
  };
  const stateBtns = d.team.states.nodes.map((s) => el("button", {
    class: "btn state" + (s.id === d.state.id ? " cur" : ""), style: `--c:${s.color}`, disabled: s.id === d.state.id, title: s.id === d.state.id ? tr("현재 상태") : tr("이 상태로 변경"),
    onclick: () => act(() => linear(`mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }`, { id: d.id, s: s.id })),
  }, s.name));
  const setProject = (p) => act(() => linear(`mutation($id: String!, $p: String) { issueUpdate(id: $id, input: { projectId: $p }) { success } }`, { id: d.id, p: p.id || null }));
  const projBox = el("div", { class: "grow" });
  const projBtn = el("button", { class: "btn", onclick: () => {
    projBox.replaceChildren(projectPicker({ current: d.project && d.project.id, extra: [{ id: "", name: tr("프로젝트 없음") }], onPick: (p) => (p.id || null) !== (d.project ? d.project.id : null) ? setProject(p) : projBox.replaceChildren() }));
  } }, d.project ? tr("프로젝트 변경") : tr("프로젝트 연결"));
  const send = el("button", { class: "btn primary", onclick: () => comment.value.trim() && act(() => linear(`mutation($id: String!, $b: String!) { commentCreate(input: { issueId: $id, body: $b }) { success } }`, { id: d.id, b: comment.value.trim() })) }, tr("댓글 달기"));
  const web = el("button", { class: "btn", onclick: () => openUrl(d.url) }, tr("브라우저에서 열기"));
  btns.push(...stateBtns, projBtn, send, web);
  const agent = await agentForm({ verb: tr("진행하기"), buildPrompt: (extra) => issuePrompt("Linear", { title: d.title, num: d.identifier, url: d.url, body: d.description, comments: d.comments.nodes.map((c) => ({ who: (c.user || {}).name, body: c.body })), children: openKids }, extra) });
  detail.replaceChildren(
    el("h2", {}, `${d.identifier} ${d.title}`),
    el("div", { class: "bar" }, chip(d.state.name, d.state.color), d.team && el("span", { class: "meta" }, d.team.key), d.project && el("span", { class: "meta" }, tr("프로젝트: ") + d.project.name), el("span", { class: "meta" }, `${d.assignee ? d.assignee.name : tr("담당자 없음")} · ${ago(d.createdAt)}`)),
    d.parent ? el("div", { class: "bar" }, el("span", { class: "meta" }, tr("상위 그룹")), el("a", { href: "#", onclick: (e) => { e.preventDefault(); select({ key: "ln" + d.parent.id, raw: { id: d.parent.id } }); } }, `${d.parent.identifier} ${d.parent.title}`)) : null,
    el("div", { class: "bar" }, el("span", { class: "meta" }, tr("상태")), ...stateBtns),
    el("div", { class: "bar" }, el("span", { class: "meta" }, tr("프로젝트")), el("b", {}, d.project ? d.project.name : tr("없음")), projBtn),
    projBox,
    el("div", { class: "body" }, renderMarkdown(d.description || tr("(설명 없음)"))),
    kids.length ? el("div", { class: "subs" }, el("div", { class: "meta" }, tr("하위 이슈 {0}개 (미완료 {1}개) — 에이전트로 진행하면 미완료 이슈가 모두 함께 처리돼요", kids.length, openKids.length)),
      ...kids.map((k) => el("div", { class: "sub", onclick: () => select({ key: "ln" + k.id, raw: { id: k.id } }) }, el("span", { class: "num" }, k.identifier), el("span", { class: "title" }, k.title), chip(k.state.name, k.state.color), who(k.assignee && k.assignee.name)))) : null,
    ...d.comments.nodes.map((c) => el("div", { class: "cmt" }, el("div", { class: "who" }, `${(c.user || {}).name || ""} · ${ago(c.createdAt)}`), el("div", { class: "body" }, renderMarkdown(c.body)))),
    agent,
    el("div", { class: "form" }, comment, el("div", { class: "row" }, web, send))
  );
}

/* Creating an issue happens in a modal shared with the sidebar menu. */
async function showCreate() {
  const done = await muxy.modal.openWebview({ entry: "modal/create.html", width: 840, height: 760, dismissOnOutsideClick: false, data: { name: ctx.name, path: ctx.path } });
  if (done) load();
}

init();
