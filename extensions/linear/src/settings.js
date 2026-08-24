// 설정 모달. 🌐 글로벌(muxy.storage) / 📁 이 프로젝트(.linear.json) 스코프를 토글로 전환한다.
// - 글로벌: API 키 선택 · 기본 팀 키 · 기본 베이스 브랜치 · worktree 위치 · 에이전트 · 목록 표시
// - 프로젝트: 팀/프로젝트 연결 + 핵심 실행값(API 키 · 베이스 · worktree · 에이전트) 오버라이드(빈 값=전역 상속)

import "./theme.css";
import "./modal.css";
import { run } from "./fatal.js";
import { loadConfig, saveConfig } from "./config.js";
import { fetchTeams, fetchTeamProjects, fetchProjectByName } from "./linear.js";
import { readProjectConfig, writeProjectConfig, clearProjectConfig } from "./project.js";
import { AGENTS } from "./agents.js";
import { setLang, t, LANGS } from "./i18n.js";

const muxy = window.muxy;
const app = document.getElementById("app");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function main() {
  const config = await loadConfig();
  setLang(config.language); // UI 언어 적용
  let projectCfg = await readProjectConfig(); // .linear.json 또는 null
  const tokenEntries = Array.isArray(config.api_tokens) ? config.api_tokens : [];

  app.innerHTML = `
    <h2 class="m-title">${t("set.title")}</h2>
    <div class="seg" id="scope" style="margin:6px 0 6px">
      <button class="seg-btn" data-scope="global">${t("scope.global")}</button>
      <button class="seg-btn" data-scope="project">${t("scope.project")}</button>
    </div>
    <div id="scope-banner" class="scope-banner"></div>
    <div id="scope-body"></div>
    <p id="err" class="error" hidden></p>
    <div class="actions">
      <button id="close" class="primary">${t("common.close")}</button>
    </div>
  `;

  const body = document.getElementById("scope-body");
  const errEl = document.getElementById("err");
  let scope = "global";

  // ── 공용 로더: 저장소 브랜치 목록(로컬+원격) 한 번만 불러와 캐시 ──
  let baseBranches = null;
  async function getBranches() {
    if (baseBranches) return baseBranches;
    try {
      const [loc, rem] = await Promise.all([
        window.muxy.git.branches().catch(() => []),
        window.muxy.git.remoteBranches().catch(() => []),
      ]);
      baseBranches = [...new Set([...loc, ...rem.map((b) => b.replace(/^origin\//, ""))])];
    } catch {
      baseBranches = [];
    }
    return baseBranches;
  }

  // 에이전트 select+input 한 쌍을 채운다. allowInherit 이면 "(전역 설정 사용)" 옵션 추가.
  function wireAgent(selId, inputId, allowInherit, inheritLabel) {
    const sel = document.getElementById(selId);
    const input = document.getElementById(inputId);
    sel.innerHTML = "";
    if (allowInherit) {
      const o = document.createElement("option");
      o.value = "__inherit";
      o.textContent = inheritLabel || t("set.inheritGlobal");
      sel.append(o);
    }
    for (const a of AGENTS) {
      const o = document.createElement("option");
      o.value = a.v;
      o.textContent = a.t;
      sel.append(o);
    }
    const custom = document.createElement("option");
    custom.value = "__custom";
    custom.textContent = t("common.customInput");
    sel.append(custom);
    const sync = () => {
      const v = input.value.trim();
      if (allowInherit && !v) { sel.value = "__inherit"; return; }
      sel.value = AGENTS.some((a) => a.v === v) ? v : "__custom";
    };
    sync();
    sel.addEventListener("change", () => {
      if (sel.value === "__inherit") { input.value = ""; input.disabled = true; return; }
      input.disabled = false;
      if (sel.value !== "__custom") input.value = sel.value;
      else input.focus();
    });
    input.addEventListener("input", sync);
    if (allowInherit && !input.value.trim()) input.disabled = true;
  }

  // 팀 키 select 를 팀 목록으로 채운다(현재 값 보존).
  function fillTeams(selId, teams, current) {
    const sel = document.getElementById(selId);
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = t("set.teamAll");
    sel.append(opt0);
    let found = false;
    for (const tm of teams) {
      const o = document.createElement("option");
      o.value = tm.key;
      o.textContent = `${tm.name} (${tm.key})`;
      if (tm.key === current) { o.selected = true; found = true; }
      sel.append(o);
    }
    if (current && !found) {
      const o = document.createElement("option");
      o.value = current;
      o.textContent = t("set.teamSaved", { key: current });
      o.selected = true;
      sel.append(o);
    }
  }
  async function loadTeams(selId, hintId, token, current) {
    const hint = document.getElementById(hintId);
    if (!token) {
      fillTeams(selId, [], current);
      if (hint) hint.textContent = t("set.teamHintInit");
      return;
    }
    if (hint) hint.textContent = t("set.teamLoading");
    try {
      const teams = await fetchTeams(token);
      fillTeams(selId, teams, current);
      if (hint) hint.textContent = teams.length ? t("set.teamCount", { n: teams.length }) : t("set.teamNone");
    } catch (e) {
      fillTeams(selId, [], current);
      if (hint) hint.textContent = t("set.teamLoadFail", { msg: e.message });
    }
  }

  // 상속 표기: 전역값이 있으면 "값 (상속)", 없으면 "(전역 설정 사용)".
  function inheritedText(v) {
    return v && String(v).trim() ? t("set.inherited", { v }) : t("set.inheritGlobal");
  }

  // 베이스 브랜치 select 채우기. allowInherit 이면 상속 옵션(inheritLabel 지정 가능).
  function fillBaseBranches(selId, all, current, allowInherit, inheritLabel) {
    const sel = document.getElementById(selId);
    sel.innerHTML = "";
    if (allowInherit) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = inheritLabel || t("set.inheritGlobal");
      sel.append(o);
    }
    const list = [...all];
    if (current && !list.includes(current)) list.unshift(current);
    for (const b of list) {
      const o = document.createElement("option");
      o.value = b;
      o.textContent = b;
      if (b === current) o.selected = true;
      sel.append(o);
    }
    sel.value = current || (allowInherit ? "" : list[0] || "");
  }

  // ── 글로벌 스코프 바디 ─────────────────────────────────────────
  function renderGlobal() {
    // 등록된 키 select 옵션
    const tokenOptions = tokenEntries.length
      ? tokenEntries.map((e) => `<option value="${escapeHtml(e.id)}">${e.label ? escapeHtml(e.label) : "—"}</option>`).join("")
      : `<option value="">${t("set.noKeysRegistered")}</option>`;
    // 언어 select 옵션
    const langOptions = LANGS.map((l) => `<option value="${l.v}" ${config.language === l.v ? "selected" : ""}>${l.t}</option>`).join("");

    body.innerHTML = `
      <div class="field">
        <span class="label">${t("set.language")}</span>
        <select id="language">${langOptions}</select>
      </div>

      <div class="field">
        <span class="label">${t("set.apiKey")}</span>
        <div class="row" style="gap:6px">
          <select id="api_token_active" style="flex:1" ${tokenEntries.length ? "" : "disabled"}>${tokenOptions}</select>
          <button type="button" id="manage-keys" class="mini">${t("set.manageKeys")}</button>
        </div>
        <div class="hint">${t("set.apiKeyHintGlobal")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.teamKey")}</span>
        <select id="team_key"></select>
        <div class="hint" id="team_hint">${t("set.teamHintInit")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.baseBranch")}</span>
        <select id="default_base_branch"></select>
        <div class="hint" id="base_hint">${t("set.baseLoading")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.branchNameTpl")}</span>
        <input type="text" id="branch_name_template" value="${escapeHtml(config.branch_name_template || "")}" placeholder="${escapeHtml(t("set.branchNameTplPh"))}" />
        <div class="hint">${t("set.branchNameTplHint")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.worktreeNameTpl")}</span>
        <input type="text" id="worktree_name_template" value="${escapeHtml(config.worktree_name_template || "")}" placeholder="${escapeHtml(t("set.worktreeNameTplPh"))}" />
        <div class="hint">${t("set.worktreeNameTplHint")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.agent")}</span>
        <select id="agent_select"></select>
        <input type="text" id="agent_command" value="${escapeHtml(config.agent_command)}" placeholder="${t("set.agentPh")}" style="margin-top:6px" />
        <div class="hint">${t("set.agentHint")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.issueOpenMode")}</span>
        <select id="issue_open_mode">
          <option value="tab" ${config.issue_open_mode === "tab" ? "selected" : ""}>${t("set.openModeTab")}</option>
          <option value="modal" ${config.issue_open_mode === "modal" ? "selected" : ""}>${t("set.openModeModal")}</option>
          <option value="split" ${config.issue_open_mode === "split" ? "selected" : ""}>${t("set.openModeSplit")}</option>
        </select>
        <div class="hint">${t("set.issueOpenModeHint")}</div>
      </div>

      <hr class="sep" />
      <h3 class="sec-title">${t("set.listShow")}</h3>
      <label class="checkbox field"><input type="checkbox" id="list_show_state" ${config.list_show_state ? "checked" : ""} /> ${t("set.showState")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_priority" ${config.list_show_priority ? "checked" : ""} /> ${t("set.showPriority")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_labels" ${config.list_show_labels ? "checked" : ""} /> ${t("set.showLabels")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_project" ${config.list_show_project ? "checked" : ""} /> ${t("set.showProject")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_milestone" ${config.list_show_milestone ? "checked" : ""} /> ${t("set.showMilestone")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_assignee" ${config.list_show_assignee ? "checked" : ""} /> ${t("set.showAssignee")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_parent" ${config.list_show_parent ? "checked" : ""} /> ${t("set.showParent")}</label>
      <label class="checkbox field"><input type="checkbox" id="list_show_actions" ${config.list_show_actions ? "checked" : ""} /> ${t("set.showActions")}</label>
      <label class="checkbox field"><input type="checkbox" id="show_branch_bar" ${config.show_branch_bar ? "checked" : ""} /> ${t("set.showBranchBar")}</label>
    `;

    // API 키 select
    const tokenSel = document.getElementById("api_token_active");
    if (tokenEntries.length) {
      const active = tokenEntries.find((t) => t.id === config.api_token_active) ? config.api_token_active : tokenEntries[0].id;
      tokenSel.value = active;
    }
    const globalToken = () => tokenEntries.find((t) => t.id === tokenSel.value)?.token || "";
    tokenSel.addEventListener("change", () => loadTeams("team_key", "team_hint", globalToken(), document.getElementById("team_key").value));

    // 언어 변경: 즉시 반영을 위해 config.language 를 갱신하고 전체 재렌더.
    document.getElementById("language").addEventListener("change", (e) => {
      config.language = e.target.value;
      setLang(config.language);
      applyScope();
    });

    // 관리 모달
    document.getElementById("manage-keys").addEventListener("click", async () => {
      await muxy.modal.openWebview({ entry: "modals/apikeys.html", width: 480, height: 460 });
      muxy.lifecycle.close();
    });

    // 팀
    fillTeams("team_key", [], config.team_key);
    loadTeams("team_key", "team_hint", globalToken(), config.team_key);

    // 베이스 브랜치 + 새 브랜치 만들기
    const NEW_BRANCH = "__new_branch__";
    const baseSel = document.getElementById("default_base_branch");
    fillBaseBranches("default_base_branch", [], config.default_base_branch, false);
    let lastBase = config.default_base_branch;
    getBranches().then((br) => {
      fillBaseBranches("default_base_branch", br, config.default_base_branch, false);
      const nb = document.createElement("option");
      nb.value = NEW_BRANCH;
      nb.textContent = t("set.newBranch");
      baseSel.append(nb);
      const hint = document.getElementById("base_hint");
      hint.textContent = br.length ? t("set.baseCount", { n: br.length }) : t("set.baseFail");
    });
    baseSel.addEventListener("change", async () => {
      if (baseSel.value !== NEW_BRANCH) { lastBase = baseSel.value; return; }
      baseSel.value = lastBase;
      let name = null;
      try {
        name = await muxy.dialog.prompt?.({ title: t("set.newBranchTitle"), message: t("set.newBranchMsg"), placeholder: t("set.newBranchPh"), confirm: t("set.newBranchConfirm"), cancel: t("common.cancel") });
      } catch { name = null; }
      const trimmed = (name || "").trim();
      if (!trimmed) return;
      const br = await getBranches();
      if (br.includes(trimmed)) { fillBaseBranches("default_base_branch", br, trimmed, false); baseSel.append(mkNewBranchOption(NEW_BRANCH)); lastBase = trimmed; return; }
      try {
        await window.muxy.git.branch.create({ name: trimmed });
        br.unshift(trimmed);
        fillBaseBranches("default_base_branch", br, trimmed, false);
        baseSel.append(mkNewBranchOption(NEW_BRANCH));
        lastBase = trimmed;
        muxy.toast?.({ title: t("set.branchCreated"), body: trimmed });
      } catch (err) {
        muxy.toast?.({ title: t("set.branchCreateFail"), body: err.message });
      }
    });

    wireAgent("agent_select", "agent_command", false);
  }

  function mkNewBranchOption(value) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = t("set.newBranch");
    return o;
  }

  // ── 프로젝트 스코프 바디 ───────────────────────────────────────
  function renderProject() {
    const s = projectCfg?.settings || {};
    // 상속받는 전역값(상속 옵션/placeholder 표기에 사용).
    const activeGlobal = tokenEntries.find((e) => e.id === config.api_token_active) || tokenEntries[0];
    const globalKeyLabel = activeGlobal ? (activeGlobal.label || "—") : "";
    // 이 프로젝트가 쓸 API 키 옵션: (전역=상속) + 등록 키들 + (직접 입력된 키 유지)
    const rawLegacy = projectCfg?.apiToken && !projectCfg?.apiTokenId;
    const globalKeyOptText = globalKeyLabel ? t("set.inherited", { v: globalKeyLabel }) : t("set.useGlobalKey");
    const keyOptions = [`<option value="">${escapeHtml(globalKeyOptText)}</option>`]
      .concat(tokenEntries.map((e) => `<option value="${escapeHtml(e.id)}">${e.label ? escapeHtml(e.label) : "—"}</option>`))
      .concat(rawLegacy ? [`<option value="__raw">${t("set.keptRawKey")}</option>`] : [])
      .join("");

    body.innerHTML = `
      <div class="field">
        <span class="label">${t("set.connectStatus")}</span>
        <p class="hint" id="link-status" style="margin-top:0">${t("set.linkLoading")}</p>
      </div>
      <div class="field">
        <span class="label">${t("link.team")}</span>
        <select id="link-team"><option>${t("common.loading")}</option></select>
      </div>
      <div class="field">
        <span class="label">${t("link.project")}</span>
        <select id="link-project"><option value="">${t("link.selectTeamFirst")}</option></select>
      </div>

      <hr class="sep" />
      <h3 class="sec-title">${t("set.overrideTitle")} <span class="hint">${t("set.inheritNote")}</span></h3>

      <div class="field">
        <span class="label">${t("set.projApiKey")}</span>
        <select id="p_api_key">${keyOptions}</select>
        <div class="hint">${t("set.projApiKeyHint")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.baseBranch")}</span>
        <select id="p_base"></select>
      </div>

      <div class="field">
        <span class="label">${t("set.branchNameTpl")}</span>
        <input type="text" id="p_branch_name_template" value="${escapeHtml(s.branch_name_template || "")}" placeholder="${escapeHtml(inheritedText(config.branch_name_template))}" />
        <div class="hint">${t("set.branchNameTplHint")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.worktreeNameTpl")}</span>
        <input type="text" id="p_worktree_name_template" value="${escapeHtml(s.worktree_name_template || "")}" placeholder="${escapeHtml(inheritedText(config.worktree_name_template))}" />
        <div class="hint">${t("set.worktreeNameTplHint")}</div>
      </div>

      <div class="field">
        <span class="label">${t("set.agent")}</span>
        <select id="p_agent_select"></select>
        <input type="text" id="p_agent_command" value="${escapeHtml(s.agent_command || "")}" placeholder="${escapeHtml(inheritedText(config.agent_command))}" style="margin-top:6px" />
      </div>

      <div class="row">
        <button id="link-unlink" class="mini" hidden>${t("link.unlink")}</button>
        <span class="spacer"></span>
      </div>
    `;

    // API 키 선택 초기값
    const pKey = document.getElementById("p_api_key");
    pKey.value = rawLegacy ? "__raw" : (projectCfg?.apiTokenId || "");

    // 베이스 오버라이드(상속 옵션에 전역 베이스 표기)
    const baseInherit = inheritedText(config.default_base_branch);
    fillBaseBranches("p_base", [], s.default_base_branch || "", true, baseInherit);
    getBranches().then((br) => fillBaseBranches("p_base", br, s.default_base_branch || "", true, baseInherit));

    // 에이전트 오버라이드(상속 옵션에 전역 에이전트 표기)
    wireAgent("p_agent_select", "p_agent_command", true, inheritedText(config.agent_command));

    wireProjectLink();
  }

  // 프로젝트 연결(팀/프로젝트 select) 로딩 + 자동 매칭.
  async function wireProjectLink() {
    const statusEl = document.getElementById("link-status");
    const teamSel = document.getElementById("link-team");
    const projSel = document.getElementById("link-project");
    const unlinkBtn = document.getElementById("link-unlink");
    const pKey = document.getElementById("p_api_key");

    const option = (value, text, selected) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      if (selected) o.selected = true;
      return o;
    };

    // 조회에 쓸 토큰: 프로젝트가 고른 키(전역 목록/raw) 우선, 없으면 전역 활성.
    function projToken() {
      const v = pKey.value;
      if (v === "__raw") return (projectCfg?.apiToken || "").trim();
      if (v) return tokenEntries.find((t) => t.id === v)?.token || "";
      return config.api_token;
    }

    // API 키를 바꾸면 팀/프로젝트를 다시 로드(onchange 할당으로 중복 방지). 이른 return 전에 항상 바인딩.
    pKey.onchange = () => wireProjectLink();
    // 연결 해제 버튼
    unlinkBtn.onclick = async () => {
      await clearProjectConfig();
      projectCfg = null;
      muxy.toast?.({ title: t("set.unlinked") });
      applyScope();
    };

    unlinkBtn.hidden = !projectCfg;
    statusEl.textContent = projectCfg
      ? t("set.linked", { name: projectCfg.projectName || projectCfg.teamKey || t("scope.project") })
      : t("set.notLinked");

    async function loadProjects(teamId, selectId) {
      projSel.innerHTML = "";
      projSel.append(option("", t("common.loading")));
      try {
        const projects = await fetchTeamProjects(projToken(), teamId);
        projSel.innerHTML = "";
        projSel.append(option("", t("set.projWhole")));
        for (const p of projects) projSel.append(option(p.id, p.name, p.id === selectId));
      } catch (e) {
        statusEl.textContent = t("set.projLoadFail", { msg: e.message });
      }
    }

    // 연결 정보 없으면 폴더명과 같은 프로젝트 자동 매칭.
    let initial = projectCfg;
    if (!initial && projToken()) {
      try {
        const repo = await window.muxy.git.repoInfo();
        const folder = repo?.root ? repo.root.replace(/\/+$/, "").split("/").pop() : "";
        if (folder) {
          const match = await fetchProjectByName(projToken(), folder);
          if (match) {
            initial = { teamKey: match.teams?.nodes?.[0]?.key || "", projectId: match.id, projectName: match.name };
            statusEl.textContent = t("set.autoMatched", { folder });
          }
        }
      } catch { /* 무시 */ }
    }

    if (!projToken()) {
      statusEl.textContent = t("set.needKeyForTeams");
      teamSel.innerHTML = "";
      teamSel.append(option("", t("set.keyNeeded")));
      return;
    }

    try {
      const teams = await fetchTeams(projToken());
      teamSel.innerHTML = "";
      const wantKey = initial?.teamKey || config.team_key;
      let selectedTeam = null;
      for (const t of teams) {
        const isSel = t.key === wantKey;
        teamSel.append(option(t.id, `${t.name} (${t.key})`, isSel));
        if (isSel) selectedTeam = t;
      }
      if (!selectedTeam && teams.length) { selectedTeam = teams[0]; teamSel.value = teams[0].id; }
      teamSel.dataset.key = selectedTeam?.key ?? "";
      // onchange 할당(중복 리스너 방지 — wireProjectLink 가 다시 호출될 수 있음).
      teamSel.onchange = () => {
        const t = teams.find((x) => x.id === teamSel.value);
        teamSel.dataset.key = t?.key ?? "";
        loadProjects(teamSel.value, "");
      };
      if (selectedTeam) await loadProjects(selectedTeam.id, initial?.projectId);
    } catch (e) {
      statusEl.textContent = t("set.teamLoadFail2", { msg: e.message });
    }
  }

  // ── 스코프 전환 ────────────────────────────────────────────────
  function applyScope() {
    for (const b of document.querySelectorAll("#scope .seg-btn")) {
      b.classList.toggle("is-active", b.dataset.scope === scope);
    }
    const banner = document.getElementById("scope-banner");
    errEl.hidden = true;
    if (scope === "project") {
      banner.className = "scope-banner project";
      banner.textContent = t("set.bannerProject");
      renderProject();
    } else {
      banner.className = "scope-banner global";
      banner.textContent = t("set.bannerGlobal");
      renderGlobal();
    }
  }

  document.getElementById("scope").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn || btn.dataset.scope === scope) return;
    scope = btn.dataset.scope;
    applyScope();
  });

  // ── 자동 저장(스코프별) ────────────────────────────────────────
  // 저장 버튼 없이, 값이 바뀔 때마다 현재 스코프를 곧바로 저장한다(KNK-62).
  const val = (id) => document.getElementById(id)?.value.trim() ?? "";
  const checked = (id) => !!document.getElementById(id)?.checked;

  // 전역 설정을 muxy.storage 에 저장하고 인메모리 config 도 최신화한다(재렌더 대비).
  async function persistGlobal() {
    const tokenSel = document.getElementById("api_token_active");
    const activeId = tokenSel?.value || "";
    const activeToken = tokenEntries.find((e) => e.id === activeId)?.token || "";
    const next = {
      language: document.getElementById("language")?.value || config.language,
      api_token_active: activeId,
      api_token: activeToken, // 하위 호환: 활성 키를 단일 값에도 반영
      team_key: val("team_key"),
      default_base_branch: val("default_base_branch") || "develop",
      branch_name_template: val("branch_name_template"),
      worktree_name_template: val("worktree_name_template"),
      agent_command: val("agent_command") || "claude",
      issue_open_mode: val("issue_open_mode") || "tab",
      list_show_state: checked("list_show_state"),
      list_show_priority: checked("list_show_priority"),
      list_show_labels: checked("list_show_labels"),
      list_show_project: checked("list_show_project"),
      list_show_milestone: checked("list_show_milestone"),
      list_show_assignee: checked("list_show_assignee"),
      list_show_parent: checked("list_show_parent"),
      list_show_actions: checked("list_show_actions"),
      show_branch_bar: checked("show_branch_bar"),
    };
    await saveConfig(next);
    Object.assign(config, next);
  }

  // 프로젝트 오버라이드(.linear.json)를 저장한다. 팀/프로젝트가 아직 없으면 조용히 건너뛴다.
  async function persistProject() {
    const teamSel = document.getElementById("link-team");
    const projSel = document.getElementById("link-project");
    const pKey = document.getElementById("p_api_key");
    if (!teamSel || !projSel || !pKey) return; // 아직 렌더 전
    // 연결 정보
    const cfg = { ...(projectCfg || {}) };
    cfg.teamKey = teamSel?.dataset.key || cfg.teamKey || "";
    cfg.projectId = projSel?.value || "";
    cfg.projectName = projSel?.value ? projSel.options[projSel.selectedIndex].text : "";
    // API 키 선택
    delete cfg.apiTokenId;
    if (pKey.value === "__raw") {
      // 직접 입력된 전용 키 유지(projectCfg.apiToken 그대로)
    } else if (pKey.value) {
      cfg.apiTokenId = pKey.value;
      delete cfg.apiToken;
    } else {
      delete cfg.apiToken; // 전역 사용
    }
    // 핵심 실행값 오버라이드(빈 값은 제외)
    const settings = {};
    const base = val("p_base");
    const agent = val("p_agent_command");
    const branchTpl = val("p_branch_name_template");
    const worktreeTpl = val("p_worktree_name_template");
    if (base) settings.default_base_branch = base;
    if (agent) settings.agent_command = agent;
    if (branchTpl) settings.branch_name_template = branchTpl;
    if (worktreeTpl) settings.worktree_name_template = worktreeTpl;
    if (Object.keys(settings).length) cfg.settings = settings;
    else delete cfg.settings;

    if (!cfg.teamKey && !cfg.projectId) return; // 연결 대상이 아직 없음 — 저장 보류
    await writeProjectConfig(cfg);
    projectCfg = cfg;
  }

  async function persistScope() {
    if (scope === "project") await persistProject();
    else await persistGlobal();
  }

  // 입력 폭주(타이핑)를 눌러 담아 잠깐 뒤에 저장.
  function debounce(fn, ms) {
    let tid = null;
    return () => {
      if (tid) clearTimeout(tid);
      tid = setTimeout(() => { tid = null; fn(); }, ms);
    };
  }
  const autoSave = debounce(() => { persistScope().catch(() => {}); }, 300);

  // #scope-body 는 스코프 전환/재렌더에도 유지되는 컨테이너이므로 위임으로 한 번만 바인딩한다.
  // 값 변경(select/checkbox)은 change, 텍스트 입력은 input 으로 감지. 버튼(click)은 대상 아님.
  body.addEventListener("change", autoSave);
  body.addEventListener("input", autoSave);

  // 닫기: 디바운스 대기분을 즉시 반영한 뒤 닫는다.
  document.getElementById("close").addEventListener("click", async () => {
    try { await persistScope(); } catch { /* 무시 */ }
    muxy.lifecycle.close();
  });

  applyScope();
}

run(main);
