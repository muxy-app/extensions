/* AI agents the Issues / Deploys tabs can hand work to. Each agent is a shell command template; the prompt is
 * written to a file and `{file}` in the template becomes that path, so the command text stays constant (Muxy asks to
 * approve a terminal command once per exact text). `{dir}` is the project folder, quoted. */
const AGENT_FILE = "/tmp/muxy-agent-task.md";

const BUILTIN_AGENTS = [
  { id: "claude", name: "Claude Code", command: 'claude "$(cat {file})"' },
  { id: "codex", name: "Codex", command: 'codex "$(cat {file})"' },
  { id: "opencode", name: "OpenCode", command: 'opencode --prompt "$(cat {file})"' },
  { id: "cursor", name: "Cursor Agent", command: 'cursor-agent "$(cat {file})"' },
  { id: "copilot", name: "Copilot CLI", command: 'copilot -i "$(cat {file})"' },
  { id: "gemini", name: "Gemini CLI", command: 'gemini -i "$(cat {file})"' },
  { id: "xita", name: "XITA", command: 'xita chat "$(cat {file})"' },
];

/* Stored as { custom: [{id,name,command}], overrides: {builtinId: command}, last: id }. */
async function loadAgents() {
  const cfg = await store.get("agents", {});
  const custom = cfg.custom || [];
  const overrides = cfg.overrides || {};
  const list = [
    ...BUILTIN_AGENTS.map((a) => ({ ...a, command: overrides[a.id] || a.command, builtin: true })),
    ...custom.map((a) => ({ ...a, builtin: false })),
  ];
  return { list, last: list.some((a) => a.id === cfg.last) ? cfg.last : "claude", cfg: { custom, overrides, last: cfg.last } };
}

async function saveAgentConfig(cfg) { await store.set("agents", cfg); }

/* The new terminal tab belongs to whichever project is open; make sure it ends up in the project this manager is
 * about by checking where it really is rather than guessing from which project is active. */
async function moveToThisProject(tabId) {
  const projects = await muxy.projects.list();
  const target = projects.find((p) => norm(p.path) === norm(ctx.path));
  if (!target) return;
  const inTarget = async () => (await muxy.tabs.list({ project: target.id })).some((t) => t.id === tabId);
  if (!(await inTarget())) {
    await muxy.tabs.move(tabId, { project: target.id });
    for (let i = 0; i < 5 && !(await inTarget()); i++) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target.isActive) await muxy.projects.switchTo(target.id);
  try { await muxy.tabs.switchTo(tabId); } catch { /* the tab may already be focused */ }
}

async function launchAgent(agent, prompt) {
  await muxy.exec({ shell: `cat > ${AGENT_FILE}`, stdin: prompt, timeoutMs: 10000 });
  // A terminal starts in the folder of whichever project is open when it is created, and moving the tab later does
  // not change that, so the command first cd's into this project's folder.
  const command = `cd ${shellQuote(ctx.path)} && ` + agent.command.split("{file}").join(AGENT_FILE).split("{dir}").join(shellQuote(ctx.path));
  const tabId = await muxy.tabs.open({ kind: "terminal", command });
  await moveToThisProject(tabId);
  return tabId;
}

/* ---------- UI: a compact "hand this to an agent" form ---------- */

/* One agent picker + one instruction box, with a button per action. `actions` is [{ verb, buildPrompt(extra) }] where
 * buildPrompt returns the full prompt text and `verb` the button label ("리뷰", "수정", ...). The single
 * { verb, buildPrompt } form still works for a one-action box. */
async function agentForm({ verb, placeholder, buildPrompt, actions }) {
  const acts = actions || [{ verb, buildPrompt }];
  const { list, last } = await loadAgents();
  const sel = el("select", {});
  for (const a of list) sel.append(el("option", { value: a.id }, a.name));
  sel.value = last;
  const extra = el("textarea", { placeholder: placeholder || tr("에이전트에게 덧붙일 지시 (선택)") });
  extra.style.minHeight = "54px";
  const msg = el("div", {});
  const manage = el("button", { class: "btn", title: tr("에이전트 추가·수정·삭제"), onclick: () => manageAgents(() => agentFormRefresh()) }, tr("에이전트 관리"));
  const buttons = acts.map((act, i) => el("button", { class: "btn" + (i === 0 ? " primary" : "") }, tr("에이전트로 {0}", act.verb)));
  const box = el("div", { class: "agentbox" }, el("div", { class: "agentrow" }, el("span", { class: "meta" }, tr("에이전트")), sel, manage), extra, msg, el("div", { class: "row" }, ...buttons));
  buttons.forEach((go, i) => go.addEventListener("click", async () => {
    const agent = list.find((a) => a.id === sel.value);
    buttons.forEach((b) => { b.disabled = true; }); msg.replaceChildren();
    try {
      const { cfg } = await loadAgents(); cfg.last = agent.id; await saveAgentConfig(cfg);
      await launchAgent(agent, acts[i].buildPrompt(extra.value.trim()));
      msg.replaceChildren(el("div", { class: "ok" }, tr("{0}를 터미널 탭에서 시작했어요.", agent.name)));
    } catch (e) { msg.replaceChildren(errorBox(e)); }
    buttons.forEach((b) => { b.disabled = false; });
  }));
  function agentFormRefresh() { agentForm({ verb, placeholder, buildPrompt, actions }).then((n) => box.replaceWith(n)); }
  return box;
}

/* ---------- UI: manage agents (built-in commands can be edited; custom ones added and removed) ---------- */

async function manageAgents(onClose) {
  const { list, cfg } = await loadAgents();
  const overlay = el("div", { class: "overlay" });
  const dialog = el("div", { class: "dialog" });
  overlay.append(dialog);
  const close = () => { overlay.remove(); if (onClose) onClose(); };
  const rowFor = (a) => {
    const name = el("input", { type: "text", value: a.name, disabled: a.builtin, placeholder: tr("이름") });
    const cmd = el("input", { type: "text", value: a.command, placeholder: tr("명령 (예: myagent --task \"$(cat {file})\")") });
    const save = el("button", { class: "btn", onclick: async () => {
      if (a.builtin) cfg.overrides[a.id] = cmd.value.trim() || undefined;
      else { const c = cfg.custom.find((x) => x.id === a.id); c.name = name.value.trim() || c.name; c.command = cmd.value.trim(); }
      await saveAgentConfig(cfg); save.textContent = tr("저장됨"); setTimeout(() => { save.textContent = tr("저장"); }, 1200);
    } }, tr("저장"));
    const extra = a.builtin
      ? el("button", { class: "btn", title: tr("기본 명령으로 되돌리기"), onclick: async () => { delete cfg.overrides[a.id]; await saveAgentConfig(cfg); cmd.value = BUILTIN_AGENTS.find((b) => b.id === a.id).command; } }, tr("기본값"))
      : el("button", { class: "btn danger", onclick: async () => { cfg.custom = cfg.custom.filter((x) => x.id !== a.id); await saveAgentConfig(cfg); close(); manageAgents(onClose); } }, tr("삭제"));
    return el("div", { class: "agentedit" }, name, cmd, save, extra);
  };
  const newName = el("input", { type: "text", placeholder: tr("새 에이전트 이름") });
  const newCmd = el("input", { type: "text", placeholder: tr("명령 — {file}: 프롬프트 파일, {dir}: 프로젝트 폴더") });
  const err = el("div", {});
  const add = el("button", { class: "btn primary", onclick: async () => {
    if (!newName.value.trim() || !newCmd.value.trim()) { err.replaceChildren(errorBox(tr("이름과 명령을 모두 입력해 주세요"))); return; }
    if (!newCmd.value.includes("{file}")) { err.replaceChildren(errorBox(tr("명령에 {file}가 있어야 프롬프트가 전달돼요 (예: myagent \"$(cat {file})\")"))); return; }
    cfg.custom.push({ id: "custom-" + Date.now().toString(36), name: newName.value.trim(), command: newCmd.value.trim() });
    await saveAgentConfig(cfg); close(); manageAgents(onClose);
  } }, tr("추가"));
  dialog.append(
    el("div", { class: "dhead" }, el("b", {}, tr("에이전트 관리")), el("button", { class: "btn", onclick: close }, tr("닫기"))),
    el("div", { class: "meta" }, tr("명령에서 {file}은 프롬프트가 담긴 파일 경로로 바뀌어요. 터미널 탭에서 이 명령이 실행됩니다.")),
    ...list.map(rowFor),
    el("div", { class: "agentedit new" }, newName, newCmd, add),
    err
  );
  document.body.append(overlay);
}
