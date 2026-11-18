/* Deployment manager for one project: PR review, Actions progress, workflows and releases through `gh`.
 * PRs and failed runs can be handed to an AI agent. */
const D = { slug: null, tab: "prs", timer: null, active: false, prs: [], selected: null };
const view = $("#view");

async function init() {
  $("#title").replaceChildren(document.createTextNode(tr("배포 관리")), el("small", {}, ctx.name || ""));
  try { muxy.tabs.setTitle(tr("배포 · {0}", ctx.name || "")); } catch { /* title is cosmetic */ }
  tabIcon("shippingbox");
  try { D.slug = await repoSlug(ctx.path); } catch (e) { view.replaceChildren(errorBox(e)); return; }
  $("#title").append(el("small", {}, D.slug));
  load();
  // while something is running (a run, or checks on a PR) keep the view fresh
  D.timer = setInterval(() => { if (!document.hidden && D.active && ["prs", "runs"].includes(D.tab) && !D.busy && !RV.base) load(true); }, 15000);
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  closeRunView(true);
  D.tab = b.dataset.tab; D.selected = null;
  $("#tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  load();
});
$("#refresh").addEventListener("click", () => load());
$("#agents").addEventListener("click", () => manageAgents());

async function load(quiet) {
  if (!D.slug) return;
  if (RV.base && D.tab === "runs") { await refreshRun(); return; } // a run is open: refresh that instead of the list
  if (!quiet) view.replaceChildren(el("div", { class: "loading" }, tr("불러오는 중…")));
  try { await ({ prs, runs, workflows, releases }[D.tab])(quiet); }
  catch (e) { view.replaceChildren(errorBox(e)); }
}

async function confirmThen(title, message, button, fn) {
  const ok = await muxy.dialog.confirm({ title, message, buttons: [button, tr("취소")], default: tr("취소"), cancel: tr("취소") });
  if (!ok) return false;
  try { await fn(); } catch (e) { view.prepend(errorBox(e)); return false; }
  return true;
}

/* ---------- check / run status helpers ---------- */

function checkState(c) {
  if (c.__typename === "StatusContext") return { SUCCESS: "ok", FAILURE: "fail", ERROR: "fail", PENDING: "run", EXPECTED: "run" }[c.state] || "idle";
  if (c.status && c.status !== "COMPLETED") return "run";
  return { SUCCESS: "ok", NEUTRAL: "idle", SKIPPED: "idle", CANCELLED: "idle", FAILURE: "fail", TIMED_OUT: "fail", ACTION_REQUIRED: "fail" }[c.conclusion] || "idle";
}
function checkSummary(rollup) {
  const out = { ok: 0, fail: 0, run: 0, total: (rollup || []).length };
  for (const c of rollup || []) { const s = checkState(c); if (s === "ok") out.ok++; else if (s === "fail") out.fail++; else if (s === "run") out.run++; }
  return out;
}
function checkBadge(rollup) {
  const s = checkSummary(rollup);
  if (!s.total) return el("span", { class: "state idle" }, tr("체크 없음"));
  if (s.run) return el("span", { class: "state run" }, tr("체크 진행 중 {0}/{1}", s.ok, s.total));
  if (s.fail) return el("span", { class: "state fail" }, tr("체크 실패 {0}", s.fail));
  return el("span", { class: "state ok" }, tr("체크 통과 {0}", s.ok));
}
const REVIEW = { APPROVED: ["ok", tr("승인됨")], CHANGES_REQUESTED: ["fail", tr("변경 요청")], REVIEW_REQUIRED: ["run", tr("리뷰 필요")] };
function reviewBadge(d) { const r = REVIEW[d] || ["idle", tr("리뷰 없음")]; return el("span", { class: "state " + r[0] }, r[1]); }

function runBadge(run) {
  if (run.status !== "completed") return el("span", { class: "state run" }, run.status === "queued" ? tr("대기") : tr("실행 중"));
  const map = { success: ["ok", tr("성공")], failure: ["fail", tr("실패")], cancelled: ["idle", tr("취소")], skipped: ["idle", tr("건너뜀")], timed_out: ["fail", tr("시간 초과")] };
  const [cls, txt] = map[run.conclusion] || ["idle", run.conclusion || tr("완료")];
  return el("span", { class: "state " + cls }, txt);
}

function setSummary(parts) { $("#summary").textContent = parts.filter(Boolean).join(" · "); }

/* ---------- PR review ---------- */

async function prs(quiet) {
  const rows = await ghJSON(["pr", "list", "-R", D.slug, "--state", "open", "--limit", "40", "--json", "number,title,author,headRefName,baseRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url,labels"]);
  D.prs = rows;
  D.active = rows.some((r) => checkSummary(r.statusCheckRollup).run > 0);
  setSummary([tr("열린 PR {0}", rows.length), rows.filter((r) => r.reviewDecision === "REVIEW_REQUIRED").length ? tr("리뷰 필요 {0}", rows.filter((r) => r.reviewDecision === "REVIEW_REQUIRED").length) : null, D.active ? tr("체크 진행 중") : null]);
  const list = el("div", { class: "items" });
  const detail = el("div", { class: "detail" }, el("div", { class: "empty" }, tr("왼쪽에서 PR을 고르세요.")));
  const renderRows = () => list.replaceChildren(...(rows.length ? rows.map((r) => el("div", { class: "item" + (D.selected === r.number ? " on" : ""), onclick: () => { D.selected = r.number; renderRows(); showPr(r, detail); } },
    el("div", { class: "t" }, el("span", { class: "num" }, "#" + r.number), el("span", { class: "title" }, r.title),
      el("button", { class: "btn mini", title: tr("에이전트로 리뷰"), onclick: (e) => { e.stopPropagation(); D.selected = r.number; renderRows(); showPr(r, detail, true); } }, tr("▶ 리뷰"))),
    el("div", { class: "meta" }, r.isDraft ? chip(tr("초안")) : null, reviewBadge(r.reviewDecision), checkBadge(r.statusCheckRollup), el("span", {}, `${r.headRefName} → ${r.baseRefName}`), el("span", {}, `${(r.author || {}).login || ""} · ${ago(r.updatedAt)}`)))) : [el("div", { class: "empty" }, tr("열린 PR이 없어요."))]));
  renderRows();
  view.replaceChildren(el("div", { class: "main" }, el("div", { class: "list" }, list), detail));
  if (quiet && D.selected) { const r = rows.find((x) => x.number === D.selected); if (r) showPr(r, detail); }
}

function prPrompt(kind, pr, d, extra) {
  const failing = (d.statusCheckRollup || []).filter((c) => checkState(c) === "fail").map((c) => `- ${c.name || c.context}`).join("\n");
  const reviews = (d.reviews || []).filter((r) => r.body).map((r) => `- ${(r.author || {}).login} (${r.state}): ${r.body}`).join("\n");
  const head = [tr("저장소 {0}의 PR #{1} \"{2}\" ({3} → {4})", D.slug, pr.number, pr.title, pr.headRefName, pr.baseRefName), tr("주소: {0}", pr.url)];
  if (kind === "review") return [
    ...head, "", tr("이 PR을 코드 리뷰해 주세요."),
    "1. `gh pr view " + pr.number + "`, `gh pr diff " + pr.number + tr("`로 변경 내용을 읽으세요."),
    tr("2. 버그 가능성, 보안, 성능, 테스트 누락, 가독성 순으로 파일·라인 단위 지적을 정리하세요."),
    tr("3. 마지막에 승인/변경 요청 의견을 요약하세요. 리뷰는 직접 제출하지 말고 초안만 작성하세요."),
    extra ? tr("\n## 추가 지시\n{0}", extra) : "",
  ].join("\n");
  return [
    ...head, "", tr("이 PR 브랜치에서 리뷰 지적과 실패한 체크를 해결해 주세요."),
    failing ? tr("\n## 실패한 체크\n{0}", failing) : "", reviews ? tr("\n## 리뷰 의견\n{0}", reviews) : "",
    extra ? tr("\n## 추가 지시\n{0}", extra) : "",
    tr("\n## 진행 방식\n1. `gh pr checkout ") + pr.number + tr("`로 브랜치를 받으세요.\n2. 수정 후 테스트/린트/빌드로 검증하세요.\n3. 커밋·푸시는 하지 말고 변경 내용을 요약해 주세요."),
  ].join("\n");
}

async function showPr(pr, detail, toAgent) {
  detail.replaceChildren(el("div", { class: "loading" }, tr("불러오는 중…")));
  try {
    const d = await ghJSON(["pr", "view", String(pr.number), "-R", D.slug, "--json", "number,title,body,state,isDraft,author,headRefName,baseRefName,reviewDecision,statusCheckRollup,reviews,comments,files,additions,deletions,changedFiles,url,mergeable,createdAt"]);
    const n = d.number;
    const comment = el("textarea", { placeholder: tr("리뷰 의견 / 댓글…") });
    const msg = el("div", {});
    const reload = () => showPr(pr, detail);
    const submit = (flag, label, danger) => el("button", { class: "btn " + (danger ? "danger" : flag === "--approve" ? "primary" : ""), onclick: async () => {
      const body = comment.value.trim();
      if (flag === "--request-changes" && !body) { msg.replaceChildren(errorBox(tr("변경 요청에는 의견이 필요해요"))); return; }
      if (await confirmThen(tr("PR #{0}에 \"{1}\"을(를) 제출할까요?", n, label), body || tr("(의견 없음)"), label, () => gh(["pr", "review", String(n), "-R", D.slug, flag, ...(body ? ["-b", body] : [])]))) reload();
    } }, label);
    const mergeSel = el("select", {}); for (const [v, t] of [["--squash", "Squash"], ["--merge", "Merge commit"], ["--rebase", "Rebase"]]) mergeSel.append(el("option", { value: v }, t));
    const merge = el("button", { class: "btn danger", onclick: async () => {
      if (await confirmThen(tr("PR #{0}을(를) 머지할까요?", n), tr("{0}\n{1} → {2}\n머지 방식: {3}\n(되돌리기 어려운 동작이에요)", d.title, d.headRefName, d.baseRefName, mergeSel.selectedOptions[0].textContent), tr("머지"), () => gh(["pr", "merge", String(n), "-R", D.slug, mergeSel.value]))) load();
    } }, tr("머지"));
    const diffBox = el("div", {});
    const diffBtn = el("button", { class: "btn", onclick: async () => {
      diffBtn.disabled = true; diffBox.replaceChildren(el("div", { class: "loading" }, tr("diff를 불러오는 중…")));
      try { diffBox.replaceChildren(renderDiff(await gh(["pr", "diff", String(n), "-R", D.slug], { timeoutMs: 60000 }))); } catch (e) { diffBox.replaceChildren(errorBox(e)); }
      diffBtn.disabled = false;
    } }, tr("전체 diff 보기 (+{0} −{1}, 파일 {2})", d.additions, d.deletions, d.changedFiles));
    // one instruction box for both actions: review the PR, or fix what the review / checks found
    const prAgent = await agentForm({ placeholder: tr("에이전트에게 덧붙일 지시 (선택)"), actions: [
      { verb: tr("리뷰"), buildPrompt: (x) => prPrompt("review", pr, d, x) },
      { verb: tr("수정"), buildPrompt: (x) => prPrompt("fix", pr, d, x) },
    ] });
    detail.replaceChildren(
      el("h2", {}, `#${d.number} ${d.title}`),
      el("div", { class: "bar" }, d.isDraft ? chip(tr("초안")) : null, reviewBadge(d.reviewDecision), checkBadge(d.statusCheckRollup), el("span", { class: "meta" }, `${d.headRefName} → ${d.baseRefName}`), el("span", { class: "meta" }, `${(d.author || {}).login || ""} · ${ago(d.createdAt)}`), d.mergeable === "CONFLICTING" ? el("span", { class: "state fail" }, tr("충돌")) : null,
        el("button", { class: "btn", onclick: () => openUrl(d.url) }, tr("브라우저에서 열기"))),
      el("div", { class: "sec-title" }, tr("체크 · Actions 진행")),
      el("div", { class: "checks" }, ...(d.statusCheckRollup || []).map((c) => el("div", { class: "check" }, el("span", { class: "state " + checkState(c) }, { ok: tr("통과"), fail: tr("실패"), run: tr("진행"), idle: "-" }[checkState(c)]), el("span", {}, c.name || c.context), (c.detailsUrl || c.targetUrl) ? el("a", { href: "#", onclick: (e) => { e.preventDefault(); openUrl(c.detailsUrl || c.targetUrl); } }, tr("열기")) : null)), !(d.statusCheckRollup || []).length ? el("div", { class: "meta" }, tr("체크가 없어요")) : null),
      el("div", { class: "sec-title" }, tr("설명")),
      el("div", { class: "body" }, renderMarkdown(d.body || tr("(설명 없음)"))),
      el("div", { class: "sec-title" }, tr("변경 파일 {0}", d.changedFiles)),
      el("div", { class: "checks" }, ...(d.files || []).slice(0, 60).map((f) => el("div", { class: "check" }, el("span", { class: "state ok" }, "+" + f.additions), el("span", { class: "state fail" }, "−" + f.deletions), el("span", {}, f.path)))),
      el("div", { class: "bar" }, diffBtn), diffBox,
      el("div", { class: "sec-title" }, tr("리뷰 · 댓글")),
      ...(d.reviews || []).filter((r) => r.body || r.state !== "COMMENTED").map((r) => el("div", { class: "cmt" }, el("div", { class: "who" }, `${(r.author || {}).login || ""} · ${r.state} · ${ago(r.submittedAt)}`), r.body ? el("div", { class: "body" }, renderMarkdown(r.body)) : null)),
      ...(d.comments || []).map((c) => el("div", { class: "cmt" }, el("div", { class: "who" }, `${(c.author || {}).login || ""} · ${ago(c.createdAt)}`), el("div", { class: "body" }, renderMarkdown(c.body)))),
      el("div", { class: "sec-title" }, tr("에이전트에게 지시")), prAgent,
      el("div", { class: "sec-title" }, tr("리뷰 제출")),
      el("div", { class: "form" }, comment, msg, el("div", { class: "row" }, submit("--comment", tr("댓글만")), submit("--request-changes", tr("변경 요청"), true), submit("--approve", tr("승인")))),
      el("div", { class: "sec-title" }, tr("머지")), el("div", { class: "bar" }, mergeSel, merge)
    );
    if (toAgent) { const box = detail.querySelector(".agentbox"); if (box) { box.scrollIntoView({ block: "center" }); const go = box.querySelector(".btn.primary"); if (go) go.click(); } }
  } catch (e) { detail.replaceChildren(errorBox(e)); }
}

/* A unified diff with the usual colouring; very long diffs are cut so the tab stays responsive. */
function renderDiff(text) {
  const lines = text.split("\n"); const MAX = 3000;
  const box = el("div", { class: "diff" });
  for (const ln of lines.slice(0, MAX)) {
    const cls = ln.startsWith("diff --git") ? "file" : ln.startsWith("@@") ? "hunk" : ln.startsWith("+") && !ln.startsWith("+++") ? "add" : ln.startsWith("-") && !ln.startsWith("---") ? "del" : "";
    box.append(el("span", { class: "ln " + cls }, ln || " "));
  }
  if (lines.length > MAX) box.append(el("span", { class: "ln hunk" }, tr("… {0}줄 생략 (브라우저에서 전체 diff를 보세요)", lines.length - MAX)));
  return box;
}

/* ---------- Actions progress ---------- */

/* Where a run comes from and where it lands: a pull_request run is "work branch -> target branch" (the target is the
 * PR's base, looked up by head branch); a push run lands on the branch it was pushed to. */
function flowOf(r, prByHead) {
  const pr = prByHead.get(r.headBranch);
  if (r.event === "pull_request" || r.event === "pull_request_target") return { from: r.headBranch, to: pr ? pr.baseRefName : null, tag: pr ? `PR #${pr.number}` : "PR" };
  if (r.event === "push") return { from: null, to: r.headBranch, tag: "push" };
  return { from: null, to: r.headBranch, tag: r.event };
}

function flowEl(f) {
  return el("span", { class: "flow" },
    f.from ? el("span", { class: "br from", title: tr("작업 브랜치") }, f.from) : el("span", { class: "tag" }, f.tag),
    el("span", { class: "arrow" }, "→"),
    f.to ? el("span", { class: "br to", title: tr("병합·반영되는 브랜치") }, f.to) : el("span", { class: "br unknown" }, tr("대상 브랜치 알 수 없음")),
    f.from ? el("span", { class: "tag" }, f.tag) : null);
}

async function runs(quiet) {
  const [rows, prList] = await Promise.all([
    ghJSON(["run", "list", "-R", D.slug, "--limit", "30", "--json", "databaseId,displayTitle,status,conclusion,headBranch,workflowName,event,createdAt,url"]),
    ghJSON(["pr", "list", "-R", D.slug, "--state", "all", "--limit", "100", "--json", "number,headRefName,baseRefName"]).catch(() => []),
  ]);
  const prByHead = new Map();
  for (const p of prList) if (!prByHead.has(p.headRefName)) prByHead.set(p.headRefName, p); // newest first
  D.active = rows.some((r) => r.status !== "completed");
  const running = rows.filter((r) => r.status !== "completed").length, failed = rows.filter((r) => r.conclusion === "failure").length;
  setSummary([tr("최근 실행 {0}", rows.length), running ? tr("진행 중 {0}", running) : null, failed ? tr("실패 {0}", failed) : null]);
  if (!rows.length) { view.replaceChildren(el("div", { class: "empty" }, tr("실행 기록이 없어요."))); return; }
  const table = el("div", { class: "table" });
  for (const r of rows) {
    const acts = el("div", { class: "acts" });
    const add = (label, cls, fn) => acts.append(el("button", { class: "btn " + cls, onclick: (e) => { e.stopPropagation(); fn(); } }, label));
    if (r.status === "completed" && r.conclusion === "failure") {
      add(tr("에이전트로 수정"), "primary", () => fixRun(r));
      add(tr("실패만 재실행"), "", async () => { if (await confirmThen(tr("실패한 job을 다시 실행할까요?"), `${r.workflowName} · ${r.headBranch}`, tr("재실행"), () => gh(["run", "rerun", String(r.databaseId), "-R", D.slug, "--failed"]))) load(true); });
    }
    if (r.status === "completed") add(tr("재실행"), "", async () => { if (await confirmThen(tr("이 실행을 다시 돌릴까요?"), `${r.workflowName} · ${r.headBranch}`, tr("재실행"), () => gh(["run", "rerun", String(r.databaseId), "-R", D.slug]))) load(true); });
    else add(tr("취소"), "danger", async () => { if (await confirmThen(tr("실행을 취소할까요?"), `${r.workflowName} · ${r.headBranch}`, tr("취소하기"), () => gh(["run", "cancel", String(r.databaseId), "-R", D.slug]))) load(true); });
    // the whole row opens the live run view (jobs, steps, log)
    const row = el("div", { class: "rowx clickable", onclick: () => openRun(r) }, runBadge(r),
      el("div", { class: "grow" }, el("div", { class: "title" }, r.displayTitle),
        el("div", { class: "flowline" }, flowEl(flowOf(r, prByHead))),
        el("div", { class: "meta" }, `${r.workflowName} · ${ago(r.createdAt)}`)), acts);
    table.append(row);
  }
  view.replaceChildren(table);
}

/* A failed run: read the failed log, then hand it to an agent together with it. */
async function fixRun(r) {
  const logwrap = el("div", { class: "overlay" });
  const dlg = el("div", { class: "dialog" });
  logwrap.append(dlg);
  dlg.append(el("div", { class: "dhead" }, el("b", {}, tr("{0} · 실패 로그", r.workflowName)), el("button", { class: "btn", onclick: () => logwrap.remove() }, tr("닫기"))), el("div", { class: "loading" }, tr("로그를 불러오는 중…")));
  document.body.append(logwrap);
  let tail = "";
  try {
    const out = await gh(["run", "view", String(r.databaseId), "-R", D.slug, "--log-failed"], { timeoutMs: 60000 });
    tail = out.trim().split("\n").slice(-150).join("\n");
  } catch (e) { tail = tr("(로그를 읽지 못했어요: {0})", e.message); }
  const agent = await agentForm({ verb: tr("수정"), placeholder: tr("수정할 때 지시할 점 (선택)"),
    buildPrompt: (x) => [tr("저장소 {0}의 GitHub Actions 실행이 실패했어요.", D.slug), tr("워크플로우: {0}", r.workflowName), tr("브랜치: {0}", r.headBranch), tr("주소: {0}", r.url), "", tr("## 실패 로그 (마지막 150줄)"), tail, x ? tr("\n## 추가 지시\n{0}", x) : "", tr("\n원인을 찾아 수정하고, 로컬에서 같은 검증을 돌려 확인하세요. 커밋·푸시는 하지 말고 변경 내용을 요약해 주세요.")].join("\n") });
  dlg.replaceChildren(el("div", { class: "dhead" }, el("b", {}, tr("{0} · 실패 로그", r.workflowName)), el("button", { class: "btn", onclick: () => logwrap.remove() }, tr("닫기"))), el("pre", { class: "log" }, tail), agent);
}

/* ---------- workflows ---------- */

async function workflows() {
  const [rows, repo] = await Promise.all([ghJSON(["workflow", "list", "-R", D.slug, "--all", "--json", "id,name,state,path"]), ghJSON(["repo", "view", D.slug, "--json", "defaultBranchRef"])]);
  const branch = (repo.defaultBranchRef || {}).name || "main";
  setSummary([tr("워크플로우 {0}", rows.length)]); D.active = false;
  if (!rows.length) { view.replaceChildren(el("div", { class: "empty" }, tr("워크플로우가 없어요."))); return; }
  view.replaceChildren(el("div", { class: "table" }, ...rows.map((w) => el("div", { class: "rowx" },
    el("span", { class: "state " + (w.state === "active" ? "ok" : "idle") }, w.state === "active" ? tr("활성") : tr("비활성")),
    el("div", { class: "grow" }, el("div", { class: "title" }, w.name), el("div", { class: "meta" }, w.path)),
    el("div", { class: "acts" }, el("button", { class: "btn primary", disabled: w.state !== "active", onclick: async () => {
      const ref = await muxy.dialog.prompt({ title: tr("\"{0}\" 실행할 브랜치/태그", w.name), placeholder: branch });
      if (ref === null) return;
      confirmThen(tr("워크플로우를 실행할까요?"), tr("{0} · {1}\n(workflow_dispatch로 시작해요. 배포 워크플로우라면 실제 배포가 일어나요.)", w.name, ref.trim() || branch), tr("실행"), () => gh(["workflow", "run", String(w.id), "-R", D.slug, "--ref", ref.trim() || branch]));
    } }, tr("실행")))))));
}

/* ---------- releases ---------- */

async function releases() {
  const rows = await ghJSON(["release", "list", "-R", D.slug, "--limit", "25", "--json", "tagName,name,publishedAt,isLatest,isPrerelease,isDraft"]);
  setSummary([tr("릴리스 {0}", rows.length)]); D.active = false;
  if (!rows.length) { view.replaceChildren(el("div", { class: "empty" }, tr("릴리스가 없어요."))); return; }
  view.replaceChildren(el("div", { class: "table" }, ...rows.map((r) => el("div", { class: "rowx" },
    el("span", { class: "state " + (r.isLatest ? "ok" : "idle") }, r.isLatest ? tr("최신") : r.isDraft ? tr("초안") : r.isPrerelease ? tr("프리릴리스") : tr("릴리스")),
    el("div", { class: "grow" }, el("div", { class: "title" }, r.name || r.tagName), el("div", { class: "meta" }, `${r.tagName} · ${ago(r.publishedAt)}`)),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: () => openUrl(`https://github.com/${D.slug}/releases/tag/${encodeURIComponent(r.tagName)}`) }, tr("열기")))))));
}

init();
