/* "이슈 등록" modal: pick GitHub or Linear, write the issue in markdown, create it. Opened from the sidebar menu and
 * from the issue manager; the result ({source, url}) resolves the opener's muxy.modal.openWebview. */
const TEMPLATES = {
  [tr("버그")]: tr("## 증상\n\n## 재현 방법\n1. \n\n## 기대 동작\n\n## 환경\n"),
  [tr("기능 요청")]: tr("## 배경\n\n## 요구사항\n- [ ] \n\n## 완료 조건\n- [ ] \n"),
  [tr("작업")]: tr("## 작업 내용\n\n## 체크리스트\n- [ ] \n"),
};
const PRIORITIES = [["0", tr("우선순위 없음")], ["1", tr("긴급")], ["2", tr("높음")], ["3", tr("보통")], ["4", tr("낮음")]];
const M = { mode: "manual", source: "github", slug: null, slugError: null, teams: null, projects: null, lnProject: null };
const body = $("#body");
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
const mapKey = () => "linearMap:" + (M.slug || norm(ctx.path));
/* Issues created in this window so far; closing (button, Esc, outside) hands the last one back so the opener reloads. */
let lastCreated = null;
const finish = (result) => muxy.modal.submitWebview(result || lastCreated || null).catch(() => muxy.modal.closeWebview());

/* Same matching the issue manager uses: a saved choice wins, otherwise the repo or folder name. */
async function loadProjects() {
  if (M.projects) return M.projects;
  const all = [];
  let after = null;
  for (let page = 0; page < 3; page++) {
    const r = (await linear(`query($after: String) { projects(first: 100, after: $after) { nodes { id name state teams(first: 5) { nodes { id key name } } } pageInfo { hasNextPage endCursor } } }`, { after })).projects;
    all.push(...r.nodes);
    if (!r.pageInfo.hasNextPage) break;
    after = r.pageInfo.endCursor;
  }
  return (M.projects = all);
}
function autoMatch(projects) {
  const repo = normName((M.slug || "").split("/").pop()), folder = normName(ctx.name);
  const exact = projects.filter((p) => { const n = normName(p.name); return n && (n === repo || n === folder); });
  if (exact.length === 1) return exact[0];
  const fuzzy = projects.filter((p) => { const n = normName(p.name); return n.length >= 4 && ((repo && (n.includes(repo) || repo.includes(n))) || (folder && (n.includes(folder) || folder.includes(n)))); });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}
async function matchedProject() {
  const projects = await loadProjects();
  const saved = await store.get(mapKey(), null);
  if (saved && saved.id) return projects.find((p) => p.id === saved.id) || null;
  if (saved && saved.none) return null;
  return autoMatch(projects);
}


const PRIORITY_NAMES = ["none", "urgent", "high", "medium", "low"];
const statesCache = new Map();
async function teamStates(teamId) {
  if (!statesCache.has(teamId)) {
    const nodes = (await linear(`query($id: String!) { team(id: $id) { states { nodes { id name type color position } } } }`, { id: teamId })).team.states.nodes;
    statesCache.set(teamId, nodes.sort((a, b) => a.position - b.position));
  }
  return statesCache.get(teamId);
}

/* Team, project, status (buttons), priority and assignee. Status left unselected = the team's default status. */
function linearMeta(teams) {
  const teamSel = el("select", {}); for (const t of teams) teamSel.append(el("option", { value: t.id }, `${t.key} · ${t.name}`));
  const projSel = el("select", {}); projSel.append(el("option", { value: "" }, tr("프로젝트 없음"))); for (const p of M.projects || []) projSel.append(el("option", { value: p.id }, p.name));
  const prioSel = el("select", {}); for (const [v, t] of PRIORITIES) prioSel.append(el("option", { value: v }, t)); prioSel.value = "0";
  const me = el("input", { type: "checkbox" });
  if (M.lnProject) { projSel.value = M.lnProject.id; const t0 = ((M.lnProject.teams || {}).nodes || [])[0]; if (t0) teamSel.value = t0.id; }
  let status = null;
  const statusBox = el("div", { class: "tools" });
  const drawStatus = async () => {
    statusBox.replaceChildren(el("span", { class: "meta" }, tr("상태 불러오는 중…")));
    try {
      const states = await teamStates(teamSel.value);
      status = null;
      const paint = () => statusBox.replaceChildren(el("span", { class: "meta" }, status ? "" : tr("선택 안 하면 팀 기본 상태")),
        ...states.map((st) => el("button", { type: "button", class: "btn state" + (status === st.id ? " cur" : ""), style: `--c:${st.color}`, onclick: () => { status = status === st.id ? null : st.id; paint(); } }, st.name)));
      paint();
    } catch (e) { statusBox.replaceChildren(errorBox(e)); }
  };
  teamSel.addEventListener("change", drawStatus);
  drawStatus();
  const node = el("div", { class: "form" },
    el("div", { class: "tools" }, el("div", { class: "field" }, el("label", {}, tr("팀")), teamSel), el("div", { class: "field" }, el("label", {}, tr("프로젝트")), projSel), el("div", { class: "field" }, el("label", {}, tr("우선순위")), prioSel)),
    el("div", { class: "field" }, el("label", {}, tr("상태")), statusBox),
    el("label", { class: "tools" }, me, tr("나에게 할당")));
  return {
    node,
    teamId: () => teamSel.value, teamKey: () => (teams.find((t) => t.id === teamSel.value) || {}).key,
    projectId: () => projSel.value || null, statusId: () => status, priority: () => Number(prioSel.value),
    assignToMe: () => me.checked,
  };
}

async function show(source) {
  M.source = source;
  $("#source").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.src === source));
  try { await store.set("createSource", source); } catch { /* remembering the choice is a convenience */ }
  body.replaceChildren(el("div", { class: "loading" }, tr("에디터를 준비하는 중…")));
  const isGh = source === "github";
  let ghLabels = [], teams = [];
  try {
    if (isGh) {
      if (!M.slug) throw new Error(M.slugError || tr("GitHub 저장소를 찾지 못했어요"));
      ghLabels = await ghJSON(["label", "list", "-R", M.slug, "--limit", "100", "--json", "name,color"]).catch(() => []);
    } else {
      M.lnProject = await matchedProject();
      if (!M.teams) M.teams = (await linear("query { teams { nodes { id key name } } }")).teams.nodes;
      teams = M.teams;
    }
  } catch (e) { body.replaceChildren(errorBox(e)); return; }
  if (M.source !== source) return; // the user switched while loading
  M.ghLabels = ghLabels; M.teamList = teams;
  renderForm();
}

/* One page for both targets: the writing mode (by hand / from KakaoTalk) sits under the target switch. */
function renderForm() {
  const modeBar = el("div", { class: "seg modebar" },
    el("button", { class: M.mode === "kakao" ? "" : "on", onclick: () => { M.mode = "manual"; renderForm(); } }, tr("직접 작성")),
    el("button", { class: M.mode === "kakao" ? "on" : "", onclick: () => { M.mode = "kakao"; renderForm(); } }, tr("카카오톡 대화에서")));
  const isGh = M.source === "github";
  const label = isGh ? `GitHub · ${M.slug}` : `Linear${M.lnProject ? " · " + M.lnProject.name : ""}`;
  body.replaceChildren(el("div", { class: "tools modehead" }, el("span", { class: "meta grow" }, label), modeBar),
    M.mode === "kakao" ? kakaoFlow(M.teamList) : isGh ? githubForm(M.ghLabels) : manualForm(M.teamList));
}

function githubForm(ghLabels) {
  const isGh = true;
  const title = el("input", { type: "text", placeholder: tr("제목") });
  const text = el("textarea", { placeholder: tr("설명 (마크다운)") });
  if (ctx.prefill) { title.value = ctx.prefill.title || ""; text.value = ctx.prefill.body || ""; } // a note handed over as an issue draft
  const preview = el("div", { class: "preview", hidden: true });
  const tpl = el("select", {}); tpl.append(el("option", { value: "" }, tr("템플릿 넣기…"))); for (const k of Object.keys(TEMPLATES)) tpl.append(el("option", { value: k }, k));
  tpl.addEventListener("change", () => { if (tpl.value) { text.value = (text.value ? text.value + "\n\n" : "") + TEMPLATES[tpl.value]; tpl.value = ""; } });
  const toggle = el("button", { class: "btn", onclick: () => {
    const showing = !preview.hidden;
    preview.hidden = showing; text.hidden = !showing;
    toggle.textContent = showing ? tr("미리보기") : tr("편집");
    if (!showing) preview.replaceChildren(renderMarkdown(text.value || tr("(내용 없음)")));
  } }, tr("미리보기"));
  const me = el("input", { type: "checkbox" });
  const msg = el("div", {});
  const go = el("button", { class: "btn primary" }, tr("등록"));
  const fields = [];
  const labelBoxes = [];

  if (isGh) {
    const wrap = el("div", { class: "tools" });
    for (const l of ghLabels) { const cb = el("input", { type: "checkbox", value: l.name }); labelBoxes.push(cb); wrap.append(el("label", { class: "tools" }, cb, chip(l.name, l.color))); }
    fields.push(el("div", { class: "field" }, el("label", {}, tr("라벨")), wrap.children.length ? wrap : el("div", { class: "meta" }, tr("라벨 없음"))));
  }
  go.addEventListener("click", async () => {
    if (!title.value.trim()) { msg.replaceChildren(errorBox(tr("제목을 입력해 주세요"))); return; }
    go.disabled = true; msg.replaceChildren();
    try {
      let url;
      if (isGh) {
        const args = ["issue", "create", "-R", M.slug, "-t", title.value.trim(), "-b", text.value];
        const picked = labelBoxes.filter((c) => c.checked).map((c) => c.value); if (picked.length) args.push("-l", picked.join(","));
        if (me.checked) args.push("-a", "@me");
        url = (await gh(args)).trim();
      }
      showDone("github", url);
    } catch (e) { msg.replaceChildren(errorBox(e)); go.disabled = false; }
  });
  const wrap = (el("div", { class: "form editor" },
    title, ...fields, el("div", { class: "tools" }, tpl, el("span", { class: "grow" }), toggle), text, preview, msg,
    el("div", { class: "row" }, el("label", { class: "tools" }, me, tr("나에게 할당")), go)));
  setTimeout(() => title.focus(), 0);
  return wrap;
}

/* Before: a "created" line at the top with a single Close button. Now: the confirmation sits in the middle of the modal
 * with Close and "New issue", which opens a clean form for the next one; closing in any way (button, Esc, header Close)
 * hands back the last created issue so the opener reloads. Why: filing several issues in a row without reopening. */
function showDone(source, url) {
  lastCreated = { source, url };
  $("#source").hidden = true;
  ctx.prefill = null; // the handed-over draft was used by the first issue
  body.replaceChildren(el("div", { class: "done" }, el("h2", {}, tr("이슈를 등록했어요")),
    url ? el("div", { class: "meta" }, el("a", { href: "#", onclick: (e) => { e.preventDefault(); openUrl(url); } }, url)) : null,
    el("div", { class: "bar" },
      el("button", { class: "btn", onclick: () => finish() }, tr("닫기")),
      el("button", { class: "btn primary", onclick: () => { $("#source").hidden = false; M.mode = "manual"; show(M.source); } }, tr("신규 등록")))));
}

function manualForm(teams) {
  const title = el("input", { type: "text", placeholder: tr("제목") });
  const text = el("textarea", { placeholder: tr("설명 (마크다운)") });
  if (ctx.prefill) { title.value = ctx.prefill.title || ""; text.value = ctx.prefill.body || ""; } // a note handed over as an issue draft
  const preview = el("div", { class: "preview", hidden: true });
  const tpl = el("select", {}); tpl.append(el("option", { value: "" }, tr("템플릿 넣기…"))); for (const k of Object.keys(TEMPLATES)) tpl.append(el("option", { value: k }, k));
  tpl.addEventListener("change", () => { if (tpl.value) { text.value = (text.value ? text.value + "\n\n" : "") + TEMPLATES[tpl.value]; tpl.value = ""; } });
  const toggle = el("button", { class: "btn", onclick: () => {
    const showing = !preview.hidden;
    preview.hidden = showing; text.hidden = !showing;
    toggle.textContent = showing ? tr("미리보기") : tr("편집");
    if (!showing) preview.replaceChildren(renderMarkdown(text.value || tr("(내용 없음)")));
  } }, tr("미리보기"));
  const meta = linearMeta(teams);
  const msg = el("div", {});
  const go = el("button", { class: "btn primary" }, tr("등록"));
  go.addEventListener("click", async () => {
    if (!title.value.trim()) { msg.replaceChildren(errorBox(tr("제목을 입력해 주세요"))); return; }
    go.disabled = true; msg.replaceChildren();
    try {
      const input = { teamId: meta.teamId(), title: title.value.trim(), description: text.value, priority: meta.priority() };
      if (meta.projectId()) input.projectId = meta.projectId();
      if (meta.statusId()) input.stateId = meta.statusId();
      if (meta.assignToMe()) input.assigneeId = (await linear("query { viewer { id } }")).viewer.id;
      const r = await linear(`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`, { input });
      showDone("linear", r.issueCreate.issue.url);
    } catch (e) { msg.replaceChildren(errorBox(e)); go.disabled = false; }
  });
  const wrap = el("div", { class: "editor" }, title, meta.node, el("div", { class: "tools" }, tpl, el("span", { class: "grow" }), toggle), text, preview, msg, el("div", { class: "row" }, go));
  setTimeout(() => title.focus(), 0);
  return wrap;
}

/* ---------- KakaoTalk → Linear, through the local `kakao-linear` CLI (KakaoToLinear) ---------- */

const K = { imgs: {}, extra: "", ai: null, bin: null, rooms: null, favorites: new Set(), room: null, messages: [], picked: new Set(), anchor: null, draft: null, source: null, busy: false };
const KL_FIND = `p=$(command -v kakao-linear); for c in "$p" "$HOME/.local/bin/kakao-linear" /opt/homebrew/bin/kakao-linear /usr/local/bin/kakao-linear /Applications/KakaoToLinear.app/Contents/MacOS/kakao-linear "$HOME/Applications/KakaoToLinear.app/Contents/MacOS/kakao-linear"; do [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; exit 0; }; done; exit 1`;
async function klBin() {
  if (K.bin) return K.bin;
  const r = await muxy.exec({ shell: KL_FIND, timeoutMs: 15000 });
  if (r.exitCode !== 0 || !r.stdout.trim()) throw Object.assign(new Error(tr("kakao-linear CLI를 찾지 못했어요. 아래 버튼으로 설치하거나 PATH(예: ~/.local/bin)에 설치해 주세요.")), { noCli: true });
  return (K.bin = r.stdout.trim());
}
/* The CLI is published with each KakaoToLinear release (signed with the author's Developer ID and notarized). Installing
 * downloads the latest build, checks its sha256 (catches a damaged download only, the checksum sits in the same release),
 * and then verifies that the binary and its framework carry a valid signature of the expected Apple team before anything
 * is moved into place; the signature is what ties the files to the author, a tampered release cannot pass it. The result
 * is unpacked to ~/.local/share/kakao-linear and linked into ~/.local/bin. */
const KL_RELEASE = "https://github.com/wjchoi87/KakaoToLinear/releases/latest/download/kakao-linear-macos-arm64.zip";
const KL_TEAM = "4N5S7KDZ56";
const KL_INSTALL = `set -e
D="$HOME/.local/share/kakao-linear"; mkdir -p "$D" "$HOME/.local/bin"
T=$(mktemp -d /tmp/klinstall.XXXXXX)
curl -fsSL -o "$T/cli.zip" ${KL_RELEASE}
curl -fsSL -o "$T/cli.sha256" ${KL_RELEASE}.sha256
[ "$(shasum -a 256 "$T/cli.zip" | awk '{print $1}')" = "$(tr -d '[:space:]' < "$T/cli.sha256")" ] || { echo "checksum mismatch" >&2; exit 3; }
mkdir "$T/x"; unzip -oq "$T/cli.zip" -d "$T/x"
[ -f "$T/x/kakao-linear" ] || { echo "kakao-linear missing from the download" >&2; exit 4; }
for f in "$T/x/kakao-linear" "$T"/x/*.framework; do
  [ -e "$f" ] || continue
  codesign --verify --strict "$f" 2>/dev/null || { echo "signature check failed: $(basename "$f")" >&2; exit 5; }
  [ "$(codesign -dvv "$f" 2>&1 | sed -n 's/^TeamIdentifier=//p')" = "${KL_TEAM}" ] || { echo "unexpected signer: $(basename "$f")" >&2; exit 6; }
done
cp -R "$T/x/." "$D/"
chmod +x "$D/kakao-linear"
ln -sf "$D/kakao-linear" "$HOME/.local/bin/kakao-linear"
"$D/kakao-linear" --version`;
async function installCli() {
  const r = await muxy.exec({ shell: KL_INSTALL, timeoutMs: 180000 });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || "install failed").trim().slice(0, 400));
  K.bin = null; // look it up again
  return r.stdout.trim();
}

/* Runs the CLI and returns the `data` of its JSON envelope. */
async function kl(args, timeoutMs = 60000, stdin) {
  const bin = await klBin();
  const r = await muxy.exec([bin, ...args, "--json"], { timeoutMs, ...(stdin ? { stdin } : {}) });
  if (r.exitCode !== 0) {
    const m = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim();
    if (/Full Disk Access/i.test(m)) throw Object.assign(new Error(tr("KakaoTalk 데이터를 읽을 수 없어요. 전체 디스크 접근 권한에서 Muxy를 허용한 뒤 Muxy를 다시 실행해 주세요.")), { fda: true });
    throw new Error(m.slice(0, 600));
  }
  return JSON.parse(r.stdout).data;
}

/* ---------- photos: resolved through the CLI, shrunk with sips, shown as inline data URLs ---------- */
const IMG_BATCH = 12;
const isImage = (a) => a.kind === "image";
const pendingImages = () => K.messages.flatMap((m) => (m.attachments || []).filter(isImage)).filter((a) => !(a.id in K.imgs));

/* One shell command for the whole batch, so Muxy asks for approval once per batch rather than once per photo. */
async function loadImages(limit = IMG_BATCH) {
  const bin = await klBin();
  const ids = pendingImages().slice(-limit).map((a) => a.id).filter((id) => /^[\w.-]+$/.test(id));
  if (!ids.length) return;
  const script = `D=$(mktemp -d /tmp/mxkl.XXXXXX)
for id in ${ids.join(" ")}; do
  mkdir -p "$D/$id"
  ${shellQuote(bin)} attachment get --id "$id" --output "$D/$id" --json >/dev/null 2>&1
  f=$(ls "$D/$id"/* 2>/dev/null | head -1)
  [ -n "$f" ] && sips -Z 520 -s format jpeg "$f" --out "$D/$id.jpg" >/dev/null 2>&1 && { printf '%s\t' "$id"; base64 < "$D/$id.jpg" | tr -d '\n'; echo; }
done
rm -rf "$D"`;
  const r = await muxy.exec({ shell: script, timeoutMs: 180000 });
  for (const id of ids) K.imgs[id] = null;
  for (const line of r.stdout.split("\n")) { const [id, b64] = line.split("\t"); if (id && b64) K.imgs[id] = "data:image/jpeg;base64," + b64; }
}

function lightbox(src) {
  const box = el("div", { class: "lightbox", onclick: () => box.remove() }, el("img", { src }));
  document.body.append(box);
}

/* A row of photo thumbnails for a message; a photo that could not be loaded says so instead of vanishing. */
function photoStrip(m) {
  const imgs = (m.attachments || []).filter(isImage);
  if (!imgs.length) return null;
  return el("div", { class: "photos" }, ...imgs.map((a) => {
    const src = K.imgs[a.id];
    if (src) return el("img", { class: "photo", src, title: a.originalName || tr("사진"), onclick: (e) => { e.preventDefault(); e.stopPropagation(); lightbox(src); } });
    return el("div", { class: "photo ph" }, a.id in K.imgs ? tr("사진을 불러오지 못했어요") : tr("사진 불러오는 중…"));
  }));
}

const FDA_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
async function openFDA() {
  try { await muxy.app.openExternal(FDA_URL); } catch { await muxy.exec(["open", FDA_URL], { timeoutMs: 10000 }).catch(() => {}); }
}
/* Error box for the KakaoTalk steps; a permission problem gets a button straight to the System Settings pane. */
function kakaoErr(e) {
  const box = errorBox(e);
  if (e && e.fda) box.append(el("div", { class: "row" }, el("button", { class: "btn primary", onclick: openFDA }, tr("전체 디스크 접근 설정 열기"))));
  if (e && e.noCli) {
    const btn = el("button", { class: "btn primary" }, tr("kakao-linear 설치"));
    const note = el("div", { class: "meta" });
    btn.addEventListener("click", async () => {
      btn.disabled = true; note.textContent = tr("내려받는 중…");
      try { note.textContent = await installCli(); K.rooms = null; renderForm(); } // reload the rooms with the new CLI
      catch (err) { note.replaceChildren(errorBox(err)); btn.disabled = false; }
    });
    box.append(el("div", { class: "row" }, btn), note);
  }
  return box;
}

/* AI provider + model for the summary. "앱 설정 기본값" leaves the KakaoToLinear app's own setting alone; a choice is
 * passed per call (--provider/--model) and remembered here. */
function aiPicker() {
  if (K.ai) return K.ai;
  const prov = el("select", {}), model = el("select", {});
  const saved = { provider: "", model: "" };
  const node = el("div", { class: "tools aipick" }, el("span", { class: "meta" }, "AI"), prov, model);
  const persist = () => store.set("kakaoAI", { provider: prov.value, model: model.value }).catch(() => {});
  const fillModels = async (want) => {
    model.replaceChildren(el("option", { value: "" }, prov.value ? tr("기본 모델") : tr("앱 설정 모델")));
    model.disabled = !prov.value;
    if (!prov.value) return;
    try {
      K.models = K.models || {};
      if (!K.models[prov.value]) K.models[prov.value] = await kl(["ai", "models", "--provider", prov.value]);
      for (const m of K.models[prov.value]) model.append(el("option", { value: m.id }, m.name || m.id));
      model.value = [...model.options].some((o) => o.value === want) ? want : "";
    } catch (e) { model.replaceChildren(el("option", { value: "" }, tr("모델 목록을 못 불러왔어요"))); }
  };
  prov.addEventListener("change", async () => { await fillModels(""); persist(); });
  model.addEventListener("change", persist);
  (async () => {
    Object.assign(saved, await store.get("kakaoAI", {}).catch(() => ({})));
    prov.append(el("option", { value: "" }, tr("앱 설정 기본값")));
    try {
      K.providers = K.providers || await kl(["ai", "providers"]);
      for (const p of K.providers) prov.append(el("option", { value: p.id }, p.name));
      prov.value = [...prov.options].some((o) => o.value === saved.provider) ? saved.provider : "";
    } catch { /* the default still works without a list */ }
    await fillModels(saved.model);
  })();
  return (K.ai = { node, args: () => (prov.value ? ["--provider", prov.value, ...(model.value ? ["--model", model.value] : [])] : (model.value ? ["--model", model.value] : [])) });
}

function kakaoFlow(teams) {
  const root = el("div", { class: "kakao" });
  const draw = () => {
    root.replaceChildren(...(!K.room ? [roomStep(draw)] : !K.draft ? [messageStep(teams, draw)] : [draftStep(teams, draw)]));
  };
  draw();
  return root;
}

function roomStep(redraw) {
  const box = el("div", { class: "roomstep" });
  const q = el("input", { type: "text", placeholder: tr("대화방 검색…") });
  const list = el("div", { class: "pplist roomlist" });
  const paint = () => {
    const f = q.value.trim().toLowerCase();
    const rows = (K.rooms || []).filter((r) => !f || r.title.toLowerCase().includes(f));
    const fav = rows.filter((r) => K.favorites.has(r.id)), rest = rows.filter((r) => !K.favorites.has(r.id));
    const toggleFav = async (r, e) => {
      e.stopPropagation();
      const on = !K.favorites.has(r.id);
      on ? K.favorites.add(r.id) : K.favorites.delete(r.id); paint();
      try { await kl(["rooms", on ? "favorite" : "unfavorite", "--room", r.id]); }
      catch (err) { on ? K.favorites.delete(r.id) : K.favorites.add(r.id); paint(); box.prepend(kakaoErr(err)); }
    };
    const row = (r) => el("div", { class: "ppitem", onclick: () => { K.room = r; K.messages = []; K.picked = new Set(); K.anchor = null; redraw(); } },
      el("button", { class: "favbtn" + (K.favorites.has(r.id) ? " on" : ""), title: K.favorites.has(r.id) ? tr("즐겨찾기 해제") : tr("즐겨찾기에 추가"), onclick: (e) => toggleFav(r, e) }, K.favorites.has(r.id) ? "★" : "☆"),
      el("span", { class: "title" }, r.title), r.lastActivityAt ? el("span", { class: "meta" }, ago(r.lastActivityAt)) : null);
    const head = (t, n) => el("div", { class: "grouphead" }, `${t} `, el("span", { class: "meta" }, String(n)));
    list.replaceChildren(...(rows.length ? [
      ...(fav.length ? [head(tr("★ 즐겨찾기"), fav.length), ...fav.map(row)] : []),
      ...(rest.length ? [head(fav.length ? tr("전체 대화방") : tr("대화방"), rest.length), ...rest.map(row)] : []),
    ] : [el("div", { class: "empty" }, tr("대화방이 없어요"))]));
  };
  q.addEventListener("input", paint);
  box.append(el("div", { class: "meta" }, tr("이슈로 만들 카카오톡 대화방을 고르세요")), q, list);
  if (K.rooms) paint();
  else {
    list.replaceChildren(el("div", { class: "loading" }, tr("대화방을 불러오는 중…")));
    (async () => {
      try {
        K.rooms = await kl(["rooms", "list", "--limit", "200"]);
        try { K.favorites = new Set((await kl(["rooms", "favorites", "--limit", "1000"])).map((r) => r.id)); } catch { /* favorites are optional */ }
        paint();
      } catch (e) { list.replaceChildren(kakaoErr(e)); }
    })();
  }
  setTimeout(() => q.focus(), 0);
  return box;
}

const timeOf = (iso) => new Date(iso).toLocaleString(LOCALE, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const KIND = { image: tr("사진"), album: tr("사진"), file: tr("파일"), video: tr("동영상") };

function messageStep(teams, redraw) {
  const box = el("div", {});
  const list = el("div", { class: "pplist tall msgs chat" });
  const bar = el("div", { class: "tools" });
  const err = el("div", {});
  const sorted = () => [...K.messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const paint = () => {
    const ms = sorted();
    const keep = list.scrollTop, first = !list.dataset.shown;
    const dayOf = (m) => new Date(m.timestamp).toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
    const toggle = (m, i, e) => {
      if (e.shiftKey && K.anchor != null) {
        const [x, y] = [Math.min(K.anchor, i), Math.max(K.anchor, i)];
        for (let k = x; k <= y; k++) K.picked.add(ms[k].id);
      } else { K.picked.has(m.id) ? K.picked.delete(m.id) : K.picked.add(m.id); K.anchor = i; }
      paint();
    };
    const rows = [];
    ms.forEach((m, i) => {
      const prev = ms[i - 1];
      if (!prev || dayOf(prev) !== dayOf(m)) rows.push(el("div", { class: "daysep" }, dayOf(m)));
      if (m.type === "system") { rows.push(el("div", { class: "sysmsg" }, m.text || "")); return; }
      const mine = !!m.isMine, picked = K.picked.has(m.id);
      const sameAsPrev = prev && prev.type !== "system" && prev.senderName === m.senderName && !!prev.isMine === mine && dayOf(prev) === dayOf(m) && Math.abs(new Date(m.timestamp) - new Date(prev.timestamp)) < 5 * 60000;
      const quote = m.replyQuoteText ? el("div", { class: "quote" }, el("b", {}, m.replyAuthorName || tr("답장")), el("span", {}, m.replyQuoteText)) : null;
      const bubble = el("div", { class: "bubble" }, quote,
        m.text ? el("div", { class: "btext" }, m.text) : null, photoStrip(m),
        !m.text && !(m.attachments || []).some(isImage) ? el("div", { class: "btext dim" }, `[${KIND[m.type] || m.type}${m.attachments && m.attachments.length ? " " + m.attachments.length : ""}]`) : null);
      const time = el("span", { class: "btime" }, new Date(m.timestamp).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" }));
      rows.push(el("div", { class: "cmsg " + (mine ? "mine" : "theirs") + (picked ? " picked" : "") + (sameAsPrev ? " cont" : ""), onclick: (e) => { if (e.target.tagName === "INPUT") return; toggle(m, i, e); } },
        el("input", { type: "checkbox", checked: picked, onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? K.picked.add(m.id) : K.picked.delete(m.id); K.anchor = i; paint(); } }),
        el("div", { class: "cstack" }, mine || sameAsPrev ? null : el("div", { class: "cname" }, m.senderName),
          el("div", { class: "cline" }, mine ? time : null, bubble, mine ? null : time))));
    });
    list.replaceChildren(...(rows.length ? rows : [el("div", { class: "empty" }, tr("메시지가 없어요"))]));
    // open at the latest message, like a chat; later repaints (selecting, photos arriving) keep the scroll position
    if (first && ms.length) { list.dataset.shown = "1"; list.scrollTop = list.scrollHeight; } else list.scrollTop = keep;
    bar.replaceChildren(el("span", { class: "meta grow" }, tr("{0}개 선택 · Shift로 범위 선택", K.picked.size)),
      el("button", { class: "btn", onclick: () => { for (const m of K.messages) K.picked.add(m.id); paint(); } }, tr("전체 선택")),
      el("button", { class: "btn", disabled: !K.picked.size, onclick: () => { K.picked.clear(); paint(); } }, tr("선택 해제")));
    go.disabled = !K.picked.size || K.busy;
    const left = pendingImages().length;
    moreImgs.hidden = !left || photosBusy;
    moreImgs.textContent = tr("사진 {0}개 불러오기{1}", Math.min(left, IMG_BATCH), left > IMG_BATCH ? tr(" (남은 {0}개)", left) : "");
  };
  let photosBusy = false;
  const fetchPhotos = async () => {
    photosBusy = true; paint();
    try { await loadImages(); } catch (e) { err.replaceChildren(kakaoErr(e)); }
    photosBusy = false; paint();
  };
  const moreImgs = el("button", { class: "btn", hidden: true, onclick: fetchPhotos }, tr("사진 불러오기"));
  const more = el("button", { class: "btn", onclick: async () => {
    const oldest = sorted()[0];
    try { K.messages.push(...(await kl(["messages", "list", "--room", K.room.id, "--limit", "100", ...(oldest ? ["--before", oldest.id] : [])]))); paint(); } catch (e) { err.replaceChildren(kakaoErr(e)); }
  } }, tr("이전 메시지 더 보기"));
  const extra = el("textarea", { placeholder: tr("AI에게 덧붙일 말 (선택) — 예: 모바일 화면만 해당, 긴급, 이전 이슈와 연관") });
  extra.value = K.extra || "";
  extra.addEventListener("input", () => { K.extra = extra.value; });
  const go = el("button", { class: "btn primary", onclick: async () => {
    K.busy = true; go.disabled = true; go.textContent = tr("AI가 정리하는 중… (최대 몇 분)"); err.replaceChildren();
    try {
      const ids = sorted().filter((m) => K.picked.has(m.id)).flatMap((m) => ["--message", m.id]);
      K.source = (await kl(["source", "create", "--room", K.room.id, ...ids], 120000)).sourceId;
      K.draft = await kl(["compose", "--source", K.source, ...aiPicker().args()], 300000);
      if (K.extra.trim()) K.draft = await kl(["revise", "--draft", K.draft.id, "--instruction", K.extra.trim(), ...aiPicker().args()], 300000);
      K.busy = false; redraw();
    } catch (e) { K.busy = false; go.textContent = tr("AI로 이슈 정리"); err.replaceChildren(kakaoErr(e)); paint(); }
  } }, tr("AI로 이슈 정리"));
  box.append(el("div", { class: "tools" }, el("b", { class: "grow" }, K.room.title), el("button", { class: "btn", onclick: () => { K.room = null; redraw(); } }, tr("대화방 변경"))), bar, list, extra, aiPicker().node, el("div", { class: "hint" }, tr("'AI로 이슈 정리'를 누르면 선택한 메시지가 위에서 고른 AI 제공자로 전송돼요.")), err, el("div", { class: "row" }, moreImgs, more, go));
  if (K.messages.length) paint();
  else {
    list.replaceChildren(el("div", { class: "loading" }, tr("메시지를 불러오는 중…")));
    kl(["messages", "list", "--room", K.room.id, "--limit", "100"]).then((ms) => { K.messages = ms; paint(); fetchPhotos(); }).catch((e) => list.replaceChildren(kakaoErr(e)));
  }
  return box;
}

/* GitHub has no import of the CLI's description, so the issue body is built here from the same draft. */
function draftMarkdown(d) {
  const list = (title, items) => (items && items.length ? `## ${title}\n${items.map((x) => `- ${x}`).join("\n")}\n\n` : "");
  const picked = K.messages.filter((m) => K.picked.has(m.id)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const quotes = picked.map((m) => `> **${m.senderName}** (${timeOf(m.timestamp)}) ${(m.text || (KIND[m.type] ? `[${KIND[m.type]}]` : "")).replace(/\n/g, "\n> ")}`).join("\n>\n");
  return tr("{0}{1}{2}{3}{4}---\n\n## 원본 대화 ({5})\n{6}\n", d.summary ? d.summary + "\n\n" : "", list(tr("요청사항"), d.requirements), list(tr("완료 조건"), d.acceptanceCriteria), list(tr("참고사항"), d.notes), list(tr("확인 필요"), d.questions), K.room.title, quotes);
}

function draftStep(teams, redraw) {
  const box = el("div", {});
  const isGh = M.source === "github";
  const meta = isGh ? null : linearMeta(teams);
  const err = el("div", {});
  const preview = el("div", { class: "preview" }, el("div", { class: "loading" }, tr("미리보기를 만드는 중…")));
  const attach = el("div", { class: "meta" });
  const instr = el("textarea", { placeholder: tr("추가로 제안하거나 덧붙일 내용 (예: PC 범위는 빼고 태블릿 조건을 추가해, 완료 조건에 로그 확인을 넣어줘)") });
  const reviseBtn = el("button", { class: "btn" }, tr("AI에게 반영 요청"));
  const go = el("button", { class: "btn primary" }, isGh ? tr("GitHub에 등록") : tr("Linear에 등록"));
  let ghTitle, ghBody, ghLabels = [], ghMe;

  const draw = async () => {
    if (isGh) {
      ghTitle = el("input", { type: "text", value: K.draft.title });
      ghBody = el("textarea", {}); ghBody.value = draftMarkdown(K.draft); ghBody.style.minHeight = "220px";
      preview.replaceChildren(el("div", { class: "field" }, el("label", {}, tr("제목")), ghTitle), el("div", { class: "field" }, el("label", {}, tr("본문 (직접 고쳐도 돼요)")), ghBody));
      attach.textContent = picked_attachments();
      return;
    }
    try {
      const r = await kl(["linear", "create", "--draft", K.draft.id, "--team", meta.teamKey(), "--dry-run"]);
      preview.replaceChildren(el("h3", {}, r.title), renderMarkdown(r.description));
      attach.textContent = r.attachmentNames && r.attachmentNames.length ? tr("첨부 {0}개 (Linear에 함께 올라가요): {1}", r.attachmentNames.length, r.attachmentNames.join(", ")) : tr("첨부 없음");
    } catch (e) { preview.replaceChildren(kakaoErr(e)); }
  };
  const picked_attachments = () => {
    const n = K.messages.filter((m) => K.picked.has(m.id)).reduce((a, m) => a + ((m.attachments || []).length), 0);
    return n ? tr("사진·파일 {0}개는 GitHub 이슈에 자동 첨부되지 않아요. 필요하면 등록 후 직접 올려 주세요.", n) : "";
  };
  reviseBtn.addEventListener("click", async () => {
    if (!instr.value.trim()) return;
    reviseBtn.disabled = true; go.disabled = true; reviseBtn.textContent = tr("반영하는 중…"); err.replaceChildren();
    try { K.draft = await kl(["revise", "--draft", K.draft.id, "--instruction", instr.value.trim(), ...aiPicker().args()], 300000); instr.value = ""; preview.replaceChildren(el("div", { class: "loading" }, tr("미리보기를 만드는 중…"))); await draw(); }
    catch (e) { err.replaceChildren(kakaoErr(e)); }
    reviseBtn.disabled = false; go.disabled = false; reviseBtn.textContent = tr("AI에게 반영 요청");
  });
  go.addEventListener("click", async () => {
    go.disabled = true; reviseBtn.disabled = true; err.replaceChildren();
    try {
      let url;
      if (isGh) {
        if (!ghTitle.value.trim()) throw new Error(tr("제목을 입력해 주세요"));
        const args = ["issue", "create", "-R", M.slug, "-t", ghTitle.value.trim(), "-b", ghBody.value];
        const labels = ghLabels.filter((c) => c.checked).map((c) => c.value); if (labels.length) args.push("-l", labels.join(","));
        if (ghMe.checked) args.push("-a", "@me");
        url = (await gh(args)).trim();
      } else {
        const args = ["linear", "create", "--draft", K.draft.id, "--team", meta.teamKey(), "--priority", PRIORITY_NAMES[meta.priority()]];
        if (meta.projectId()) args.push("--project", meta.projectId());
        if (meta.statusId()) args.push("--status", meta.statusId());
        if (meta.assignToMe()) args.push("--assignee", (await linear("query { viewer { id } }")).viewer.id);
        url = (await kl(args, 180000)).url;
      }
      K.room = null; K.draft = null; K.picked = new Set(); K.messages = []; K.extra = "";
      showDone(M.source, url);
    } catch (e) { err.replaceChildren(kakaoErr(e)); go.disabled = false; reviseBtn.disabled = false; }
  });

  let targetFields;
  if (isGh) {
    const labelWrap = el("div", { class: "tools" });
    for (const l of M.ghLabels || []) { const cb = el("input", { type: "checkbox", value: l.name }); ghLabels.push(cb); labelWrap.append(el("label", { class: "tools" }, cb, chip(l.name, l.color))); }
    ghMe = el("input", { type: "checkbox" });
    targetFields = el("div", { class: "form" }, el("div", { class: "field" }, el("label", {}, tr("라벨")), labelWrap.children.length ? labelWrap : el("div", { class: "meta" }, tr("라벨 없음"))), el("label", { class: "tools" }, ghMe, tr("나에게 할당")));
  } else targetFields = meta.node;

  // photos of the picked messages, so the preview can be checked against what the conversation showed
  const shots = el("div", { class: "draftphotos" });
  const pickedPhotos = () => ({ attachments: K.messages.filter((m) => K.picked.has(m.id)).flatMap((m) => (m.attachments || []).filter(isImage)) });
  const drawShots = () => shots.replaceChildren(...[photoStrip(pickedPhotos())].filter(Boolean));
  drawShots();
  if (pickedPhotos().attachments.some((a) => !(a.id in K.imgs))) loadImages().catch(() => {}).then(drawShots);
  box.append(el("div", { class: "tools" }, el("b", { class: "grow" }, tr("{0} · 메시지 {1}개", K.room.title, K.picked.size)),
    el("button", { class: "btn", onclick: () => { K.draft = null; redraw(); } }, tr("메시지 다시 선택"))),
    preview, shots, attach, instr, aiPicker().node, el("div", { class: "row" }, reviseBtn), targetFields, err, el("div", { class: "row" }, go));
  draw();
  return box;
}

$("#source").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.src); });
$("#close").addEventListener("click", () => finish());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") finish(); });
(async () => {
  $("#title").textContent = tr("이슈 등록 · {0}", ctx.name || "");
  try { M.slug = await repoSlug(ctx.path); } catch (e) { M.slugError = e.message; }
  const last = await store.get("createSource", null).catch(() => null);
  await show(last === "linear" || !M.slug ? "linear" : "github");
})();
