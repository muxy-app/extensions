/* AI agents the Issues / Deploys tabs and the notes helper can hand work to. Each agent is a shell command template; the
 * prompt is written to a file and `{file}` in the template becomes that path, so the command text stays constant (Muxy
 * asks to approve a terminal command once per exact text). `{dir}` is the working folder, quoted.
 *
 * Before: the prompt went to /tmp/muxy-agent-task.md and a failed write went unnoticed.
 * Now: the prompt and the model / effort choice are written to ~/.local/share/workdeck/run (created with umask 077), one
 *      pair of files per working folder, and a failed write stops the launch.
 * Why: /tmp is shared by every account on the machine, so a file planted there could have handed the agent another
 *      prompt; per-folder files keep two agents started at nearly the same time from reading each other's prompt.
 * Affects: every agent launch (issues, deploys, notes helper). Custom commands keep working: {file} is still the path.
 *
 * Model and effort are two plain lines read with `read` (never sourced). A command uses them through $WD_MODEL /
 * $WD_EFFORT; commands without those variables ignore the choice. The write command's text is constant (the folder key
 * and the values travel in the environment) and it prints $HOME, so the agent command can use a plain absolute path. */
const RUN_SUBDIR = ".local/share/workdeck/run";
const WRITE_AGENT_FILES = `umask 077 && D="$HOME/${RUN_SUBDIR}" && mkdir -p "$D" && cat > "$D/task-$WD_KEY.md" && printf '%s\\n%s\\n' "$WD_MODEL" "$WD_EFFORT" > "$D/opts-$WD_KEY" && printf '%s' "$HOME"`;
/* Short stable key of a folder (FNV-1a), used in the file names above. */
const folderKey = (s) => { let h = 0x811c9dc5; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };

/* `${X:+--flag} ${X:+"$X"}` is two expansions on purpose: zsh does not split `${X:+--flag "$X"}` into two words, so the
 * agent would receive "--flag value" as a single argument. Empty values drop out in zsh, bash and sh alike. */
const BUILTIN_AGENTS = [
  { id: "claude", name: "Claude Code", command: 'claude ${WD_MODEL:+--model} ${WD_MODEL:+"$WD_MODEL"} ${WD_EFFORT:+--effort} ${WD_EFFORT:+"$WD_EFFORT"} "$(cat {file})"', models: ["opus", "sonnet", "haiku"], efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "codex", name: "Codex", command: 'codex ${WD_MODEL:+-m} ${WD_MODEL:+"$WD_MODEL"} ${WD_EFFORT:+-c} ${WD_EFFORT:+"model_reasoning_effort=$WD_EFFORT"} "$(cat {file})"', models: [], efforts: ["low", "medium", "high"] },
  { id: "opencode", name: "OpenCode", command: 'opencode ${WD_MODEL:+-m} ${WD_MODEL:+"$WD_MODEL"} --prompt "$(cat {file})"', models: [], efforts: [] },
  { id: "cursor", name: "Cursor Agent", command: 'cursor-agent ${WD_MODEL:+--model} ${WD_MODEL:+"$WD_MODEL"} "$(cat {file})"', models: [], efforts: [] },
  { id: "copilot", name: "Copilot CLI", command: 'copilot ${WD_MODEL:+--model} ${WD_MODEL:+"$WD_MODEL"} -i "$(cat {file})"', models: [], efforts: [] },
  { id: "gemini", name: "Gemini CLI", command: 'gemini ${WD_MODEL:+-m} ${WD_MODEL:+"$WD_MODEL"} -i "$(cat {file})"', models: [], efforts: [] },
  /* Before: XITA ran `xita chat "$(cat {file})"`, so the model and effort fields were greyed out for it.
   * Now: it passes -m / -e like the other agents, with the effort values `xita chat --help` documents.
   * Why: the CLI does accept both (`xita chat --help`: -m/--model, -e/--effort none|low|medium|high|xhigh|max|ultra),
   *      so marking it as unsupported blocked a choice the agent can actually take.
   * Affects: XITA launches only. Models stay free text: they come from the user's own providers (`provider/model`,
   *          see `xita models`), so there is no fixed list to offer. */
  { id: "xita", name: "XITA", command: 'xita chat ${WD_MODEL:+-m} ${WD_MODEL:+"$WD_MODEL"} ${WD_EFFORT:+-e} ${WD_EFFORT:+"$WD_EFFORT"} "$(cat {file})"', models: [], efforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra"] },
];
/* An override that is just an earlier built-in command (the first release's, or the one-word-flag form above) is not a
 * real customization; it is ignored so the agent gets the current command with model / effort support. */
const OLD_BUILTIN_COMMANDS = new Set([
  'claude "$(cat {file})"', 'codex "$(cat {file})"', 'opencode --prompt "$(cat {file})"', 'cursor-agent "$(cat {file})"',
  'copilot -i "$(cat {file})"', 'gemini -i "$(cat {file})"', 'xita chat "$(cat {file})"',
  'claude ${WD_MODEL:+--model "$WD_MODEL"} ${WD_EFFORT:+--effort "$WD_EFFORT"} "$(cat {file})"',
  'codex ${WD_MODEL:+-m "$WD_MODEL"} ${WD_EFFORT:+-c "model_reasoning_effort=$WD_EFFORT"} "$(cat {file})"',
  'opencode ${WD_MODEL:+-m "$WD_MODEL"} --prompt "$(cat {file})"', 'cursor-agent ${WD_MODEL:+--model "$WD_MODEL"} "$(cat {file})"',
  'copilot ${WD_MODEL:+--model "$WD_MODEL"} -i "$(cat {file})"', 'gemini ${WD_MODEL:+-m "$WD_MODEL"} -i "$(cat {file})"',
]);
const usesModel = (a) => a.command.includes("WD_MODEL");
const usesEffort = (a) => a.command.includes("WD_EFFORT");

/* Stored as { custom: [{id,name,command}], overrides: {builtinId: command}, last: id, defaultAgent: id,
 * prefs: {agentId: {model, effort}} }. The default agent wins over the last one used. */
async function loadAgents() {
  const cfg = await store.get("agents", {});
  const custom = cfg.custom || [];
  const overrides = cfg.overrides || {};
  const list = [
    ...BUILTIN_AGENTS.map((a) => ({ ...a, command: overrides[a.id] && !OLD_BUILTIN_COMMANDS.has(overrides[a.id].trim()) ? overrides[a.id] : a.command, builtin: true })),
    ...custom.map((a) => ({ ...a, builtin: false })),
  ];
  const pick = [cfg.defaultAgent, cfg.last].find((id) => list.some((a) => a.id === id)) || "claude";
  return { list, last: pick, prefs: cfg.prefs || {}, cfg: { custom, overrides, last: cfg.last, defaultAgent: cfg.defaultAgent, prefs: cfg.prefs || {} } };
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

/* Writes the prompt and the model / effort choice where the agent command reads them, and returns the command that starts
 * `agent` in `qdir` (already shell-quoted). `o.model` / `o.effort` default to the saved preference of that agent. */
async function agentCommand(agent, prompt, qdir, o = {}) {
  const pf = ((await loadAgents()).prefs || {})[agent.id] || {};
  const pick = (k) => String((o[k] !== undefined ? o[k] : pf[k]) || "").replace(/[\r\n]+/g, " ").trim();
  const key = folderKey(qdir);
  const r = await muxy.exec({ shell: WRITE_AGENT_FILES, stdin: prompt, env: { WD_KEY: key, WD_MODEL: pick("model"), WD_EFFORT: pick("effort") }, timeoutMs: 10000 });
  if (r.exitCode !== 0) throw new Error(tr("에이전트에게 넘길 파일을 쓰지 못했어요: {0}", (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 300)));
  // a plain path also works when a custom command puts {file} inside quotes; an unusual $HOME falls back to "$HOME/..."
  const home = r.stdout.trim();
  const at = (name) => (/^\/[\w.\/-]+$/.test(home) ? `${home}/${RUN_SUBDIR}/${name}` : `"$HOME/${RUN_SUBDIR}/${name}"`);
  return `{ IFS= read -r WD_MODEL; IFS= read -r WD_EFFORT; } < ${at(`opts-${key}`)} && ` + agent.command.split("{file}").join(at(`task-${key}.md`)).split("{dir}").join(qdir);
}

/* `o.dir` runs the agent somewhere other than the project folder (an issue's worktree). */
async function launchAgent(agent, prompt, o = {}) {
  const dir = shellQuote(o.dir || ctx.path);
  // A terminal starts in the folder of whichever project is open when it is created, and moving the tab later does
  // not change that, so the command first cd's into the folder the agent should work in.
  const command = `cd ${dir} && ` + await agentCommand(agent, prompt, dir, o);
  const tabId = await muxy.tabs.open({ kind: "terminal", command });
  // the agent is already running; failing to move its tab must not make the caller think nothing started
  try { await moveToThisProject(tabId); } catch (e) { console.warn("could not move the agent tab: " + String((e && e.message) || e)); }
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

/* ---------- UI: "which agent, model, effort" dialog shown before an agent is started ---------- */

/* Resolves { agent, model, effort, extra, copyEnv } or null when cancelled. Starts from the saved defaults; the checkbox
 * stores the chosen agent / model / effort as the new defaults. `note` is a short line under the title. `copyEnv` (issue
 * runs) adds a ticked-by-default option to copy the checkout's git-ignored .env files into the new worktree. */
async function askAgentRun({ title, note, extraPlaceholder, copyEnv }) {
  const { list, last, prefs } = await loadAgents();
  return new Promise((resolve) => {
    const overlay = el("div", { class: "overlay" });
    const dialog = el("div", { class: "dialog runask" });
    overlay.append(dialog);
    const sel = el("select", {}); for (const a of list) sel.append(el("option", { value: a.id }, a.name));
    sel.value = last;
    const model = el("input", { type: "text", list: "wd-models", placeholder: tr("기본 모델") });
    const effort = el("input", { type: "text", list: "wd-efforts", placeholder: tr("기본 effort") });
    const dlM = el("datalist", { id: "wd-models" }), dlE = el("datalist", { id: "wd-efforts" });
    const hint = el("div", { class: "meta" });
    const extra = el("textarea", { placeholder: extraPlaceholder || tr("에이전트에게 덧붙일 지시 (선택)") });
    const keep = el("input", { type: "checkbox" });
    const envBox = el("input", { type: "checkbox", checked: true });
    const apply = () => {
      const a = list.find((x) => x.id === sel.value), pf = prefs[a.id] || {};
      const meta = BUILTIN_AGENTS.find((b) => b.id === a.id) || {};
      model.value = pf.model || ""; effort.value = pf.effort || "";
      model.disabled = !usesModel(a); effort.disabled = !usesEffort(a);
      dlM.replaceChildren(...(meta.models || []).map((m) => el("option", { value: m })));
      dlE.replaceChildren(...(meta.efforts || []).map((m) => el("option", { value: m })));
      hint.textContent = usesModel(a) || usesEffort(a) ? "" : tr("이 에이전트의 명령에는 $WD_MODEL / $WD_EFFORT가 없어서 모델·effort 선택은 적용되지 않아요. 에이전트 관리에서 명령에 넣을 수 있어요.");
    };
    sel.addEventListener("change", apply);
    apply();
    const done = (v) => { overlay.remove(); resolve(v); };
    const go = el("button", { class: "btn primary", onclick: async () => {
      const a = list.find((x) => x.id === sel.value);
      const out = { agent: a, model: usesModel(a) ? model.value.trim() : "", effort: usesEffort(a) ? effort.value.trim() : "", extra: extra.value.trim(), copyEnv: !!copyEnv && envBox.checked };
      if (keep.checked) {
        const { cfg } = await loadAgents();
        cfg.defaultAgent = a.id; cfg.prefs = { ...cfg.prefs, [a.id]: { model: model.value.trim(), effort: effort.value.trim() } };
        await saveAgentConfig(cfg);
      }
      done(out);
    } }, tr("시작"));
    dialog.append(el("div", { class: "dhead" }, el("b", {}, title)), note ? el("div", { class: "meta" }, note) : null,
      el("div", { class: "field" }, el("label", {}, tr("에이전트")), sel),
      el("div", { class: "tools" }, el("div", { class: "field grow" }, el("label", {}, tr("모델")), model), el("div", { class: "field grow" }, el("label", {}, tr("effort")), effort)),
      dlM, dlE, hint, extra,
      copyEnv ? el("label", { class: "tools" }, envBox, tr("git에서 무시하는 .env 파일을 워크트리로 복사")) : null,
      el("label", { class: "tools" }, keep, tr("이 선택을 기본값으로 저장")),
      el("div", { class: "row" }, el("button", { class: "btn", onclick: () => done(null) }, tr("취소")), go));
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
    overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") done(null); });
    document.body.append(overlay);
    setTimeout(() => extra.focus(), 0);
  });
}

/* ---------- default instructions for agents that process an issue (kept in English; editable in "에이전트 관리") ---------- */

const DEFAULT_ISSUE_GUIDE = `You are processing the issue above. Treat the issue as the source of truth and keep its thread up to date.

Analyze and report first, then proceed with the user
1. Before changing any code, analyze the issue: read it with its comments (and every open sub-issue), inspect the relevant code, and find out what already exists, the likely cause (for bugs) and the impact.
2. Report your findings to the user in this terminal and propose a concrete direction (options with a recommendation when there are several), including what you will change and how you will verify it.
3. Wait for the user's go-ahead or adjustment. Start implementing only after that, and follow the direction they confirm.

Workflow
1. Read the issue, its comments and (for a group) every open sub-issue. Inspect the repository structure, package scripts and existing patterns before changing anything.
2. After the user confirms the direction, post a short plan as a comment on the issue before you start coding (what you will change, how you will verify it). If the issue is a bug, state the cause you found.
3. Work only in the worktree and branch given above. One branch per issue group: do not create a branch per sub-issue. Never touch the main checkout.
4. Prefer the smallest, lowest-risk change that does not affect unrelated behavior. Ask the user only when something materially ambiguous would change product behavior, data, security or rollout risk.
5. Verify with the project's own scripts first (lint, typecheck, build, tests), then the smallest real check that proves the issue is handled.
6. Commit locally in logical units with clear messages. Do not push, open a PR, merge, or close the issue unless the additional instructions say so.

Keep the issue thread informed
- Comment on the issue itself (the original post's thread), not elsewhere. Keep comments concise; post at meaningful milestones (plan, a significant finding, completion), not for every step.
- If a group has sub-issues, comment on each sub-issue you handled and add a short roll-up comment on the parent.
- Never put secrets, tokens, customer data or large logs in a comment.

When the work is done and verified
- Post a completion comment: what changed, the cause (for bugs), verification commands and results, branch / commit references, known caveats or skipped checks, and anything the user still has to do.
- Then move the issue (and handled sub-issues) to the review status given above, so the user can decide whether to accept or reopen it. Do not mark it done or closed yourself.
- Finish with a short summary in this terminal as well.`;

async function loadIssueGuide() { const g = await store.get("issueGuide", ""); return g && g.trim() ? g : DEFAULT_ISSUE_GUIDE; }

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
      if (a.builtin) { const v = cmd.value.trim(); if (!v || v === BUILTIN_AGENTS.find((b) => b.id === a.id).command) delete cfg.overrides[a.id]; else cfg.overrides[a.id] = v; }
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
  // defaults: which agent starts selected, and the model / effort remembered for each agent
  const defSel = el("select", {}); for (const a of list) defSel.append(el("option", { value: a.id }, a.name));
  defSel.value = (await loadAgents()).last;
  const pfAgent = el("select", {}); for (const a of list) pfAgent.append(el("option", { value: a.id }, a.name));
  pfAgent.value = defSel.value;
  const pfModel = el("input", { type: "text", placeholder: tr("기본 모델 (비우면 에이전트 기본)") }), pfEffort = el("input", { type: "text", placeholder: tr("기본 effort (비우면 에이전트 기본)") });
  const pfNote = el("div", { class: "meta" });
  const loadPf = () => {
    const a = list.find((x) => x.id === pfAgent.value), pf = (cfg.prefs || {})[a.id] || {};
    pfModel.value = pf.model || ""; pfEffort.value = pf.effort || "";
    pfModel.disabled = !usesModel(a); pfEffort.disabled = !usesEffort(a);
    pfNote.textContent = usesModel(a) || usesEffort(a) ? "" : tr("이 에이전트의 명령에는 $WD_MODEL / $WD_EFFORT가 없어요.");
  };
  pfAgent.addEventListener("change", loadPf); loadPf();
  const defSave = el("button", { class: "btn", onclick: async () => {
    cfg.defaultAgent = defSel.value; cfg.prefs = { ...(cfg.prefs || {}), [pfAgent.value]: { model: pfModel.value.trim(), effort: pfEffort.value.trim() } };
    await saveAgentConfig(cfg); defSave.textContent = tr("저장됨"); setTimeout(() => { defSave.textContent = tr("저장"); }, 1200);
  } }, tr("저장"));
  const guide = el("textarea", { class: "guide" }); guide.value = await loadIssueGuide();
  const guideSave = el("button", { class: "btn", onclick: async () => {
    await store.set("issueGuide", guide.value.trim() === DEFAULT_ISSUE_GUIDE ? "" : guide.value);
    guideSave.textContent = tr("저장됨"); setTimeout(() => { guideSave.textContent = tr("저장"); }, 1200);
  } }, tr("저장"));
  const guideReset = el("button", { class: "btn", title: tr("기본 지침으로 되돌리기"), onclick: async () => { guide.value = DEFAULT_ISSUE_GUIDE; await store.set("issueGuide", ""); } }, tr("기본값"));
  dialog.append(
    el("div", { class: "dhead" }, el("b", {}, tr("에이전트 관리")), el("button", { class: "btn", onclick: close }, tr("닫기"))),
    el("div", { class: "sec-title" }, tr("기본값")),
    el("div", { class: "agentedit def" }, el("span", { class: "meta" }, tr("기본 에이전트")), defSel, el("span", {}), el("span", {})),
    el("div", { class: "agentedit def" }, pfAgent, el("div", { class: "tools" }, pfModel, pfEffort), defSave, el("span", {})),
    pfNote,
    el("div", { class: "sec-title" }, tr("이슈 처리 지침 (영어, 이슈를 에이전트로 진행할 때 프롬프트에 들어가요)")), guide, el("div", { class: "row" }, guideReset, guideSave),
    el("div", { class: "sec-title" }, tr("에이전트 명령")),
    el("div", { class: "meta" }, tr("명령에서 {file}은 프롬프트가 담긴 파일 경로로 바뀌어요. 터미널 탭에서 이 명령이 실행됩니다.")),
    ...list.map(rowFor),
    el("div", { class: "agentedit new" }, newName, newCmd, add),
    err
  );
  document.body.append(overlay);
}
