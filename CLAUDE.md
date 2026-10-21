# WorkLens 개발 규칙

개인용 업무정리 Electron 앱(Jira 대시보드 + Claude 세션 뷰어). 이 파일은 다른 컴퓨터에서 이 레포를 열었을 때도 동일한 규칙을 따르기 위한 것.

## 커밋 전 필수 체크

커밋/푸시 직전마다 변경된 코드에 대해 다음 두 가지를 돌리고, 나온 수정 사항을 적용한 뒤 커밋한다.

- `/simplify` — 재사용/단순화/효율/적절한 추상화 레벨 점검
- `/security-review` — 특히 Electron IPC 경계(렌더러 → 메인 프로세스), 쉘 명령 구성, 외부 API 호출 부분은 반드시 확인

한 줄 수정할 때마다 돌릴 필요는 없고, 커밋 단위로 한 번씩이면 충분하다.

## 커밋 메시지

Conventional Commits 형식 사용 (`feat:`, `fix:`, `style:`, `refactor:` 등). 회사 레포(`fix/ITS-xxxx` 브랜치명 그대로 쓰는 방식)와는 다른 규칙이니 섞지 말 것.

## Git 계정 분리 (중요, hard rule)

이 레포는 **개인 GitHub 계정(`danii0110`)으로만** 커밋/푸시한다. 회사 계정이 절대 섞이면 안 된다.

- 로컬 git author는 이 레포 한정으로 `danii0110` / `daniich0110@gmail.com`으로 설정돼 있어야 함 (전역 설정은 건드리지 않음)
- 쉘 프로필에 `GITHUB_TOKEN`이 export돼 있으면 `gh` CLI가 무조건 그 계정(회사 계정)으로 동작해버리므로, `gh` 명령은 항상 아래처럼 그 변수를 빼고 실행:
  ```
  env -u GITHUB_TOKEN gh <command>
  ```
- `git push`는 `gh auth git-credential`에 의존하지 말 것 — 그건 gh의 "활성 계정"이라는 전역·가변 상태를 따라가는데, 그 값은 사용자가 다른 이유로 언제든 바꿀 수 있어서(예: 회사 작업용으로 daincheon으로 되돌리기) 이 레포 push가 예고 없이 깨질 수 있다(실제로 2026-10-22 한 번 발생). 대신 danii0110 계정 토큰을 "활성 계정"과 무관하게 명시적으로 뽑아서 URL에 꽂아 push:
  ```
  TOKEN=$(env -u GITHUB_TOKEN gh auth token -u danii0110)
  git push "https://danii0110:${TOKEN}@github.com/danii0110/worklens.git" main
  ```

## 비밀정보/개인정보

- 회사 이메일 도메인, 회사 Jira 사이트 주소, API 토큰 등은 소스코드에 절대 하드코딩하지 않는다. `.env`(gitignore 대상) + `.env.example`(빈 값) 패턴만 사용.
- `.husky/pre-commit`에 이런 패턴을 자동으로 잡아내는 스캔 훅이 있지만, 훅은 2차 방어선일 뿐이니 커밋 전에 직접 diff를 한 번 보는 습관을 유지할 것.
- Jira API 토큰처럼 사용자가 직접 입력해야 하는 민감값은 앱의 설정 화면을 통해서만 받고, 채팅/코드/커밋 메시지 어디에도 적지 않는다.

## 아키텍처 메모

- Electron 메인 프로세스가 Jira API 호출, Claude 세션 파일 읽기, 터미널(pty) 스폰을 전담 — 별도 백엔드 서버 없음
- 렌더러(React)는 `window.api`를 통해서만 메인 프로세스와 통신 (`src/preload/index.ts`가 노출하는 범위가 곧 렌더러의 권한 경계). 새 IPC 채널을 추가할 때는 렌더러가 넘기는 값을 메인 프로세스가 그대로 신뢰하지 말고, 꼭 필요한 최소 범위(예: sessionId 하나)만 받아서 나머지(cwd, 실행할 명령 등)는 메인 프로세스가 직접 조회/구성할 것
- 쉘 명령을 구성할 때 변수를 문자열에 직접 이어붙이지 않는다. `sh -c 'cmd "$1"' _ "$value"` 처럼 위치 인자로 넘겨서 인젝션 가능성을 원천 차단 (`src/main/terminal.ts` 참고)
