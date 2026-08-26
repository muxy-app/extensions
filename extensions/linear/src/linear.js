// Linear GraphQL API 클라이언트.
//
// muxy.http.fetch 는 네이티브에서 실행되어 CORS 제약이 없고, 매니페스트 권한도
// 필요 없다(호스트별 런타임 동의만 최초 1회). Personal API Key 는 Authorization
// 헤더 값으로 "그대로"(Bearer 접두어 없이) 넣는다.

const ENDPOINT = "https://api.linear.app/graphql";

// code 를 가진 에러 생성(network | auth | api | parse).
function codedError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// GraphQL 요청을 보내고 data 를 반환한다. 오류는 throw(에러에 code 부여).
export async function gql(token, query, variables = {}) {
  if (!token) throw codedError("API Key가 설정되지 않았습니다. 설정에서 입력하세요.", "auth");

  let res;
  try {
    res = await window.muxy.http.fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    // fetch 자체 실패 = 네트워크/호스트 접근 문제
    throw codedError("네트워크 오류: Linear에 연결할 수 없습니다.", "network");
  }

  // 인증 실패(키 오류)
  if (res.status === 401 || res.status === 403) {
    throw codedError("인증 실패: API 키가 올바르지 않습니다.", "auth");
  }

  // 요청 한도 초과(rate limit). Retry-After(초) 가 있으면 함께 전달한다.
  if (res.status === 429) {
    const retryAfter = Number(res.headers?.["retry-after"] ?? res.headers?.["Retry-After"]);
    const e = codedError("요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.", "rate");
    if (Number.isFinite(retryAfter) && retryAfter > 0) e.retryAfter = retryAfter;
    throw e;
  }

  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw codedError(`응답 파싱 실패 (HTTP ${res.status})`, "api");
  }
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    if (/authenticat|unauthor|api key|invalid token|forbidden/i.test(msg)) {
      throw codedError("인증 실패: API 키가 올바르지 않습니다.", "auth");
    }
    // 복잡도/요청 한도는 200 응답의 errors 로도 올 수 있다.
    if (/rate limit|ratelimit|too many request/i.test(msg)) {
      throw codedError("요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.", "rate");
    }
    throw codedError(msg, "api");
  }
  return json.data;
}

// 이슈 목록에 공통으로 가져오는 필드.
const ISSUE_FIELDS = `
  id
  identifier
  title
  url
  branchName
  priority
  updatedAt
  createdAt
  state { id name type color }
  team { id key name }
  project { id name }
  projectMilestone { id name }
  labels(first: 10) { nodes { id name color } }
  assignee { id name displayName avatarUrl }
  parent { id identifier title }`;

// 활성 상태 타입 필터(완료/취소 제외).
function activeStateFilter() {
  return { type: { in: ["triage", "backlog", "unstarted", "started"] } };
}

// 나에게 assign 된 이슈 목록. teamKey/projectId 로 추가 필터.
export async function fetchMyIssues(token, { teamKey = "", projectId = "", activeOnly = true, first = 50 } = {}) {
  const filter = {};
  if (activeOnly) filter.state = activeStateFilter();
  if (teamKey) filter.team = { key: { eq: teamKey } };
  if (projectId) filter.project = { id: { eq: projectId } };

  const query = `
    query MyIssues($first: Int!, $filter: IssueFilter) {
      viewer {
        id
        name
        displayName
        assignedIssues(first: $first, filter: $filter, orderBy: updatedAt) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    }`;
  const data = await gql(token, query, { first, filter });
  return {
    viewer: data.viewer,
    issues: data.viewer?.assignedIssues?.nodes ?? [],
  };
}

// 특정 Linear 프로젝트의 이슈 전체(assign 여부 무관).
export async function fetchProjectIssues(token, { projectId, activeOnly = true, first = 50 }) {
  const filter = activeOnly ? { state: activeStateFilter() } : {};
  const query = `
    query ProjectIssues($id: String!, $first: Int!, $filter: IssueFilter) {
      project(id: $id) {
        id
        name
        issues(first: $first, filter: $filter, orderBy: updatedAt) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    }`;
  const data = await gql(token, query, { id: projectId, first, filter });
  return {
    project: data.project,
    issues: data.project?.issues?.nodes ?? [],
  };
}

// 접근 가능한 팀 목록(프로젝트 연결 모달용).
export async function fetchTeams(token) {
  const data = await gql(token, `query { teams(first: 100) { nodes { id key name } } }`);
  return data.teams?.nodes ?? [];
}

// 이름이 일치하는 프로젝트를 찾는다(대소문자 무시). 없으면 null.
// 폴더명 → Linear 프로젝트 자동 매칭에 사용.
export async function fetchProjectByName(token, name) {
  if (!name) return null;
  const query = `
    query ProjectByName($name: String!) {
      projects(filter: { name: { eqIgnoreCase: $name } }, first: 1) {
        nodes { id name teams(first: 1) { nodes { id key name } } }
      }
    }`;
  const data = await gql(token, query, { name });
  return data.projects?.nodes?.[0] ?? null;
}

// 새 프로젝트 생성. 팀에 소속된 프로젝트를 만든다(설정에서 연결할 프로젝트가 없을 때 사용).
// name 은 필수, teamId 로 소속 팀을 지정한다. 생성된 프로젝트 { id, name } 를 반환.
export async function createProject(token, { teamId, name }) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("프로젝트 이름을 입력하세요.");
  if (!teamId) throw new Error("팀을 먼저 선택하세요.");
  const query = `
    mutation ProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project { id name }
      }
    }`;
  const data = await gql(token, query, { input: { name: trimmed, teamIds: [teamId] } });
  if (!data.projectCreate?.success) throw new Error("프로젝트 생성에 실패했습니다.");
  return data.projectCreate.project;
}

// 특정 팀의 프로젝트 목록.
export async function fetchTeamProjects(token, teamId) {
  const query = `
    query TeamProjects($id: String!) {
      team(id: $id) {
        id
        projects(first: 100) { nodes { id name state } }
      }
    }`;
  const data = await gql(token, query, { id: teamId });
  return data.team?.projects?.nodes ?? [];
}

// 식별자(예: "KYL-534")로 단일 이슈 조회. Linear의 issue(id)는 UUID 또는 식별자를 받는다.
export async function fetchIssueById(token, id) {
  const query = `query IssueById($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`;
  const data = await gql(token, query, { id });
  return data.issue || null;
}

// 이슈 상세: 본문(description) + 코멘트 목록 + 하위 이슈(children).
export async function fetchIssueDetail(token, issueId) {
  const query = `
    query IssueDetail($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        url
        priority
        assignee { id name displayName }
        project { id name }
        labels { nodes { id name color } }
        comments(first: 100) {
          nodes {
            id
            body
            createdAt
            user { id name displayName avatarUrl }
          }
        }
        children(first: 100) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    }`;
  const data = await gql(token, query, { id: issueId });
  const issue = data.issue;
  const comments = (issue?.comments?.nodes ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  // 하위 이슈: 생성 순서(createdAt)대로 정렬.
  const children = (issue?.children?.nodes ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { issue, comments, children };
}

// 워크스페이스 전체의 워크플로우 상태(이름 기준 중복 제거, 타입순 정렬).
// 액션 편집기의 "표시할 상태 / 실행 후 상태" 목록에 사용.
export async function fetchAllStates(token) {
  const data = await gql(token, `query { workflowStates(first: 250) { nodes { id name type } } }`);
  const nodes = data.workflowStates?.nodes ?? [];
  const map = new Map();
  for (const s of nodes) if (!map.has(s.name)) map.set(s.name, { name: s.name, type: s.type });
  const order = { started: 0, unstarted: 1, triage: 2, backlog: 3, completed: 4, canceled: 5 };
  return [...map.values()].sort(
    (a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name),
  );
}

// 특정 팀의 워크플로우 상태 목록(상태 변경 드롭다운용).
export async function fetchTeamStates(token, teamId) {
  const query = `
    query TeamStates($id: String!) {
      team(id: $id) {
        id
        key
        states { nodes { id name type position color } }
      }
    }`;
  const data = await gql(token, query, { id: teamId });
  const nodes = data.team?.states?.nodes ?? [];
  // position 순으로 정렬
  return nodes.slice().sort((a, b) => a.position - b.position);
}

// 이슈 상태 변경.
export async function updateIssueState(token, issueId, stateId) {
  const query = `
    mutation SetState($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, stateId });
  return data.issueUpdate?.success === true;
}

// 이슈 본문(description) 수정. 권한이 없으면 API가 오류를 반환한다.
export async function updateIssueDescription(token, issueId, description) {
  const query = `
    mutation UpdateDesc($id: String!, $description: String!) {
      issueUpdate(id: $id, input: { description: $description }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, description });
  return data.issueUpdate?.success === true;
}

// 이슈 제목 변경.
export async function updateIssueTitle(token, issueId, title) {
  const query = `
    mutation UpdateTitle($id: String!, $title: String!) {
      issueUpdate(id: $id, input: { title: $title }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, title });
  return data.issueUpdate?.success === true;
}

// 이슈에 코멘트 작성.
export async function createComment(token, issueId, body) {
  const query = `
    mutation Comment($id: String!, $body: String!) {
      commentCreate(input: { issueId: $id, body: $body }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, body });
  return data.commentCreate?.success === true;
}

// 팀 키로 팀 id 조회(이슈 생성 시 필요). 키가 없으면 첫 팀 반환.
export async function resolveTeam(token, teamKey) {
  if (teamKey) {
    const query = `
      query TeamByKey($key: String!) {
        teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key name } }
      }`;
    const data = await gql(token, query, { key: teamKey });
    const team = data.teams?.nodes?.[0];
    if (!team) throw new Error(`팀 키 "${teamKey}" 를 찾을 수 없습니다.`);
    return team;
  }
  const data = await gql(token, `query { teams(first: 1) { nodes { id key name } } }`);
  const team = data.teams?.nodes?.[0];
  if (!team) throw new Error("팀을 찾을 수 없습니다.");
  return team;
}

// 새 이슈 생성. 담당자/중요도/프로젝트/마일스톤/라벨/상태를 선택적으로 함께 지정한다.
// 값이 비면(빈 문자열/undefined) input 에서 빼서 팀 기본값을 따르게 한다.
export async function createIssue(token, {
  teamId, title, description,
  assigneeId, priority, projectId, projectMilestoneId, labelIds, stateId, parentId,
}) {
  const input = { teamId, title, description: description || null };
  if (assigneeId) input.assigneeId = assigneeId;
  if (typeof priority === "number") input.priority = priority;
  if (projectId) input.projectId = projectId;
  if (projectMilestoneId) input.projectMilestoneId = projectMilestoneId;
  if (labelIds?.length) input.labelIds = labelIds;
  if (stateId) input.stateId = stateId;
  if (parentId) input.parentId = parentId; // 부모 지정 시 하위 이슈로 생성
  const query = `
    mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`;
  const data = await gql(token, query, { input });
  if (!data.issueCreate?.success) throw new Error("이슈 생성에 실패했습니다.");
  return data.issueCreate.issue;
}

// 특정 프로젝트의 마일스톤 목록(생성 모달의 마일스톤 드롭다운용).
export async function fetchProjectMilestones(token, projectId) {
  if (!projectId) return [];
  const query = `
    query ProjectMilestones($id: String!) {
      project(id: $id) {
        id
        projectMilestones(first: 100) { nodes { id name sortOrder } }
      }
    }`;
  const data = await gql(token, query, { id: projectId });
  const nodes = data.project?.projectMilestones?.nodes ?? [];
  return nodes.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

// 팀에서 사용 가능한 이슈 템플릿 목록(워크스페이스 공용 템플릿 포함).
// templateData 에는 제목/본문/중요도/라벨/담당자/프로젝트 등 기본값이 들어 있어
// 생성 폼을 채우는 데 쓴다. Linear 는 JSON 스칼라로 객체를 그대로 돌려준다.
export async function fetchTeamTemplates(token, teamId) {
  const query = `
    query TeamTemplates($id: String!) {
      team(id: $id) {
        id
        templates(first: 100) { nodes { id name type templateData } }
      }
    }`;
  const data = await gql(token, query, { id: teamId });
  const nodes = (data.team?.templates?.nodes ?? []).filter((t) => t.type === "issue" || !t.type);
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

// 팀 멤버 목록(담당자 변경 드롭다운용). 활성 사용자만, 이름순.
export async function fetchTeamMembers(token, teamId) {
  const query = `
    query TeamMembers($id: String!) {
      team(id: $id) {
        id
        members(first: 250) { nodes { id name displayName active } }
      }
    }`;
  const data = await gql(token, query, { id: teamId });
  const nodes = (data.team?.members?.nodes ?? []).filter((u) => u.active !== false);
  return nodes.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
}

// 팀 라벨 목록(라벨 지정 드롭다운/칩용). 그룹(부모) 라벨은 제외하고 이름순.
export async function fetchTeamLabels(token, teamId) {
  const query = `
    query TeamLabels($id: String!) {
      team(id: $id) {
        id
        labels(first: 250) { nodes { id name color isGroup } }
      }
    }`;
  const data = await gql(token, query, { id: teamId });
  const nodes = (data.team?.labels?.nodes ?? []).filter((l) => !l.isGroup);
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

// 이슈 담당자 변경. assigneeId = null 이면 담당자 해제.
export async function updateIssueAssignee(token, issueId, assigneeId) {
  const query = `
    mutation SetAssignee($id: String!, $assigneeId: String) {
      issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, assigneeId: assigneeId || null });
  return data.issueUpdate?.success === true;
}

// 이슈 중요도 변경. priority: 0 없음 / 1 긴급 / 2 높음 / 3 보통 / 4 낮음.
export async function updateIssuePriority(token, issueId, priority) {
  const query = `
    mutation SetPriority($id: String!, $priority: Int!) {
      issueUpdate(id: $id, input: { priority: $priority }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, priority });
  return data.issueUpdate?.success === true;
}

// 이슈 라벨 전체 교체(labelIds 배열로 지정한 집합으로 설정).
export async function updateIssueLabels(token, issueId, labelIds) {
  const query = `
    mutation SetLabels($id: String!, $labelIds: [String!]) {
      issueUpdate(id: $id, input: { labelIds: $labelIds }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, labelIds });
  return data.issueUpdate?.success === true;
}

// 이슈 프로젝트 변경. projectId = null 이면 프로젝트 해제.
export async function updateIssueProject(token, issueId, projectId) {
  const query = `
    mutation SetProject($id: String!, $projectId: String) {
      issueUpdate(id: $id, input: { projectId: $projectId }) { success }
    }`;
  const data = await gql(token, query, { id: issueId, projectId: projectId || null });
  return data.issueUpdate?.success === true;
}

// 이슈 삭제(휴지통으로 이동). Linear 는 약 30일간 복구 가능.
export async function deleteIssue(token, issueId) {
  const query = `
    mutation DeleteIssue($id: String!) {
      issueDelete(id: $id) { success }
    }`;
  const data = await gql(token, query, { id: issueId });
  return data.issueDelete?.success === true;
}
