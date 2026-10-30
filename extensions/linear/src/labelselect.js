// 라벨 다중선택 콤보박스(select box).
// 팀 라벨을 select-box 형태의 컨트롤에서 다중 선택하고, 목록에 없는 이름을 입력하면
// 새 라벨을 즉석에서 생성해 선택할 수 있다.
// 이슈 생성(create.js)과 이슈 상세(issue.js) 양쪽에서 재사용한다.
import { t } from "./i18n.js";

function h(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// container 에 콤보박스를 마운트하고 제어용 API 를 돌려준다.
// 옵션:
//   labels      초기 팀 라벨 [{id,name,color}]
//   selected    초기 선택 라벨 id 배열
//   onChange    async (ids) => void  — 선택이 바뀔 때. throw 하면 이전 상태로 롤백한다.
//   onCreate    async (name) => {id,name,color} — 새 라벨 생성. 없으면 "추가" 기능 숨김.
//   onError     (err) => void — onChange/onCreate 실패를 바깥에 알림
//   disabled    읽기 전용 여부
//   placeholder 입력창 안내문(미지정 시 i18n 기본값)
export function mountLabelSelect(container, {
  labels = [],
  selected = [],
  onChange,
  onCreate,
  onError,
  disabled = false,
  placeholder = t("label.placeholder"),
} = {}) {
  let items = [...labels];
  let selectedIds = new Set(selected);
  let isDisabled = disabled;
  let open = false;
  let busy = false; // onChange/onCreate 진행 중 재진입 방지
  let activeIndex = -1; // 키보드 하이라이트 대상(menuRows 인덱스)
  let menuRows = []; // [{type:'label', id} | {type:'create', name}]

  const root = h(`<div class="labelselect"></div>`);
  const control = h(`<div class="labelselect-control"></div>`);
  const input = h(`<input class="ls-input" type="text" autocomplete="off" spellcheck="false" />`);
  input.placeholder = placeholder;
  const menu = h(`<div class="labelselect-menu" hidden></div>`);
  control.append(input);
  root.append(control, menu);
  container.innerHTML = "";
  container.append(root);

  const labelById = (id) => items.find((l) => l.id === id);
  const reportError = (e) => { try { onError?.(e); } catch { /* onError 자체 오류 무시 */ } };

  // ---- 선택 칩 렌더: 컨트롤 안, input 앞쪽에 선택된 라벨을 칩으로 보인다. ----------
  function renderChips() {
    // input 은 유지하고 그 앞의 칩들만 다시 그린다.
    control.querySelectorAll(".ls-chip").forEach((n) => n.remove());
    const frag = document.createDocumentFragment();
    for (const id of selectedIds) {
      const l = labelById(id);
      if (!l) continue;
      const chip = h(`<span class="ls-chip"><span class="ls-chip-name"></span></span>`);
      chip.style.setProperty("--label-color", l.color || "#8a8f98");
      chip.querySelector(".ls-chip-name").textContent = l.name;
      if (!isDisabled) {
        const x = h(`<button class="ls-x" type="button" aria-label="${escapeHtml(t("label.remove"))}">×</button>`);
        x.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        x.addEventListener("click", (e) => { e.stopPropagation(); toggle(id); });
        chip.append(x);
      }
      frag.append(chip);
    }
    control.insertBefore(frag, input);
    control.classList.toggle("has-selection", selectedIds.size > 0);
  }

  // ---- 드롭다운 렌더: 필터에 맞는 라벨 + (해당 시) 새 라벨 추가 행 ------------------
  function renderMenu() {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const matched = items.filter((l) => !ql || l.name.toLowerCase().includes(ql));
    menuRows = [];
    menu.innerHTML = "";

    for (const l of matched) {
      menuRows.push({ type: "label", id: l.id });
      const on = selectedIds.has(l.id);
      const row = h(`<button class="ls-opt" type="button"></button>`);
      row.classList.toggle("on", on);
      row.style.setProperty("--label-color", l.color || "#8a8f98");
      row.innerHTML = `<span class="ls-dot"></span><span class="ls-opt-name">${escapeHtml(l.name)}</span><span class="ls-check">${on ? "✓" : ""}</span>`;
      row.addEventListener("mousedown", (e) => e.preventDefault()); // 입력 포커스 유지
      row.addEventListener("click", () => toggle(l.id));
      menu.append(row);
    }

    // 정확히 같은 이름이 없고, 생성 기능이 있으면 "추가" 행을 노출한다.
    const exact = q && items.some((l) => l.name.toLowerCase() === ql);
    if (q && onCreate && !exact) {
      menuRows.push({ type: "create", name: q });
      const row = h(`<button class="ls-opt ls-create" type="button"></button>`);
      row.innerHTML = `<span class="ls-plus">＋</span><span class="ls-opt-name">${escapeHtml(t("label.addNew", { name: q }))}</span>`;
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => createNew(q));
      menu.append(row);
    }

    if (!menuRows.length) {
      menu.append(h(`<div class="ls-empty">${escapeHtml(q ? t("label.noMatch") : t("issue.noLabels"))}</div>`));
    }

    if (activeIndex >= menuRows.length) activeIndex = menuRows.length - 1;
    paintActive();
  }

  function paintActive() {
    const opts = [...menu.querySelectorAll(".ls-opt")];
    opts.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
    if (activeIndex >= 0 && opts[activeIndex]) opts[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function openMenu() {
    if (isDisabled || open) return;
    open = true;
    menu.hidden = false;
    root.classList.add("open");
    activeIndex = menuRows.length ? 0 : -1;
    renderMenu();
  }
  function closeMenu() {
    if (!open) return;
    open = false;
    menu.hidden = true;
    root.classList.remove("open");
    activeIndex = -1;
  }

  // ---- 선택 토글: onChange 로 반영하고, 실패하면 이전 상태로 되돌린다. --------------
  async function toggle(id) {
    if (isDisabled || busy) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    await applyChange(next);
    renderMenu();
  }

  async function applyChange(nextSet) {
    const prev = selectedIds;
    selectedIds = nextSet;
    renderChips();
    if (!onChange) return;
    busy = true;
    root.classList.add("busy");
    try {
      await onChange([...nextSet]);
    } catch (e) {
      selectedIds = prev; // 롤백
      renderChips();
      reportError(e);
    } finally {
      busy = false;
      root.classList.remove("busy");
    }
  }

  // ---- 새 라벨 생성 → 목록에 추가하고 선택까지 반영 -------------------------------
  async function createNew(name) {
    const nm = name.trim();
    if (!nm || isDisabled || busy || !onCreate) return;
    busy = true;
    root.classList.add("busy");
    try {
      const label = await onCreate(nm);
      if (label?.id) {
        if (!items.some((l) => l.id === label.id)) items.push(label);
        items.sort((a, b) => a.name.localeCompare(b.name));
        selectedIds.add(label.id);
        renderChips();
        input.value = "";
        // 생성 라벨을 서버 이슈에도 반영(onChange). 실패 시 선택만 롤백.
        if (onChange) {
          try { await onChange([...selectedIds]); }
          catch (e) { selectedIds.delete(label.id); renderChips(); reportError(e); }
        }
      }
    } catch (e) {
      reportError(e);
    } finally {
      busy = false;
      root.classList.remove("busy");
      renderMenu();
    }
  }

  // ---- 이벤트 배선 ---------------------------------------------------------------
  control.addEventListener("click", () => { if (!isDisabled) { input.focus(); openMenu(); } });
  input.addEventListener("focus", openMenu);
  input.addEventListener("input", () => { activeIndex = 0; renderMenu(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openMenu(); activeIndex = Math.min(activeIndex + 1, menuRows.length - 1); paintActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); paintActive(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const row = menuRows[activeIndex];
      if (row?.type === "label") toggle(row.id);
      else if (row?.type === "create") createNew(row.name);
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); closeMenu(); }
    } else if (e.key === "Backspace" && !input.value) {
      // 빈 입력에서 백스페이스 → 마지막 선택 제거
      const last = [...selectedIds].pop();
      if (last != null) toggle(last);
    }
  });
  // 바깥 클릭 시 닫기
  const onDocClick = (e) => { if (!root.contains(e.target)) closeMenu(); };
  document.addEventListener("mousedown", onDocClick);

  function applyDisabled() {
    root.classList.toggle("disabled", isDisabled);
    input.disabled = isDisabled;
    input.placeholder = isDisabled ? "" : placeholder;
    if (isDisabled) closeMenu();
  }

  // 초기 렌더
  renderChips();
  applyDisabled();

  return {
    setLabels(next) { items = [...(next || [])]; renderChips(); if (open) renderMenu(); },
    setSelected(ids) { selectedIds = new Set(ids || []); renderChips(); if (open) renderMenu(); },
    getSelected() { return [...selectedIds]; },
    setDisabled(v) { isDisabled = !!v; applyDisabled(); renderChips(); },
    focus() { input.focus(); },
    destroy() { document.removeEventListener("mousedown", onDocClick); container.innerHTML = ""; },
  };
}
