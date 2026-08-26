// Personal API Key 관리 모달. 키를 여러 개(설명 + 값) 등록/삭제한다.
// 활성 키 선택은 설정 모달의 select box 에서 한다 — 여기선 목록만 관리.

import "./theme.css";
import "./modal.css";
import { run } from "./fatal.js";
import { loadConfig, saveConfig, activeTokenEntry } from "./config.js";
import { setLang, t } from "./i18n.js";

const muxy = window.muxy;
const app = document.getElementById("app");

let seq = 0;
const newId = () => `t${Date.now()}_${seq++}`;

async function main() {
  const config = await loadConfig();
  setLang(config.language);
  // 초기 목록: 저장된 목록(레거시 이관 포함) 사용, 없으면 빈 행 하나.
  let tokens = Array.isArray(config.api_tokens) ? config.api_tokens.slice() : [];
  if (!tokens.length) tokens = [{ id: newId(), label: "", token: "" }];
  const prevActiveId = activeTokenEntry(config)?.id || "";

  app.innerHTML = `
    <h2 class="m-title">${t("apikeys.title")}</h2>
    <p class="hint" style="margin-top:0">${t("apikeys.hint")}</p>
    <div class="hint" style="margin:6px 0 10px">${t("apikeys.path")}</div>
    <div id="token-list" class="token-list"></div>
    <button type="button" id="token-add" class="mini" style="margin-top:8px">${t("apikeys.add")}</button>
    <p id="err" class="error" hidden></p>
    <div class="actions">
      <button id="cancel">${t("common.cancel")}</button>
      <button id="save" class="primary">${t("common.save")}</button>
    </div>
  `;

  const listEl = document.getElementById("token-list");

  // 한 행: [설명] [키(password)] [삭제]
  function row(entry) {
    const r = document.createElement("div");
    r.className = "token-row";
    r.dataset.id = entry.id;

    const label = document.createElement("input");
    label.type = "text";
    label.className = "token-label";
    label.placeholder = t("apikeys.labelPh");
    label.value = entry.label || "";

    const token = document.createElement("input");
    token.type = "password";
    token.className = "token-key";
    token.placeholder = "lin_api_...";
    token.value = entry.token || "";
    token.addEventListener("input", () => token.classList.remove("invalid"));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini token-del";
    del.textContent = t("common.delete");
    del.addEventListener("click", () => {
      r.remove();
      if (!listEl.querySelector(".token-row")) addRow({ id: newId(), label: "", token: "" });
    });

    r.append(label, token, del);
    return r;
  }
  function addRow(entry) { listEl.append(row(entry)); }
  tokens.forEach(addRow);

  document.getElementById("token-add").addEventListener("click", () => addRow({ id: newId(), label: "", token: "" }));
  document.getElementById("cancel").addEventListener("click", () => muxy.lifecycle.close());

  document.getElementById("save").addEventListener("click", async () => {
    const errEl = document.getElementById("err");
    // 설명은 있는데 키가 빈 행은 오류로 표시(빨간 테두리). 설명·키 모두 빈 행은 그냥 무시.
    const list = [];
    let bad = 0;
    let firstBad = null;
    for (const r of listEl.querySelectorAll(".token-row")) {
      const labelEl = r.querySelector(".token-label");
      const keyEl = r.querySelector(".token-key");
      const label = labelEl.value.trim();
      const token = keyEl.value.trim();
      keyEl.classList.remove("invalid");
      if (!token && !label) continue; // 완전히 빈 행은 무시
      if (!token) { keyEl.classList.add("invalid"); bad++; firstBad = firstBad || keyEl; continue; }
      list.push({ id: r.dataset.id, label, token });
    }
    if (bad) {
      errEl.hidden = false;
      errEl.textContent = t("apikeys.emptyKeyErr");
      firstBad?.scrollIntoView({ block: "center" });
      firstBad?.focus();
      return;
    }
    // 활성 키 유지: 이전 활성 id가 목록에 남아 있으면 그대로, 없으면 첫 항목.
    const active = list.find((t) => t.id === prevActiveId)?.id || list[0]?.id || "";
    const activeToken = list.find((t) => t.id === active)?.token || "";
    await saveConfig({ api_tokens: list, api_token_active: active, api_token: activeToken });
    muxy.toast?.({ title: t("apikeys.saved"), body: `${list.length}` });
    muxy.modal.submitWebview({ saved: true });
  });
}

run(main);
