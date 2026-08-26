// 프로젝트 연결 모달: 현재 git 프로젝트를 특정 Linear 팀/프로젝트에 매핑해
// .linear.json 으로 저장한다. 저장 후 패널은 그 프로젝트로 자동 필터된다.

import "./theme.css";
import "./modal.css";
import { run } from "./fatal.js";
import { loadConfig } from "./config.js";
import { fetchTeams, fetchTeamProjects, fetchProjectByName } from "./linear.js";
import { readProjectConfig, writeProjectConfig, clearProjectConfig } from "./project.js";
import { setLang, t } from "./i18n.js";

const muxy = window.muxy;
const app = document.getElementById("app");

function option(value, text, selected) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  if (selected) o.selected = true;
  return o;
}

// 현재 git 저장소 루트의 폴더명.
async function currentFolderName() {
  try {
    const repo = await muxy.git.repoInfo();
    return repo?.root ? repo.root.replace(/\/+$/, "").split("/").pop() : "";
  } catch {
    return "";
  }
}

async function main() {
  const config = await loadConfig();
  setLang(config.language);
  if (!config.api_token) {
    app.innerHTML = `<p class="error">${t("link.needKey")}</p>
      <div class="actions"><button id="close">${t("common.close")}</button></div>`;
    document.getElementById("close").addEventListener("click", () => muxy.lifecycle.close());
    return;
  }

  const current = await readProjectConfig();

  app.innerHTML = `
    <h2 class="m-title">${t("link.title")}</h2>
    <p class="hint" style="margin-top:-4px">${t("link.hint")}</p>

    <div class="field">
      <span class="label">${t("link.team")}</span>
      <select id="team"><option>${t("common.loading")}</option></select>
    </div>
    <div class="field">
      <span class="label">${t("link.project")}</span>
      <select id="project"><option value="">${t("link.selectTeamFirst")}</option></select>
    </div>

    <p id="err" class="error" hidden></p>
    <div class="actions">
      <button id="unlink" ${current ? "" : "hidden"}>${t("link.unlink")}</button>
      <span class="spacer"></span>
      <button id="cancel">${t("common.cancel")}</button>
      <button id="save" class="primary">${t("common.save")}</button>
    </div>
  `;

  const $ = (id) => document.getElementById(id);
  const errEl = $("err");
  const showErr = (m) => { errEl.textContent = m; errEl.hidden = !m; };

  // 프로젝트 select 를 특정 팀으로 채운다.
  async function loadProjects(teamId, selectId) {
    const sel = $("project");
    sel.innerHTML = "";
    sel.append(option("", t("common.loading")));
    try {
      const projects = await fetchTeamProjects(config.api_token, teamId);
      sel.innerHTML = "";
      sel.append(option("", t("link.wholeTeam")));
      for (const p of projects) sel.append(option(p.id, p.name, p.id === selectId));
    } catch (e) {
      showErr(e.message);
    }
  }

  // 연결 정보가 없으면, 저장소 폴더명과 이름이 같은 Linear 프로젝트를 자동 매칭해
  // 초기 선택값으로 사용한다.
  let initial = current;
  if (!initial) {
    const folder = await currentFolderName();
    if (folder) {
      try {
        const match = await fetchProjectByName(config.api_token, folder);
        if (match) {
          initial = {
            teamKey: match.teams?.nodes?.[0]?.key || "",
            projectId: match.id,
            projectName: match.name,
          };
          const hint = document.createElement("div");
          hint.className = "hint";
          hint.textContent = t("link.autoMatched", { folder });
          app.querySelector(".m-title").after(hint);
        }
      } catch {
        /* 자동 매칭 실패는 무시 */
      }
    }
  }

  // 팀 목록 로드
  try {
    const teams = await fetchTeams(config.api_token);
    const teamSel = $("team");
    teamSel.innerHTML = "";
    // 초기 팀키(연결됨 or 자동매칭)가 있으면 그 팀을 선택, 없으면 전역 기본 팀키
    const wantKey = initial?.teamKey || config.team_key;
    let selectedTeam = null;
    for (const t of teams) {
      const isSel = t.key === wantKey;
      teamSel.append(option(t.id, `${t.name} (${t.key})`, isSel));
      if (isSel) selectedTeam = t;
    }
    if (!selectedTeam && teams.length) {
      selectedTeam = teams[0];
      teamSel.value = teams[0].id;
    }
    teamSel.dataset.key = selectedTeam?.key ?? "";
    teamSel.addEventListener("change", () => {
      const t = teams.find((x) => x.id === teamSel.value);
      teamSel.dataset.key = t?.key ?? "";
      loadProjects(teamSel.value, "");
    });
    if (selectedTeam) await loadProjects(selectedTeam.id, initial?.projectId);
  } catch (e) {
    showErr(e.message);
  }

  $("cancel").addEventListener("click", () => muxy.lifecycle.close());

  $("unlink").addEventListener("click", async () => {
    try {
      await clearProjectConfig();
      muxy.toast?.({ title: t("link.unlinked") });
      muxy.modal.submitWebview({ cleared: true });
    } catch (e) {
      showErr(e.message);
    }
  });

  $("save").addEventListener("click", async () => {
    showErr("");
    $("save").disabled = true;
    try {
      const teamSel = $("team");
      const projSel = $("project");
      const cfg = {
        teamKey: teamSel.dataset.key || "",
        projectId: projSel.value || "",
        projectName: projSel.value ? projSel.options[projSel.selectedIndex].text : "",
      };
      await writeProjectConfig(cfg);
      muxy.toast?.({ title: t("link.linked"), body: cfg.projectName || cfg.teamKey });
      muxy.modal.submitWebview({ saved: true, config: cfg });
    } catch (e) {
      showErr(e.message);
      $("save").disabled = false;
    }
  });
}

run(main);
