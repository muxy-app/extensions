// 설정 모달. 🌐 글로벌(muxy.storage) / 📁 이 프로젝트(.linear.json) 스코프를 토글로 전환한다.
// - 글로벌: API 키 선택 · 기본 팀 키 · 목록 표시
// - 프로젝트: 팀/프로젝트 연결 + API 키 오버라이드(빈 값=전역 상속)

import "./theme.css";
import "./modal.css";
import { run } from "./fatal.js";
import { loadConfig, saveConfig } from "./config.js";
import { fetchTeams, fetchTeamProjects, fetchProjectByName, createProject } from "./linear.js";
import { readProjectConfig, writeProjectConfig, clearProjectConfig } from "./project.js";
import { setLang, t } from "./i18n.js";

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

  // ── 글로벌 스코프 바디 ─────────────────────────────────────────
  function renderGlobal() {
    // 등록된 키 select 옵션
    const tokenOptions = tokenEntries.length
      ? tokenEntries.map((e) => `<option value="${escapeHtml(e.id)}">${e.label ? escapeHtml(e.label) : "—"}</option>`).join("")
      : `<option value="">${t("set.noKeysRegistered")}</option>`;

    body.innerHTML = `
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
        <span class="label">${t("set.issueOpenMode")}</span>
        <select id="issue_open_mode">
          <option value="tab" ${config.issue_open_mode === "tab" ? "selected" : ""}>${t("set.openModeTab")}</option>
          <option value="modal" ${config.issue_open_mode === "modal" ? "selected" : ""}>${t("set.openModeModal")}</option>
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

    // 관리 모달
    document.getElementById("manage-keys").addEventListener("click", async () => {
      await muxy.modal.openWebview({ entry: "modals/apikeys.html", width: 480, height: 460 });
      muxy.lifecycle.close();
    });

    // 팀
    fillTeams("team_key", [], config.team_key);
    loadTeams("team_key", "team_hint", globalToken(), config.team_key);
  }

  // ── 프로젝트 스코프 바디 ───────────────────────────────────────
  function renderProject() {
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
      <h3 class="sec-title">${t("set.overrideTitle")} <span class="hint">${t("set.inheritNote")}</span></h3>

      <div class="field">
        <span class="label">${t("set.projApiKey")}</span>
        <select id="p_api_key">${keyOptions}</select>
        <div class="hint">${t("set.projApiKeyHint")}</div>
      </div>

      <hr class="sep" />

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
        <div class="row" style="gap:6px">
          <select id="link-project" style="flex:1"><option value="">${t("link.selectTeamFirst")}</option></select>
          <button type="button" id="proj-new-btn" class="mini">${t("set.newProject")}</button>
        </div>
        <div class="row" id="proj-new-row" style="gap:6px; margin-top:6px" hidden>
          <input type="text" id="proj-new-name" style="flex:1" placeholder="${escapeHtml(t("set.newProjectPh"))}" />
          <button type="button" id="proj-new-create" class="mini primary">${t("common.create")}</button>
          <button type="button" id="proj-new-cancel" class="mini">${t("common.cancel")}</button>
        </div>
        <div class="hint">${t("set.newProjectHint")}</div>
      </div>

      <div class="row">
        <button id="link-unlink" class="mini" hidden>${t("link.unlink")}</button>
        <span class="spacer"></span>
      </div>
    `;

    // API 키 선택 초기값
    const pKey = document.getElementById("p_api_key");
    pKey.value = rawLegacy ? "__raw" : (projectCfg?.apiTokenId || "");

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

    // ── 새 프로젝트 생성(연결할 프로젝트가 없을 때) ──────────────────
    const newBtn = document.getElementById("proj-new-btn");
    const newRow = document.getElementById("proj-new-row");
    const newName = document.getElementById("proj-new-name");
    const newCreate = document.getElementById("proj-new-create");
    const newCancel = document.getElementById("proj-new-cancel");

    // 인라인 입력 행을 열고 닫는다. (alert/prompt 는 확장을 멈추므로 인라인 입력을 쓴다.)
    function toggleNewRow(show) {
      newRow.hidden = !show;
      newBtn.hidden = show;
      if (show) { newName.value = ""; newName.focus(); }
    }
    newBtn.onclick = () => {
      // 팀이 선택돼 있어야 프로젝트를 만들 수 있다.
      if (!teamSel.value) { statusEl.textContent = t("set.newProjectNeedTeam"); return; }
      toggleNewRow(true);
    };
    newCancel.onclick = () => toggleNewRow(false);

    // 실제 생성: 선택된 팀에 프로젝트를 만들고 목록을 다시 불러와 새 프로젝트를 선택한다.
    async function doCreateProject() {
      const name = newName.value.trim();
      if (!name) { newName.focus(); return; }
      if (!teamSel.value) { statusEl.textContent = t("set.newProjectNeedTeam"); return; }
      newCreate.disabled = true;
      statusEl.textContent = t("set.projectCreating");
      try {
        const created = await createProject(projToken(), { teamId: teamSel.value, name });
        newName.value = ""; // 입력창 비우기
        toggleNewRow(false);
        await loadProjects(teamSel.value, created.id); // 새 프로젝트를 선택 상태로 목록 갱신
        statusEl.textContent = t("set.projectCreated", { name: created.name });
        muxy.toast?.({ title: t("set.projectCreated", { name: created.name }) });
        await persistProject(); // 연결 정보(.linear.json)에 즉시 반영
      } catch (e) {
        statusEl.textContent = t("set.projectCreateFail", { msg: e.message });
      } finally {
        newCreate.disabled = false;
      }
    }
    newCreate.onclick = doCreateProject;
    newName.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); doCreateProject(); }
      else if (ev.key === "Escape") { ev.preventDefault(); toggleNewRow(false); }
    };

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
      api_token_active: activeId,
      api_token: activeToken, // 하위 호환: 활성 키를 단일 값에도 반영
      team_key: val("team_key"),
      issue_open_mode: val("issue_open_mode") || "tab",
      list_show_state: checked("list_show_state"),
      list_show_priority: checked("list_show_priority"),
      list_show_labels: checked("list_show_labels"),
      list_show_project: checked("list_show_project"),
      list_show_milestone: checked("list_show_milestone"),
      list_show_assignee: checked("list_show_assignee"),
      list_show_parent: checked("list_show_parent"),
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
    // 프로젝트 오버라이드는 이제 API 키 선택뿐이라 별도 실행값 settings 는 없다.
    delete cfg.settings;

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
