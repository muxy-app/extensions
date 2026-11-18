/* Branch cleanup for one project: finds local and remote branches whose work already landed in main / develop and
 * deletes the ones the user ticks. Nothing is deleted without a confirmation, and each delete re-checks that the
 * branch still points at the commit that was scanned. */
const C = { bases: [], rows: [], sel: new Set(), skipped: { worktree: 0, current: null }, note: null, busy: false, result: null };
const view = $("#view"), bar = $("#bar");
const PROTECTED = /^(main|master|develop|dev|staging|production|prod|release\/.*|hotfix\/.*)$/;
const BASES = ["main", "master", "develop"];

/* One shell script so the whole scan is a single (remembered) command prompt. */
function scanScript() {
  const q = shellQuote(ctx.path);
  return `cd ${q} || exit 2
git fetch --prune origin >/dev/null 2>&1 || echo "##FETCHFAIL"
echo "##CUR $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
git worktree list --porcelain | sed -n 's/^branch refs\\/heads\\///p' | sed 's/^/##WT /'
for b in ${BASES.join(" ")}; do
  oid=$(git rev-parse --verify -q refs/remotes/origin/$b) || continue
  echo "##BASE $b $oid"
  git for-each-ref --merged=refs/remotes/origin/$b refs/heads --format="##L $b %(objectname) %(committerdate:iso-strict) %(refname:short)"
  git for-each-ref --merged=refs/remotes/origin/$b refs/remotes/origin --format="##R $b %(objectname) %(committerdate:iso-strict) %(refname:lstrip=3)"
done
git for-each-ref refs/heads --format="##AL %(objectname) %(committerdate:iso-strict) %(refname:short)"
git for-each-ref refs/remotes/origin --format="##AR %(objectname) %(committerdate:iso-strict) %(refname:lstrip=3)"`;
}

async function scan() {
  view.replaceChildren(el("div", { class: "loading" }, tr("원격을 가져와 검사하는 중…")));
  bar.replaceChildren();
  C.sel.clear(); C.note = null;
  try {
    const r = await muxy.exec({ shell: scanScript(), timeoutMs: 90000 });
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || tr("git 검사에 실패했어요")).trim().slice(0, 500));
    const out = r.stdout.split("\n");
    const bases = [], wt = new Set(), merged = [], all = { L: new Map(), R: new Map() };
    let cur = null;
    for (const line of out) {
      const m = /^##(\w+) ?(.*)$/.exec(line);
      if (!m) continue;
      const [tag, rest] = [m[1], m[2]];
      if (tag === "FETCHFAIL") C.note = tr("원격 정보를 새로 가져오지 못해서 마지막으로 받아 둔 상태 기준이에요.");
      else if (tag === "CUR") cur = rest;
      else if (tag === "WT") wt.add(rest);
      else if (tag === "BASE") { const [b, oid] = rest.split(" "); bases.push({ name: b, oid }); }
      else if (tag === "L" || tag === "R") { const [b, oid, date, ...n] = rest.split(" "); merged.push({ scope: tag === "L" ? "local" : "remote", base: b, oid, date, name: n.join(" ") }); }
      else if (tag === "AL" || tag === "AR") { const [oid, date, ...n] = rest.split(" "); all[tag === "AL" ? "L" : "R"].set(n.join(" "), { oid, date }); }
    }
    C.bases = bases;
    if (!bases.length) throw new Error(tr("origin에 main / master / develop 브랜치가 없어서 기준으로 삼을 수 없어요."));
    const baseOid = Object.fromEntries(bases.map((b) => [b.name, b.oid]));

    // One row per branch name; its local and remote copies are cleaned together. Each copy only counts when it is
    // itself merged, so a remote branch that gained commits after the merge is never swept along.
    const rows = new Map();
    const add = (scope, name, oid, date, reason) => {
      if (PROTECTED.test(name) || name === "HEAD") return;
      const row = rows.get(name) || { name, copies: {}, reasons: [], date, extra: [] };
      (row.copies[scope] = row.copies[scope] || { oid, date });
      row.reasons.push({ ...reason, scope });
      if (new Date(date) > new Date(row.date)) row.date = date;
      rows.set(name, row);
    };
    for (const m of merged) add(m.scope, m.name, m.oid, m.date, { kind: "merged", base: m.base, empty: m.oid === baseOid[m.base] });

    // Squash / rebase merges leave the branch commits outside main, so they are matched through merged PRs
    // whose head commit is exactly this branch's tip.
    try {
      const slug = await repoSlug(ctx.path);
      const prs = await ghJSON(["pr", "list", "-R", slug, "--state", "merged", "--limit", "300", "--json", "number,headRefName,baseRefName,headRefOid"]);
      for (const pr of prs) {
        if (!baseOid[pr.baseRefName]) continue;
        for (const [scope, map] of [["local", all.L], ["remote", all.R]]) {
          const b = map.get(pr.headRefName);
          if (b && b.oid === pr.headRefOid) add(scope, pr.headRefName, b.oid, b.date, { kind: "pr", base: pr.baseRefName, pr: pr.number });
        }
      }
    } catch (e) { C.note = (C.note ? C.note + " " : "") + tr("병합된 PR을 확인하지 못해 squash 병합 브랜치는 빠져 있어요."); }

    // Where a branch is checked out, and which agents are working there.
    const agentsBy = await agentsByBranch();
    const lockedFor = (name) => (name === cur ? "current" : wt.has(name) ? "worktree" : null);
    for (const r of rows.values()) {
      r.locked = r.copies.local ? lockedFor(r.name) : null;
      r.agents = agentsBy.get(r.name) || [];
      if (!r.copies.local && all.L.has(r.name)) r.extra.push(tr("로컬은 병합 안 된 커밋이 있어 유지"));
      if (!r.copies.remote && all.R.has(r.name)) r.extra.push(tr("원격은 병합 안 된 커밋이 있어 유지"));
      r.empty = r.reasons.every((x) => x.empty);
    }
    C.skipped = { current: cur };
    C.rows = [...rows.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    // Everything clearly finished starts ticked; a branch with no commits of its own may be brand new, and a branch
    // that is checked out somewhere (or has an agent on it) cannot be picked at all.
    for (const r of C.rows) if (!r.locked && !r.empty) C.sel.add(r.name);
    render();
  } catch (e) { view.replaceChildren(errorBox(e)); }
}

/* branch name -> agents working in a worktree on that branch (needs the project id, then its worktrees). */
async function agentsByBranch() {
  const map = new Map();
  try {
    const project = (await muxy.projects.list()).find((p) => norm(p.path) === norm(ctx.path));
    if (!project) return map;
    const [wts, agents] = await Promise.all([muxy.worktrees.list(project.id), muxy.agents.list()]);
    for (const w of wts) {
      const here = agents.filter((a) => a.worktreeID === w.id);
      if (w.branch && here.length) map.set(w.branch, [...(map.get(w.branch) || []), ...here]);
    }
  } catch { /* agent info is a hint; the scan works without it */ }
  return map;
}

function reasonChip(x) {
  if (x.kind === "pr") return el("span", { class: "chip" }, `PR #${x.pr} → ${x.base} (squash)`);
  if (x.empty) return el("span", { class: "chip warn", title: tr("이 브랜치에는 base에 없는 커밋이 없어요. 방금 만든 브랜치일 수 있어요.") }, tr("{0}와 동일 · 새 브랜치?", x.base));
  return el("span", { class: "chip" }, tr("{0} 병합됨", x.base));
}

const AGENT_LABEL = { working: tr("작업 중"), idle: tr("대기"), waiting: tr("입력 대기"), error: tr("오류") };
function agentChip(agents) {
  const busy = agents.some((a) => a.status !== "idle");
  return el("span", { class: "chip " + (busy ? "warn" : "") }, tr("에이전트 {0}", agents.map((a) => `${a.providerID} ${AGENT_LABEL[a.status] || a.status}`).join(", ")));
}

function render() {
  $("#summary").textContent = tr("기준: {0}", C.bases.map((b) => b.name).join(", "));
  const notes = [];
  if (C.note) notes.push(el("div", { class: "cnote" }, C.note));
  if (C.result) notes.push(C.result);
  const sel = C.rows.filter((r) => !r.locked);
  const all = el("input", { type: "checkbox", checked: sel.length > 0 && sel.every((r) => C.sel.has(r.name)), disabled: !sel.length || C.busy,
    onchange: (e) => { for (const r of sel) e.target.checked ? C.sel.add(r.name) : C.sel.delete(r.name); render(); } });
  const rowEl = (r) => el("label", { class: "crow" + (r.locked ? " locked" : "") },
    el("input", { type: "checkbox", checked: C.sel.has(r.name), disabled: C.busy || !!r.locked, onchange: (e) => { e.target.checked ? C.sel.add(r.name) : C.sel.delete(r.name); renderBar(); } }),
    el("span", { class: "title", title: r.name }, r.name),
    r.locked ? el("span", { class: "chip warn" }, r.locked === "current" ? tr("현재 브랜치") : tr("worktree에서 사용 중")) : null,
    r.agents.length ? agentChip(r.agents) : null,
    ...r.extra.map((t) => el("span", { class: "meta" }, t)),
    ...dedupeReasons(r).map(reasonChip),
    el("span", { class: "chip scope" }, [r.copies.local && tr("로컬"), r.copies.remote && tr("원격")].filter(Boolean).join(" + ")),
    el("span", { class: "meta" }, ago(r.date)));
  view.replaceChildren(...notes,
    el("div", { class: "csec" },
      el("div", { class: "chead" }, all, el("b", {}, tr("병합된 브랜치 {0}개", C.rows.length)), el("span", { class: "meta" }, tr("로컬과 원격(origin)을 함께 삭제해요"))),
      ...(C.rows.length ? C.rows.map(rowEl) : [el("div", { class: "empty" }, tr("정리할 브랜치가 없어요."))])),
    el("div", { class: "meta cfoot" }, tr("보호 브랜치(main, master, develop, dev, staging, production, release/*, hotfix/*)는 목록에서 제외했어요. 체크할 수 없는 브랜치는 현재 브랜치이거나 worktree에서 쓰는 중이에요.")));
  renderBar();
}

/* A branch merged into both main and develop shows each base once, whichever copy proved it. */
function dedupeReasons(r) {
  const seen = new Set();
  return r.reasons.filter((x) => { const k = x.kind + x.base + (x.pr || ""); if (seen.has(k)) return false; seen.add(k); return true; });
}

function renderBar() {
  const picked = C.rows.filter((r) => C.sel.has(r.name) && !r.locked);
  const busyAgent = picked.filter((r) => r.agents.length).length;
  const nl = picked.filter((r) => r.copies.local).length, nr = picked.filter((r) => r.copies.remote).length;
  bar.replaceChildren(
    el("span", { class: "grow meta" }, picked.length ? tr("선택 {0}개 (로컬 {1} · 원격 {2})", picked.length, nl, nr) : tr("삭제할 브랜치를 선택해 주세요")),
    el("button", { class: "btn danger", disabled: !picked.length || C.busy, onclick: () => cleanUp(picked) }, C.busy ? tr("삭제 중…") : tr("선택한 {0}개 삭제", picked.length)));
}

async function cleanUp(picked) {
  const local = picked.filter((r) => r.copies.local), remote = picked.filter((r) => r.copies.remote);
  const names = picked.slice(0, 10).map((r) => "• " + r.name + (r.agents.length ? tr("  (에이전트 있음)") : "")).join("\n") + (picked.length > 10 ? tr("\n… 외 {0}개", picked.length - 10) : "");
  const msg = tr("{0}\n\n로컬 {1}개와 원격(origin) {2}개가 함께 삭제돼요. 원격 삭제는 팀 전체에 반영되고 되돌리기 어려워요.", names, local.length, remote.length);
  const ok = await muxy.dialog.confirm({ title: tr("브랜치 {0}개를 삭제할까요?", picked.length), message: msg, buttons: [tr("삭제"), tr("취소")], default: tr("취소"), cancel: tr("취소") });
  if (!ok) return;
  C.busy = true; render();
  const q = shellQuote(ctx.path), failed = [];
  try {
    if (local.length) {
      // Re-check the tip so a branch that moved since the scan is left alone.
      const lines = local.map((r) => `[ "$(git rev-parse -q --verify ${shellQuote("refs/heads/" + r.name)})" = ${r.copies.local.oid} ] && git branch -D -- ${shellQuote(r.name)} >/dev/null 2>&1 || echo ${shellQuote("##FAIL " + r.name)}`).join("\n");
      const res = await muxy.exec({ shell: `cd ${q} || exit 2\n${lines}`, timeoutMs: 60000 });
      for (const l of res.stdout.split("\n")) if (l.startsWith("##FAIL ")) failed.push(tr("로컬 ") + l.slice(7));
    }
    if (remote.length) {
      const leases = remote.map((r) => `--force-with-lease=${shellQuote(r.name + ":" + r.copies.remote.oid)}`).join(" ");
      const specs = remote.map((r) => shellQuote(":refs/heads/" + r.name)).join(" ");
      const res = await muxy.exec({ shell: `cd ${q} || exit 2\ngit push origin ${leases} ${specs} 2>&1`, timeoutMs: 120000 });
      // Whatever still exists on origin afterwards was not deleted.
      const after = await muxy.exec({ shell: `cd ${q} && git fetch --prune origin >/dev/null 2>&1; git for-each-ref refs/remotes/origin --format='%(refname:lstrip=3)'`, timeoutMs: 60000 });
      const still = new Set(after.stdout.split("\n"));
      for (const r of remote) if (still.has(r.name)) failed.push(tr("원격 ") + r.name);
      if (failed.length && res.exitCode !== 0) C.note = tr("원격 삭제 일부가 거부됐어요: ") + res.stdout.trim().split("\n").slice(-3).join(" / ").slice(0, 300);
    }
    C.result = el("div", { class: failed.length ? "cnote" : "cok" }, failed.length ? tr("일부만 삭제했어요. 삭제하지 못한 {0}건: {1} (스캔 이후 브랜치가 움직였거나 권한이 없을 수 있어요)", failed.length, failed.slice(0, 6).join(", ")) : tr("{0}개 브랜치를 삭제했어요.", picked.length));
  } catch (e) { C.result = errorBox(e); }
  C.busy = false;
  await scan();
}

$("#refresh").addEventListener("click", () => { C.result = null; scan(); });
$("#title").textContent = tr("브랜치 청소 · {0}", ctx.name || "");
try { muxy.tabs.setTitle(tr("브랜치 청소 · {0}", ctx.name || "")); } catch { /* title is cosmetic */ }
tabIcon("scissors");
scan();
