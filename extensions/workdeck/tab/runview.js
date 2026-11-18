/* Live view of one Actions run inside the Deploys tab: jobs and steps with their progress and timings, and the log of the
 * chosen job. While the run is in progress it is polled every few seconds (progress, elapsed time, log tail), so the work
 * can be followed here instead of on GitHub. Uses the same `gh` calls as the rest of the tab; opened from a run row. */
const RV = { base: null, data: null, jobId: null, auto: true, log: "", logJob: null, logErr: null, follow: true, timer: null, clock: null, busy: false, err: null };
const RV_POLL_MS = 4000;
const RV_MAX_LINES = 4000;
const RV_FIELDS = "databaseId,displayTitle,status,conclusion,headBranch,workflowName,event,createdAt,startedAt,updatedAt,url,jobs";

const rvState = (o) => (o.status !== "completed" ? (o.status === "queued" || o.status === "waiting" || o.status === "pending" ? "queued" : "run") : { success: "ok", failure: "fail", timed_out: "fail", startup_failure: "fail" }[o.conclusion] || "idle");
const rvLabel = { queued: tr("대기"), run: tr("진행"), ok: tr("성공"), fail: tr("실패"), idle: tr("건너뜀·취소") };
const rvRunning = () => !!RV.data && RV.data.status !== "completed";

function fmtDur(ms) {
  if (!(ms >= 0)) return "";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
/* A duration element: ticking once a second while the thing is running, fixed once it is done. */
function clock(startedAt, completedAt) {
  const t0 = Date.parse(startedAt);
  if (!t0 || Number.isNaN(t0)) return el("span", { class: "clk" });
  const t1 = completedAt ? Date.parse(completedAt) : null;
  const node = el("span", { class: "clk", "data-start": String(t0) }, fmtDur((t1 || Date.now()) - t0));
  if (t1 && !Number.isNaN(t1)) node.removeAttribute("data-start");
  return node;
}
const tickClocks = () => document.querySelectorAll(".clk[data-start]").forEach((n) => { n.textContent = fmtDur(Date.now() - Number(n.dataset.start)); });

/* ---------- opening / closing ---------- */
function openRun(r) {
  closeRunView(true);
  Object.assign(RV, { base: r, data: null, jobId: null, auto: true, log: "", logJob: null, logErr: null, follow: true, err: null });
  renderRun();
  refreshRun().then(startRunTimers);
}
function closeRunView(silent) {
  clearInterval(RV.timer); clearInterval(RV.clock); RV.timer = RV.clock = null;
  const was = !!RV.base;
  RV.base = null; RV.data = null;
  if (was && !silent) load();
}
function startRunTimers() {
  clearInterval(RV.timer); clearInterval(RV.clock);
  RV.clock = setInterval(tickClocks, 1000);
  RV.timer = setInterval(() => { if (!document.hidden && rvRunning()) refreshRun(); }, RV_POLL_MS);
}

/* ---------- data ---------- */
function pickJob() {
  const jobs = RV.data.jobs || [];
  if (!jobs.length) return null;
  if (!RV.auto && jobs.some((j) => j.databaseId === RV.jobId)) return RV.jobId;
  const run = jobs.filter((j) => j.status === "in_progress");
  const pick = run[run.length - 1] || jobs.find((j) => rvState(j) === "fail") || (rvRunning() ? jobs.filter((j) => j.status === "completed").pop() : null) || jobs[0];
  return pick.databaseId;
}

async function refreshRun() {
  if (!RV.base || RV.busy) return;
  const id = RV.base.databaseId;
  RV.busy = true;
  try {
    const d = await ghJSON(["run", "view", String(id), "-R", D.slug, "--json", RV_FIELDS]);
    if (!RV.base || RV.base.databaseId !== id) return;
    RV.data = d; RV.err = null;
    RV.jobId = pickJob();
    // a finished run needs no more polling once its last state is in
    if (d.status === "completed") { clearInterval(RV.timer); RV.timer = null; }
    else if (!RV.timer) startRunTimers();
    renderRun();
    await refreshLog();
  } catch (e) { RV.err = String((e && e.message) || e); renderRun(); }
  finally { RV.busy = false; }
}

const stripLog = (t) => String(t).replace(/^\uFEFF/, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n").map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));

async function refreshLog() {
  const job = (RV.data.jobs || []).find((j) => j.databaseId === RV.jobId);
  if (!job) return;
  const sameJob = RV.logJob === job.databaseId;
  const finished = job.status === "completed";
  if (sameJob && finished && RV.log && RV.logDone) return; // nothing changes any more
  if (job.status === "queued" || job.status === "waiting" || job.status === "pending") { RV.log = ""; RV.logJob = job.databaseId; RV.logErr = null; RV.logDone = false; paintLog(); return; }
  try {
    const out = await gh(["api", `repos/${D.slug}/actions/jobs/${job.databaseId}/logs`, "--allow-escape-sequences"], { timeoutMs: 60000 });
    RV.log = stripLog(out).slice(-RV_MAX_LINES).join("\n");
    RV.logErr = null;
  } catch (e) {
    // GitHub hands out the log of a running job only in part, or not at all; the step list above still shows progress
    if (!sameJob) RV.log = "";
    RV.logErr = finished ? String((e && e.message) || e) : tr("실행 중인 job의 로그를 GitHub가 아직 주지 않아요. 단계 진행은 왼쪽에서 볼 수 있고, 로그는 job이 끝나면 나와요.");
  }
  RV.logJob = job.databaseId; RV.logDone = finished && !RV.logErr;
  paintLog();
}

/* ---------- drawing ---------- */
const sdot = (st) => el("span", { class: "sdot " + st });

function paintLog() {
  const box = $("#rvlogbody");
  if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const frag = document.createDocumentFragment();
  for (const l of RV.log ? RV.log.split("\n") : []) {
    if (l.startsWith("##[group]")) frag.append(el("div", { class: "lgrp" }, l.slice(9)));
    else if (l.startsWith("##[endgroup]")) continue;
    else if (l.startsWith("##[error]")) frag.append(el("div", { class: "lerr" }, l.slice(9)));
    else if (l.startsWith("##[warning]")) frag.append(el("div", { class: "lwarn" }, l.slice(11)));
    else frag.append(el("div", { class: "lln" }, l || " "));
  }
  if (!RV.log) frag.append(el("div", { class: "empty-note" }, RV.logErr || tr("로그가 아직 없어요.")));
  else if (RV.logErr) frag.append(el("div", { class: "empty-note" }, RV.logErr));
  box.replaceChildren(frag);
  if (RV.follow && (near || RV.followForce)) box.scrollTop = box.scrollHeight;
  RV.followForce = false;
}

function runActions(d) {
  const acts = el("div", { class: "acts" });
  const add = (label, cls, fn) => acts.append(el("button", { class: "btn " + cls, onclick: fn }, label));
  const base = { databaseId: d.databaseId, workflowName: d.workflowName, headBranch: d.headBranch, url: d.url };
  const again = async () => { RV.auto = true; await refreshRun(); startRunTimers(); };
  const sure = (t, label, fn) => confirmThen(t, `${d.workflowName} · ${d.headBranch}`, label, fn);
  if (d.status !== "completed") add(tr("취소"), "danger", async () => { if (await sure(tr("실행을 취소할까요?"), tr("취소하기"), () => gh(["run", "cancel", String(d.databaseId), "-R", D.slug]))) again(); });
  else {
    if (d.conclusion === "failure") {
      add(tr("에이전트로 수정"), "primary", () => fixRun(base));
      add(tr("실패만 재실행"), "", async () => { if (await sure(tr("실패한 job을 다시 실행할까요?"), tr("재실행"), () => gh(["run", "rerun", String(d.databaseId), "-R", D.slug, "--failed"]))) again(); });
    }
    add(tr("재실행"), "", async () => { if (await sure(tr("이 실행을 다시 돌릴까요?"), tr("재실행"), () => gh(["run", "rerun", String(d.databaseId), "-R", D.slug]))) again(); });
  }
  add(tr("브라우저에서 열기"), "", () => openUrl(d.url));
  return acts;
}

/* The frame is built once; each poll only refills the header, the job list and the log header, so the log keeps its scroll
 * position and the job list keeps its own. */
function buildShell() {
  const follow = el("label", { class: "follow" }, el("input", { type: "checkbox", id: "rvfollow", checked: RV.follow, onchange: (e) => { RV.follow = e.target.checked; if (RV.follow) { const b = $("#rvlogbody"); if (b) b.scrollTop = b.scrollHeight; } } }), tr("끝으로 따라가기"));
  view.replaceChildren(el("div", { class: "rv" }, el("div", { class: "rvhead", id: "rvhead" }), el("div", { id: "rverr" }),
    el("div", { class: "rvbody" }, el("div", { class: "rvjobs", id: "rvjobs" }),
      el("div", { class: "rvlog" }, el("div", { class: "rvloghead" }, el("b", { id: "rvlogname" }), el("span", { class: "grow" }), follow), el("div", { class: "rvlogbody", id: "rvlogbody" })))));
}

function renderRun() {
  if (!$("#rvhead")) buildShell();
  const d = RV.data || { ...RV.base, jobs: [], startedAt: RV.base.createdAt, updatedAt: null };
  const st = rvState(d);
  setSummary([tr("실행 #{0}", d.databaseId), rvLabel[st]]);
  $("#rvhead").replaceChildren(
    el("button", { class: "btn", onclick: () => closeRunView() }, tr("← 실행 목록")),
    el("div", { class: "rvtitle" }, el("div", { class: "title" }, d.displayTitle), el("div", { class: "meta" }, `${d.workflowName} · ${d.headBranch} · `, el("span", { class: "state " + (st === "queued" ? "idle" : st) }, rvLabel[st]), " ", clock(d.startedAt || d.createdAt, d.status === "completed" ? d.updatedAt : null))),
    RV.data ? runActions(d) : null);
  $("#rverr").replaceChildren(...(RV.err ? [el("div", { class: "err" }, RV.err)] : []));
  const jobsBox = $("#rvjobs"), items = [];
  if (!RV.data) items.push(el("div", { class: "empty-note" }, tr("job을 불러오는 중…")));
  for (const j of d.jobs || []) {
    items.push(el("div", { class: "rvjob" + (j.databaseId === RV.jobId ? " on" : ""), onclick: () => { RV.auto = false; RV.jobId = j.databaseId; RV.followForce = true; renderRun(); refreshLog(); } },
      el("div", { class: "jh" }, sdot(rvState(j)), el("span", { class: "jn" }, j.name), clock(j.startedAt, j.completedAt)),
      el("div", { class: "jsteps" }, ...(j.steps || []).map((s) => el("div", { class: "jstep" }, sdot(rvState(s)), el("span", { class: "sn" }, s.name), s.startedAt ? clock(s.startedAt, s.completedAt) : null)))));
  }
  if (RV.data && !(d.jobs || []).length) items.push(el("div", { class: "empty-note" }, tr("job 정보가 없어요")));
  jobsBox.replaceChildren(...items);
  const job = (d.jobs || []).find((j) => j.databaseId === RV.jobId);
  $("#rvlogname").textContent = job ? job.name : tr("로그");
}
