# Capstone-FE (SecuPipeline) 작업 인수인계

## 프로젝트
- Electron + React 19 + Vite + TypeScript + Tailwind, 테스트는 vitest
- 실행 방법: `npm run dev` 한 번만 실행 (Vite :5173 + Electron)
  - 여러 번 띄우면 검은 화면이 나오니, 다시 실행할 때는 기존 프로세스를 먼저 종료
- 백엔드는 이 저장소에 없음. 개발 모드에서는 Vite 프록시 `/api-proxy`를 거쳐 백엔드 API를 호출
- 테마: `[data-theme]` 기준으로 src/index.css가 특정 hex 클래스를 다시 매핑함. 색은 이미 쓰이는 hex만 사용할 것 (#262626, #1E1E1E, #404040, #9CA3AF, #E5E7EB 등)
- 다국어: `useLanguage()`의 `t(key)`를 사용하고, 문구는 src/i18n/translations.ts의 ko/en 양쪽에 모두 추가
  - 한국어 설정일 때 영어가 섞이지 않게, 영어 설정일 때 한국어가 섞이지 않게 할 것
- 사용자에게는 항상 한국어로 답변

## 이번에 한 작업 (전부 아직 커밋 안 됨, main 브랜치)
1. **웹훅 403 문제**
   - 원인은 권한/토큰이었고, 재로그인으로 해결됨
   - 프론트는 에러 문구 표시만 개선: src/lib/api.ts의 `WebhookRequestError`, 403일 때 권한 안내 문구
2. **저장소별 웹훅 기능** (src/pages/DashboardPage.tsx)
   - 저장소마다 탐지 토글 (`GET`/`PUT /api/repos/{owner}/{repo}/webhook`)
   - 상태 배지 (연결됨 / 확인 불가)
   - 실행 이력에 트리거 필터 (전체 / 웹훅 / 수동)
   - 웹훅으로 새 실행이 생기면 토스트 표시
   - 실패한 실행에는 "OO 단계에서 실패" 배지, 보안 판정은 "보안 PASS"로 표시해 실행 실패와 구분
3. **파이프라인 실행 화면 전면 재작성** (GitHub Actions 스타일)
   - src/lib/pipelineExecution.ts: 순수 로직
     - 8단계 고정: clone, install, 경량 보안, test, 심화 보안, 보안 게이트, build, deploy
     - 상태 정규화, 로그 파싱·레벨 판별·필터, 소요 시간 포맷
   - src/hooks/usePipelineExecution.ts: REST 폴링 + WebSocket 실시간 로그
     - 재연결, 중복 제거, 취소 기능 포함
   - src/pages/PipelineProcessPage.tsx: 화면
     - 헤더, 진행률, 단계 카드, 로그(단계/레벨 필터, 복사), 완료 요약, 취소
     - 전부 i18n 적용
   - 가짜 시뮬레이션이나 추정 상태는 쓰지 않고, 백엔드가 준 실제 상태만 표시
   - 테스트: src/lib/pipelineExecution.test.ts, src/lib/api.history.test.ts
     - 전체 40개 통과 (`npx vitest run`)
4. **문서**
   - docs/pipeline-execution-backend-contract.md: 백엔드가 맞춰야 할 필드, 로그 형식, WS 이벤트, 취소 동작
     - 7절: GitHub 커밋 상태 보고
   - docs/webhook-backend-handoff.md: 웹훅 백엔드 요구사항
5. **테스트용 샘플 저장소**
   - jongha021229/sample_java5: 의도적인 취약점이 있어 보안 게이트에서 실패하는 게 정상
   - jongha021229/sample_java6: Spring Boot Todo API, 테스트 5개 통과. 커밋 142be54 push 완료

## 남은 일
- **GitHub 커밋 옆 ✓/✗ 표시는 백엔드 작업**
  - 백엔드가 `POST /repos/{owner}/{repo}/statuses/{sha}`를 `context: "secupipeline"`으로 호출해야 함
  - 상세 내용은 contract 문서 7절. 백엔드 팀에 요청 메시지를 전달한 상태
  - 프론트에는 GitHub 토큰이 없어서 프론트에서 구현할 수 없음
- 사용자가 대시보드에서 sample_java6 탐지 토글을 켜고 빈 커밋을 push해서 웹훅과 체크 표시를 확인해야 함
- 실행 화면을 한국어/영어 양쪽으로 눈으로 확인해야 함
- 커밋은 사용자가 요청할 때만 하고, main이므로 브랜치를 먼저 만들 것
  - **`CI-CD-보안정책-문서구조안.txt`는 절대 커밋하지 말 것**
- 저장된 로그인 토큰 파일(auth-session.json)은 읽지 말 것
