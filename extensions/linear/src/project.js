// 프로젝트별 설정: git 저장소 루트의 .linear.json 에 어떤 Linear 팀/프로젝트로
// 필터할지 저장한다. muxy.files 는 활성 워크트리 루트 기준으로 동작한다.
//
// 단, .linear.json 은 "워크트리 루트" 파일이라 새 워크트리를 따면 그 폴더엔 없어서
// "연결 안 됨"처럼 리스트가 사라진다. 사용자 기대는 "같은 프로젝트면 워크트리가 달라도
// 같은 링크를 따라가는" 것이라, 링크를 muxy.storage 에 "프로젝트 id" 기준으로도 캐시한다.
// (storage 는 확장 단위 전역 저장소라 워크트리와 무관하게 공유된다.)
// → 파일이 없으면 이 프로젝트 캐시로 폴백해, 같은 프로젝트의 다른 워크트리도 자동으로 이어받는다.

const FILE = ".linear.json";
const GITIGNORE = ".gitignore";
const LINK_STORE_KEY = "project_links"; // { [projectId]: cfg }

// 현재 활성 muxy 프로젝트 id(워크트리가 달라도 같은 프로젝트면 동일). 실패 시 null.
async function activeProjectId() {
  try {
    const list = await window.muxy.projects.list();
    const active = (Array.isArray(list) ? list : []).find((p) => p && p.isActive);
    return active?.id || null;
  } catch {
    return null; // projects:read 미허용/구버전 등 → 캐시 없이 파일만 사용.
  }
}

// 프로젝트 링크 캐시 읽기(없으면 null).
async function readLinkCache(projectId) {
  if (!projectId) return null;
  try {
    const map = (await window.muxy.storage.get(LINK_STORE_KEY)) || {};
    const cfg = map[projectId];
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch {
    return null;
  }
}

// 프로젝트 링크 캐시를 저장/삭제한다(값이 실제로 바뀔 때만 write — 폴링마다 쓰지 않게).
async function cacheLink(projectId, cfg) {
  if (!projectId) return;
  try {
    const map = (await window.muxy.storage.get(LINK_STORE_KEY)) || {};
    const prev = map[projectId];
    if (JSON.stringify(prev ?? null) === JSON.stringify(cfg ?? null)) return; // 변화 없으면 skip
    if (cfg) map[projectId] = cfg;
    else delete map[projectId];
    await window.muxy.storage.set(LINK_STORE_KEY, map);
  } catch {
    /* 캐시 실패는 링크 동작을 막지 않는다 */
  }
}

// .linear.json 을 프로젝트 .gitignore 에 자동 등록한다(중복 방지).
// Linear 설정에는 API 키 참조가 들어갈 수 있어, 사용자가 실수로 커밋하지 않도록 한다.
async function ensureGitignored() {
  const muxy = window.muxy;
  let content = "";
  try {
    const f = await muxy.files.read(GITIGNORE);
    content = typeof f?.content === "string" ? f.content : "";
  } catch {
    // .gitignore 없음 → 새로 만든다.
    content = "";
  }
  // 이미 정확히 같은 항목이 있으면 아무것도 하지 않는다.
  const already = content.split(/\r?\n/).some((line) => line.trim() === FILE);
  if (already) return;
  // 끝 개행을 보장한 뒤 항목을 덧붙인다.
  const needsNewline = content.length > 0 && !content.endsWith("\n");
  const next = content + (needsNewline ? "\n" : "") + FILE + "\n";
  try {
    await muxy.files.write(GITIGNORE, next);
  } catch {
    // .gitignore 갱신 실패는 설정 저장을 되돌리지 않는다.
  }
}

// 프로젝트 링크를 읽는다. 없으면 null.
// 반환 형태: { teamKey?, projectId?, projectName? }
// 1) 현재 워크트리의 .linear.json 우선(있으면 프로젝트 캐시도 갱신 → 다른 워크트리가 이어받게).
// 2) 파일이 없으면(새 워크트리 등) 이 "프로젝트" 캐시로 폴백 → 같은 프로젝트면 같은 링크.
export async function readProjectConfig() {
  const projectId = await activeProjectId();

  let fileCfg = null;
  try {
    const file = await window.muxy.files.read(FILE);
    const parsed = JSON.parse(file.content);
    fileCfg = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // 파일 없음 / 권한 / 파싱 실패 → 파일 링크는 없음
    fileCfg = null;
  }

  if (fileCfg) {
    await cacheLink(projectId, fileCfg); // 파일 링크를 프로젝트 캐시에 반영(변경 시에만 write)
    return fileCfg;
  }
  // 파일이 없으면 프로젝트 단위 캐시로 폴백(같은 프로젝트의 다른 워크트리에서 링크한 값).
  return await readLinkCache(projectId);
}

// 프로젝트 링크 저장(최초 쓰기 시 files:write 동의 팝업).
// 파일과 함께 "프로젝트 캐시"에도 저장 → 이 프로젝트의 다른 워크트리들이 자동으로 따라온다.
export async function writeProjectConfig(cfg) {
  await window.muxy.files.write(FILE, JSON.stringify(cfg, null, 2) + "\n");
  // 설정 파일이 생기면 .gitignore 에도 자동 등록한다.
  await ensureGitignored();
  await cacheLink(await activeProjectId(), cfg);
}

// 연결 해제(.linear.json 을 휴지통으로 + 프로젝트 캐시도 제거해 다른 워크트리에서 되살아나지 않게).
export async function clearProjectConfig() {
  const projectId = await activeProjectId();
  try {
    await window.muxy.files.delete([FILE]);
  } catch {
    /* 이미 없으면 무시 */
  }
  await cacheLink(projectId, null);
}
