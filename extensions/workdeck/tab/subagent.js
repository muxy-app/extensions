/* One subagent in its own tab: what it was asked to do and what it reported.
 * Before: this was shown inline under the sidebar row, which is too narrow to read a report in.
 * Now: clicking a subagent row opens this tab; the sidebar only lists it.
 * Why: the owner asked to read it in a tab rather than in the section list.
 * Affects: subagent rows. The task and report are read fresh from the session folder on each refresh. */
const S = { parent: ctx.parent || "", child: ctx.child || "", parentPane: ctx.parentPane || "", projectID: ctx.projectID || "", busy: false };

tabIcon("arrow.triangle.branch"); // a task branched off its parent agent

const stateWord = (s) => (s.done ? tr("완료") : s.state === "working" ? tr("작업 중") : tr("대기"));

function alertBox(text) {
  $("#alerts").replaceChildren(el("div", { class: "notice err" }, text));
}

function section(title, node) {
  return el("div", { class: "card" }, el("h2", {}, title), node);
}

async function load() {
  if (S.busy) return;
  S.busy = true;
  $("#alerts").replaceChildren();
  $("#body").replaceChildren(el("div", { class: "meta" }, tr("읽는 중…")));
  try {
    const d = await readSubagent(S.parent, S.child);
    if (!d) { $("#body").replaceChildren(); alertBox(tr("이 하위 작업 기록을 찾을 수 없어요. 세션 폴더가 정리됐을 수 있어요.")); return; }
    $("#title").textContent = d.description || tr("하위 작업");
    $("#state").textContent = [stateWord(d), d.kind].filter(Boolean).join(" · ");
    try { await muxy.tabs.setTitle(tr("하위 작업 · {0}", d.description || S.child)); } catch { /* title is cosmetic */ }
    $("#body").replaceChildren(
      section(tr("과제"), d.prompt ? el("div", { class: "body pre" }, d.prompt) : el("div", { class: "meta" }, tr("(과제 본문 없음)"))),
      section(d.done ? tr("보고") : tr("진행 상황"), d.report ? el("div", { class: "body" }, renderMarkdown(d.report)) : el("div", { class: "meta" }, tr("아직 기록이 없어요")))
    );
  } catch (e) {
    $("#body").replaceChildren();
    alertBox(String((e && e.message) || e));
  } finally {
    S.busy = false;
  }
}

/* The subagent has no terminal of its own: go to the pane its parent runs in. */
async function toParent() {
  if (!S.parentPane) return;
  const pane = (await muxy.panes.list()).find((p) => p.id === S.parentPane);
  if (!pane) { if (S.projectID) await muxy.projects.switchTo(S.projectID); return; }
  if (pane.projectID) await muxy.projects.switchTo(pane.projectID);
  await muxy.tabs.switchTo(pane.tabID);
}

$("#refresh").addEventListener("click", () => load());
$("#parent").addEventListener("click", () => toParent().catch((e) => alertBox(String((e && e.message) || e))));
if (!S.parent || !S.child) alertBox(tr("하위 작업 정보가 없어요. 사이드바에서 다시 열어 주세요."));
else load();