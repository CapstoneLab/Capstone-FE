# v0.11.0 업데이트 내역

> **기준**: `8e0b65b` (v0.10.9) → 현재
> **요약**: 원격 v0.10.9를 pull한 뒤, 그 버전에 빠져 있던 사용자 요청 수정 3건을 재적용

---

## v0.10.9 대비 변경점 (이게 0.11.0과 0.10.9의 차이)

### 1. 새 파이프라인 — 환경(environment) 설정 제거
- [NewPipelinePage.tsx](../src/pages/NewPipelinePage.tsx)에서 **environment 드롭다운 UI + 안내문 제거**
- 관련 상태/상수(`environmentOptions`, `STRICT_ENVIRONMENTS`)·`PipelineEnvironment`/`Layers` import·`startPipeline` 페이로드의 `environment`·navigate state의 `environment` 모두 제거
- "적용 단계"에는 이제 **실행 브랜치 선택만** 남음 (v0.10.9에는 환경 드롭다운이 그대로 있었음)

### 2. Select 드롭다운 라이트모드 검은박스 수정
- [select.tsx](../src/components/ui/select.tsx)를 **테마 토큰 기반**으로 전환:
  - 트리거/패널 배경 → `bg-[var(--app-bg-elevated)]`, 글씨 → `text-[var(--app-text-primary)]`, 테두리 → `border-[var(--app-border)]`
  - 포커스/선택 항목 하이라이트 → `focus:bg-[var(--app-surface-strong)]`
- 기존 v0.10.9는 `focus:bg-[#2A2A2A]`(focus 변형)이라 CSS 오버라이드가 안 걸려, 라이트모드에서 **선택된 항목이 검은 박스**로 보이던 버그가 있었음 → 해결

### 3. 빨강/주황/노랑 배너 라이트모드 가독성
- [index.css](../src/index.css) 라이트모드 한정 오버라이드 추가:
  - 빨강 텍스트(`#FCA5A5`·`#FECACA`) → `#b91c1c`, 노랑(`#FCD34D`·`#FDE68A`) → `#92400e`, 주황(`#FDBA74`·`#FED7AA`) → `#9a3412`
  - 빨강 배너 배경(`bg-[#450A0A]/40`·`bg-[#7F1D1D]/30`) → 연빨강 `#fee2e2`
- security_gate 실패 배너 등 빨강 배너 글씨가 라이트모드에서 묻히던 문제 → **연빨강 배경 + 진빨강 글씨**로 또렷하게
- 초록은 솔리드 초록 박스(AI 제안)에 쓰여 제외

### 4. 상단 "실행 시간" 하드코딩 → 실시간 경과
- [MainLayout.tsx](../src/components/layout/MainLayout.tsx) 스크롤 헤더 칩 `실행 시간 3m 40s`(하드코딩) → `pipelineElapsed` prop. [PipelineProcessPage.tsx](../src/pages/PipelineProcessPage.tsx)가 `formatDuration(elapsedSec)`로 실제 경과 시간 전달 (v0.10.9엔 "3m 40s" 하드코딩 잔존)

### 5. 진행도 바 pending 색 (검정 → 회색)
- [PipelineProcessPage.tsx](../src/pages/PipelineProcessPage.tsx) 단계 진행 바의 대기(pending) 채움색이 인라인 `#404040`(라이트서 검정) → **투명 처리**해 트랙(테마별 회색)이 보이도록

### 6. 단계별 로그 박스 높이 고정 + 내부 스크롤
- 아코디언 단계 로그 컨테이너에 `max-h-72 overflow-y-auto` → 페이지를 안 내려도 박스 내부 스크롤로 로그 확인

### 7. 결과 다운로드 버튼 가시성
- [MainLayout.tsx](../src/components/layout/MainLayout.tsx)·[PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx)의 "결과 다운로드" 버튼을 다크 그린 틴트+연한 글씨 → **솔리드 민트(#34D399)+어두운 글씨**로 (라이트모드에서 안 보이던 문제 해결)

### 8. 버전
`v0.10.9` → `v0.11.0` ([package.json](../package.json), [package-lock.json](../package-lock.json))

---

## 참고
- v0.10.9가 이미 자체적으로 가진 것(파이프라인 시작 `/api/pipelines`, 등급별 차트 안/밖 분할, 검사 항목 매칭 robust화, 네임드그레이 테두리 라이트 오버라이드 등)은 그대로 유지됨.
- pull 직전 워킹트리에 있던 세션 변경은 `git stash`(stash@{0})에 보관됨. 위 3건은 그 중 v0.10.9에 빠진 것을 골라 v0.10.9 위에 깔끔히 재적용한 것.
