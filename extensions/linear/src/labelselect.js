// 라벨 다중 선택 컴포넌트(select box 형태).
// - 컨트롤 클릭 → 드롭다운 열림. 검색으로 필터링하고 항목을 클릭해 토글한다.
// - 검색어와 정확히 일치하는 라벨이 없으면 "새 라벨 만들기" 항목이 뜬다(onCreate 제공 시).
// issue.js(즉시 서버 저장)와 create.js(생성 시 반영) 양쪽에서 재사용한다.
import { t } from "./i18n.js";

function h(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

// opts:
//   editable   편집 가능 여부(false 면 읽기 전용 칩 표시)
//   labels     초기 팀 라벨 [{id,name,color}]
//   selected   초기 선택 id 배열
//   onChange   async (nextIdsArray) => void  — 선택 변경 시 호출. throw 하면 이전 상태로 되돌린다.
//   onCreate   async (name) => label|null    — 새 라벨 생성. 반환 라벨을 목록에 추가·선택한다.
export function mountLabelSelect(container, opts = {}) {
  const { editable = true, labels = [], selected = [], onChange, onCreate } = opts;

  let all = labels.slice();
  let sel = new Set(selected);

  const root = h(`<div class="lblsel"></div>`);
  const control = h(`<button type="button" class="lblsel-control"></button>`);
  const pop = h(`<div class="lblsel-pop" hidden></div>`);
  const search = h(`<input type="text" class="lblsel-search" />`);
  search.placeholder = t("label.searchPh");
  const list = h(`<div class="lblsel-list"></div>`);
  const createBtn = h(`<button type="button" class="lblsel-create" hidden></button>`);
  pop.append(search, list, createBtn);
  root.append(control, pop);
  container.appendChild(root);

  if (!editable) control.disabled = true;

  // 컨트롤(선택된 라벨 칩 또는 안내문)
  function renderControl() {
    control.innerHTML = "";
    const chosen = all.filter((l) => sel.has(l.id));
    if (!chosen.length) {
      const ph = h(`<span class="lblsel-ph"></span>`);
      ph.textContent = editable ? t("label.placeholder") : t("issue.noLabels");
      control.append(ph);
      return;
    }
    for (const l of chosen) {
      const chip = h(`<span class="lblsel-chip"></span>`);
      chip.style.setProperty("--label-color", l.color || "#8a8f98");
      chip.textContent = l.name;
      control.append(chip);
    }
  }

  // 드롭다운 목록 + 새 라벨 만들기 항목
  function renderList() {
    const raw = search.value.trim();
    const q = raw.toLowerCase();
    list.innerHTML = "";
    const filtered = all.filter((l) => !q || l.name.toLowerCase().includes(q));
    for (const l of filtered) {
      const row = h(`<button type="button" class="lblsel-opt"></button>`);
      row.classList.toggle("on", sel.has(l.id));
      const dot = h(`<span class="lblsel-dot"></span>`);
      dot.style.background = l.color || "#8a8f98";
      const name = h(`<span class="lblsel-name"></span>`);
      name.textContent = l.name;
      const check = h(`<span class="lblsel-check">✓</span>`);
      row.append(dot, name, check);
      row.addEventListener("click", (e) => { e.stopPropagation(); toggle(l.id); });
      list.append(row);
    }
    const exact = all.some((l) => l.name.toLowerCase() === q);
    if (editable && raw && !exact && onCreate) {
      createBtn.hidden = false;
      createBtn.textContent = t("label.createTpl", { name: raw });
    } else {
      createBtn.hidden = true;
    }
    if (!filtered.length && createBtn.hidden) {
      list.append(h(`<div class="lblsel-empty">${t("md.noResults")}</div>`));
    }
  }

  async function toggle(id) {
    const prev = new Set(sel);
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    renderControl();
    renderList();
    if (onChange) {
      try { await onChange([...sel]); }
      catch { sel = prev; renderControl(); renderList(); }
    }
  }

  let creating = false;
  async function doCreate() {
    const name = search.value.trim();
    if (!name || creating || !onCreate) return;
    creating = true;
    createBtn.disabled = true;
    try {
      const label = await onCreate(name);
      if (label) {
        if (!all.some((l) => l.id === label.id)) all.push(label);
        sel.add(label.id);
        search.value = "";
        renderControl();
        renderList();
        if (onChange) { try { await onChange([...sel]); } catch { /* 생성은 됐으니 유지 */ } }
      }
    } finally {
      creating = false;
      createBtn.disabled = false;
    }
  }

  control.addEventListener("click", (e) => {
    if (control.disabled) return;
    e.stopPropagation();
    const willOpen = pop.hidden;
    pop.hidden = !willOpen;
    if (willOpen) { search.value = ""; renderList(); search.focus(); }
  });
  createBtn.addEventListener("click", (e) => { e.stopPropagation(); doCreate(); });
  search.addEventListener("input", renderList);
  search.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); if (!createBtn.hidden) doCreate(); }
    else if (e.key === "Escape") { pop.hidden = true; }
  });
  // 바깥 클릭 시 닫기
  const onDocClick = (e) => { if (!root.contains(e.target)) pop.hidden = true; };
  document.addEventListener("click", onDocClick);

  renderControl();

  return {
    setLabels(next) { all = (next || []).slice(); renderControl(); if (!pop.hidden) renderList(); },
    setSelected(ids) { sel = new Set(ids || []); renderControl(); if (!pop.hidden) renderList(); },
    getSelected() { return [...sel]; },
    destroy() { document.removeEventListener("click", onDocClick); root.remove(); },
  };
}
