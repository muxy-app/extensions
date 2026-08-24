// 확장 설정 저장/로드 헬퍼.
//
// muxy 의 매니페스트 `settings` 는 소켓으로만 읽을 수 있어(웹뷰 JS 브리지 없음)
// 대신 muxy.storage(웹뷰에서 사용 가능한 per-extension key/value 저장소)에 보관한다.
// 설정 입력 UI 는 설정 모달(modals/settings.html)에서 제공한다.

export const CONFIG_DEFAULTS = {
  // UI 언어(en / ko / ja / zh). 기본은 영어.
  language: "en",
  // 실효 Linear Personal API Key. 아래 api_tokens 목록이 있으면 활성 키에서 자동 유도된다.
  // (하위 호환: 목록을 안 쓰면 이 값이 그대로 단일 키로 쓰인다.)
  api_token: "",
  // 등록된 Linear API 키 목록. 각 항목: { id, label(설명), token }
  api_tokens: [],
  // 현재 사용할 키의 id. 비어 있거나 목록에 없으면 목록 첫 항목을 쓴다.
  api_token_active: "",
  // 필터/이슈 생성에 쓰는 기본 팀 키(예: "KYL"). 비우면 모든 팀.
  team_key: "",
  // 브랜치를 분기할 기본 베이스 브랜치.
  default_base_branch: "develop",
  // 브랜치 이름 규칙(빈 값 = Linear 추천 브랜치명 사용).
  // 사용 가능한 플레이스홀더: {identifier} {title} {branch}
  branch_name_template: "",
  // worktree 폴더 이름 규칙(빈 값 = "<저장소폴더>-<브랜치슬러그>").
  // 사용 가능한 플레이스홀더: {identifier} {title} {branch} {repo}
  worktree_name_template: "",
  // 작업 시작 시 기본으로 worktree 를 만들지 여부.
  use_worktree: true,
  // 이슈 클릭 시 터미널에서 실행할 에이전트 CLI.
  agent_command: "claude",
  // 작업 시작 시 에이전트에 전달할 초기 프롬프트 템플릿.
  // 사용 가능한 플레이스홀더: {identifier} {title} {branch} {url} {description}
  start_prompt_template: "/리니어 {identifier}",
  // 작업 시작과 함께 이슈 상태를 In Progress(started)로 바꿀지 여부.
  set_in_progress: true,
  // 작업 종료 시 에이전트에 전달할 프롬프트 템플릿.
  // 기본값은 사용자가 Claude에 만들어 둔 "/작업완료" 스킬(커밋→PR→develop 머지→
  // Linear 이슈 Done→브랜치 정리)을 그대로 위임한다. 필요하면 수정 가능.
  finish_prompt_template: "/작업완료",

  // 이슈 상세/새 이슈 생성을 여는 방식(설정 모달에서 선택) — KNK-109.
  //  - "tab":   익스텐션 웹뷰 탭(풀 페이지). 기본값.
  //  - "modal": 가운데 웹뷰 모달.
  //  - "split": 내장 브라우저를 오른쪽 split 으로 열어 실제 Linear 페이지를 표시.
  //             (익스텐션 웹뷰는 split API 가 없어, 상세는 issue.url 을 브라우저 split 으로 연다.
  //              새 이슈 생성은 아직 URL 이 없어 split 대신 탭으로 폴백한다.)
  issue_open_mode: "tab",

  // 목록 각 행에 무엇을 표시할지(설정에서 토글).
  list_show_state: true, // 상태 배지
  list_show_priority: false, // 우선순위
  list_show_labels: true, // 라벨 칩
  list_show_project: true, // 프로젝트 칩(여러 프로젝트가 섞일 때만)
  list_show_milestone: true, // 마일스톤 칩
  list_show_assignee: true, // 담당자 아바타
  list_show_parent: true, // 부모 이슈 브레드크럼
  list_show_actions: true, // 행에서 상태별 액션 버튼 표시
  show_branch_bar: true, // 검색창 아래 현재 브랜치 표시줄

  // 목록 그룹/정렬(리니어의 Display 메뉴처럼 패널에서 바꾼다).
  // list_group_by: status | assignee | priority | project | milestone | none
  list_group_by: "status",
  // list_sort_by: updated | created | priority | title
  list_sort_by: "updated",
  // 목록에서 숨길 상태 이름 목록(예: ["Done", "Canceled"]). 상태 필터 체크리스트에서
  // 체크 해제한 상태가 여기에 저장되어 재시작 후에도 유지된다. 빈 배열 = 모두 표시.
  list_hidden_states: [],

  // 상태별 액션(워크플로우). 각 액션은:
  //  - label: 버튼 이름
  //  - appliesTo: 이 액션을 보여줄 상태 이름들(빈 배열 = 모든 상태)
  //  - run: 실행 방식 — "worktree"(새 worktree) | "branch"(새 브랜치) | "current"(현재 위치)
  //  - base: 분기 베이스 브랜치(빈 값 = 기본 베이스)
  //  - prompt: 터미널에서 실행할 에이전트 프롬프트(플레이스홀더 사용 가능)
  //  - toState: 실행 후 바꿀 상태 — 상태 이름 또는 타입(started/unstarted/backlog/completed/canceled), 빈 값 = 변경 안 함
  //  - confirm: 실행 전 확인 창 표시 여부
  //  - agent: 이 액션 전용 에이전트 설정 { command, model, effort }(빈/생략 = 전역 상속) — KNK-97
  actions: [
    {
      id: "start",
      label: "작업 시작",
      icon: "🚀",
      appliesTo: [],
      run: "worktree",
      base: "",
      prompt: "/리니어 {identifier}",
      toState: "started",
      confirm: false,
    },
    {
      id: "finish",
      label: "작업 종료",
      icon: "🏁",
      appliesTo: [],
      run: "current",
      base: "",
      prompt: "/작업완료",
      toState: "",
      confirm: true,
    },
  ],
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

// 프로젝트 스코프의 "핵심 실행값" 오버라이드를 전역 설정 위에 병합한 flat 설정을 만든다.
// projectCfg.settings 의 비지 않은 값(default_base_branch / agent_command)만 덮어쓰고,
// api_token 은 effectiveToken 규칙으로 채운다. 액션 병합은 호출부(mergeActions)에서 따로 처리한다.
export function applyProjectSettings(config, projectCfg) {
  const eff = { ...config, api_token: effectiveToken(config, projectCfg) };
  const s = projectCfg?.settings || {};
  for (const k of ["default_base_branch", "agent_command", "branch_name_template", "worktree_name_template"]) {
    const v = s[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") eff[k] = v;
  }
  return eff;
}

// 프롬프트 템플릿에 이슈 값을 채워 렌더링한다.
export function renderPrompt(template, issue) {
  return String(template ?? "")
    .replaceAll("{identifier}", issue.identifier ?? "")
    .replaceAll("{title}", issue.title ?? "")
    .replaceAll("{branch}", issue.branchName ?? "")
    .replaceAll("{url}", issue.url ?? "")
    .replaceAll("{description}", issue.description ?? "");
}

// 이름 규칙(브랜치명 / worktree 폴더명) 템플릿에 값을 채워 렌더링한다.
// 프롬프트와 달리 {repo}(저장소 폴더명)도 지원한다. 브랜치/폴더로 안전화하는 건 호출부(git.js) 담당.
export function renderNameTemplate(template, vars = {}) {
  return String(template ?? "")
    .replaceAll("{identifier}", vars.identifier ?? "")
    .replaceAll("{title}", vars.title ?? "")
    .replaceAll("{branch}", vars.branch ?? "")
    .replaceAll("{repo}", vars.repo ?? "");
}
