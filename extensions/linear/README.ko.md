# Linear for Muxy

[English](README.md) · **한국어** · [日本語](README.ja.md) · [中文](README.zh.md)

Muxy 사이드 패널에서 나에게 배정된 Linear 이슈를 훑어보고, 클릭 한 번으로 Claude
Code에 넘깁니다 — 브랜치(선택적으로 별도 git worktree)를 만들고, 이슈 컨텍스트가
담긴 프롬프트로 에이전트 CLI를 실행합니다.

## 기능

- **내 이슈 패널** — 나에게 배정된 이슈를 워크플로우 상태별로 묶어 보여주고,
  현재 git 브랜치와 일치하는 이슈를 맨 위에 고정합니다.
- **이슈 클릭 → 작업 시작** — 브랜치명(기본은 Linear의 `branchName` 추천값),
  베이스 브랜치, 별도 worktree 사용 여부, 초기 프롬프트를 고른 뒤 터미널 탭에서
  Claude Code를 실행합니다.
- **상태 변경 & 코멘트** — 이슈 모달에서 바로.
- **이슈 생성** — `Linear: New Issue` 팔레트 명령 또는 패널의 `+`로.

## 초기 설정

1. 빌드(`npm install && npm run build`) 후, Muxy에서 **Extensions → Load Unpacked**로
   빌드된 **`dist/`** 폴더를 선택합니다.
2. 패널을 열고(topbar 아이콘 또는 `Linear: Toggle Sidebar`) **설정**(⚙)을 엽니다.
   **🔑 API 키 관리**를 눌러 Linear **Personal API Key**를 (설명과 함께) 하나 이상
   등록한 뒤, 설정 화면의 **드롭다운**에서 사용할 키를 고릅니다
   (Linear → Settings → Security & access → Personal API keys). 전체 초기 세팅은
   [`docs/setup.md`](docs/setup.md)를 참고하세요.
3. 필요하면 기본 팀 키, 베이스 브랜치, worktree 위치, 에이전트 명령, 프롬프트
   템플릿을 지정합니다. **🌐 글로벌 / 📁 이 프로젝트** 토글로 API 키와 핵심 실행값을
   저장소별로 덮어쓸 수 있습니다(`.linear.json`에 저장).
4. 설정에서 UI **언어**(English / 한국어 / 日本語 / 中文)를 고릅니다.

## 권한

- `panels:write` — 패널과 웹뷰 모달 열기.
- `tabs:write` — 에이전트를 실행할 터미널 탭 열기(최초 실행 시 자동 명령에 대한
  런타임 동의도 요청).
- `git:read` / `git:write` — 브랜치 읽기 및 브랜치/worktree 생성.
- `projects:read` — 프로젝트/브랜치 전환에 반응해 현재 이슈 강조.
- `commands:exec` — 브라우저에서 이슈 URL 열기(`open <url>`).

Linear API 호출은 `muxy.http.fetch`로 `api.linear.app`에 나가며, 최초 사용 시 호스트
동의를 묻습니다. API 키는 `muxy.storage`에 로컬 저장됩니다.

## 프롬프트 템플릿 자리표시자

`{identifier}` `{title}` `{branch}` `{url}` `{description}` — 기본값은
`/리니어 {identifier}`로, 저장소의 Linear 작업 스킬을 구동합니다.

## 라이선스

[MIT](LICENSE) © 2026 Namgyeong Kim.

이 확장은 **비공식(unofficial)** 이며 Linear나 Muxy와 제휴·후원 관계가 없습니다.
"Linear"와 "Muxy"는 각 소유자의 상표입니다.
