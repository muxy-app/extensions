// 확장 설정 저장/로드 헬퍼.
//
// muxy 의 매니페스트 `settings` 는 소켓으로만 읽을 수 있어(웹뷰 JS 브리지 없음)
// 대신 muxy.storage(웹뷰에서 사용 가능한 per-extension key/value 저장소)에 보관한다.
// 설정 입력 UI 는 설정 모달(modals/settings.html)에서 제공한다.

export const CONFIG_DEFAULTS = {
  // UI 언어는 한국어 고정(다국어 기능 제거). 하위 호환용으로 값만 유지한다.
  language: "ko",
  // 실효 Linear Personal API Key. 아래 api_tokens 목록이 있으면 활성 키에서 자동 유도된다.
  // (하위 호환: 목록을 안 쓰면 이 값이 그대로 단일 키로 쓰인다.)
  api_token: "",
  // 등록된 Linear API 키 목록. 각 항목: { id, label(설명), token }
  api_tokens: [],
  // 현재 사용할 키의 id. 비어 있거나 목록에 없으면 목록 첫 항목을 쓴다.
  api_token_active: "",
  // 필터/이슈 생성에 쓰는 기본 팀 키(예: "KYL"). 비우면 모든 팀.
  team_key: "",

  // 이슈 상세를 여는 방식(설정 모달에서 선택).
  //  - "tab":   익스텐션 웹뷰 탭(풀 페이지). 기본값.
  //  - "modal": 가운데 웹뷰 모달.
  issue_open_mode: "tab",

  // 목록 각 행에 무엇을 표시할지(설정에서 토글).
  list_show_state: true, // 상태 배지
  list_show_priority: false, // 우선순위
  list_show_labels: true, // 라벨 칩
  list_show_project: true, // 프로젝트 칩(여러 프로젝트가 섞일 때만)
  list_show_milestone: true, // 마일스톤 칩
  list_show_assignee: true, // 담당자 아바타
  list_show_parent: true, // 부모 이슈 브레드크럼
  show_branch_bar: true, // 검색창 아래 현재 브랜치 표시줄

  // 목록 그룹/정렬(리니어의 Display 메뉴처럼 패널에서 바꾼다).
  // list_group_by: status | assignee | priority | project | milestone | none
  list_group_by: "status",
  // list_sort_by: updated | created | priority | title
  list_sort_by: "updated",
  // 목록에서 숨길 상태 이름 목록(예: ["Done", "Canceled"]). 상태 필터 체크리스트에서
  // 체크 해제한 상태가 여기에 저장되어 재시작 후에도 유지된다. 빈 배열 = 모두 표시.
  list_hidden_states: [],
};

// 등록된 키 목록에서 활성 항목을 고른다(활성 id가 없거나 목록에 없으면 첫 항목).
export function activeTokenEntry(config) {
  const list = Array.isArray(config?.api_tokens) ? config.api_tokens : [];
  if (!list.length) return null;
  return list.find((t) => t.id === config.api_token_active) || list[0];
}

// 전체 설정을 읽어 기본값과 병합해서 반환한다.
export async function loadConfig() {
  const cfg = { ...CONFIG_DEFAULTS };
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    const stored = await window.muxy.storage.get(key);
    if (stored !== null && stored !== undefined) cfg[key] = stored;
  }
  // 하위 호환: 목록이 비었는데 단일 키만 있으면 한 항목으로 이관(메모리상).
  if ((!Array.isArray(cfg.api_tokens) || !cfg.api_tokens.length) && cfg.api_token) {
    cfg.api_tokens = [{ id: "legacy", label: "기본", token: cfg.api_token }];
    if (!cfg.api_token_active) cfg.api_token_active = "legacy";
  }
  // 키 목록을 쓰는 경우, 활성 키의 토큰을 api_token 으로 유도해 기존 소비 코드와 호환시킨다.
  const entry = activeTokenEntry(cfg);
  if (entry) cfg.api_token = entry.token || "";
  return cfg;
}

// 일부 키만 저장한다.
export async function saveConfig(partial) {
  for (const [key, value] of Object.entries(partial)) {
    await window.muxy.storage.set(key, value);
  }
}

// 실효 API 토큰. 우선순위:
//  1) 프로젝트 전용 raw 키(.linear.json.apiToken) — 직접 입력한 값
//  2) 프로젝트가 고른 등록 키(.linear.json.apiTokenId) — 전역 목록에서 id 로 참조
//  3) 전역 활성 키(config.api_token)
export function effectiveToken(config, projectCfg) {
  const pt = projectCfg?.apiToken;
  if (pt && String(pt).trim()) return String(pt).trim();
  const pickId = projectCfg?.apiTokenId;
  if (pickId) {
    const list = Array.isArray(config?.api_tokens) ? config.api_tokens : [];
    const hit = list.find((t) => t.id === pickId);
    if (hit?.token) return hit.token;
  }
  return config?.api_token || "";
}

// 프로젝트 스코프의 실효 설정을 만든다. 남은 프로젝트 오버라이드는 API 토큰뿐이라
// effectiveToken 규칙으로 api_token 만 채운 flat 설정을 반환한다.
export function applyProjectSettings(config, projectCfg) {
  return { ...config, api_token: effectiveToken(config, projectCfg) };
}
