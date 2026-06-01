# v0.9.0 업데이트 내역

> **기준**: `348425d` (v0.8.0) → 현재 워킹 트리
> **변경 파일**: 12개 (코드 수정 6개 · 신규 2개 · 설정/락 2개 · 문서 2개)
> **변경량**: 약 +1400 / -350 줄 (코드 기준)

---

## 1. 변경 파일 한눈에 보기

| 파일 | 구분 | 핵심 변경 |
|---|---|---|
| [src/contexts/ThemeContext.tsx](../src/contexts/ThemeContext.tsx) | 신규 | 다크/라이트/시스템 테마 컨텍스트 (localStorage 영속 + OS 변경 추적) |
| [src/data/securityCatalog.ts](../src/data/securityCatalog.ts) | 신규 | 16개 보안 검사 항목 카탈로그 (등급별 4개, CWE 코드) |
| [src/main.tsx](../src/main.tsx) | 수정 | 앱 전체를 `ThemeProvider`로 래핑 |
| [src/components/layout/NativeFrameBar.tsx](../src/components/layout/NativeFrameBar.tsx) | 수정 | 타이틀바 테마 스위처(다크/라이트/시스템) + 테마 토큰 적용 |
| [src/index.css](../src/index.css) | 수정 | 테마 토큰 정의 + 라이트모드 가시성 오버라이드(검정 테두리, 네임드 그레이 표면) |
| [src/lib/api.ts](../src/lib/api.ts) | 수정 | `fetchJobResult` + 결과 타입, `startPipeline` 페이로드 확장(`selected_items`/`environment`/`commit_sha`) |
| [src/pages/NewPipelinePage.tsx](../src/pages/NewPipelinePage.tsx) | 수정 | 16개 항목 등급별 선택 UI, environment 드롭다운, 선택 항목만 실행 |
| [src/pages/PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx) | 수정 | 보안 분석 결과 페이지 실데이터 연동 (mock 제거) |
| [src/pages/PipelineProcessPage.tsx](../src/pages/PipelineProcessPage.tsx) | 수정 | 파이프라인 메타데이터/커밋 SHA localStorage 영속화, environment 전달 |
| [src/pages/RepositoryDetailPage.tsx](../src/pages/RepositoryDetailPage.tsx) | 수정 | 소스 카드 폴백 강화(파이프라인 메타데이터 활용) |
| [package.json](../package.json) · [package-lock.json](../package-lock.json) | 설정 | 버전 0.8.0 → 0.9.0 |
| [docs/backend-api-spec.md](./backend-api-spec.md) | 문서 | §3.9 연동 등 체크리스트 갱신 |

> pnpm 도입(`pnpm-lock.yaml`, `pnpm-workspace.yaml` 신규)도 포함.

---

## 2. 기능 단위 변경 요약

### 2.1 다크/라이트 테마 시스템 (신규)

#### ThemeContext (신규)
- `dark` / `light` / `system` 3가지 선호도, **기본값 `system`**(OS 설정 추종)
- 선택값을 `localStorage('secupipeline:theme')`에 영속
- `prefers-color-scheme` 미디어쿼리 구독 → `system`일 때 OS 변경 실시간 반영
- 해석된 테마를 `<html data-theme="...">` + `color-scheme`에 반영 → CSS 토큰 스위칭

#### 타이틀바 테마 스위처 (NativeFrameBar)
- 우측 버튼 그룹에 테마 토글 버튼(현재 테마 아이콘: ☀️/🌙/🖥️) + 선택 다이얼로그
- 타이틀바 자체를 `var(--app-titlebar-*)` 토큰으로 렌더 → 모드 전환 시 즉시 반응

#### 테마 토큰 (index.css)
- `--app-bg / -elevated / -sunken`, `--app-surface-strong`, `--app-border`, `--app-text-*`, `--app-titlebar-*` 정의
- `:root[data-theme='dark' | 'light']`로 토큰 값 분기

### 2.2 라이트모드 가시성 개선 (index.css)

다크 기준으로 만들어진 하드코딩 색상들을 라이트모드에서 보정:

- **중성 테두리 → 검정**: 다크에선 회색으로 구분되던 선들(`#262626`·`#2F2F2F`·`#3A3A3A`·`#404040`·`#5B5B5B`·`#6B7280` 및 네임드 `gray-400~700`·`gray-50`)을 라이트모드에서 `--app-border`(검정)로 통일해 가시성 확보
- **회색 상자 + 검은 글씨 문제 해결**: `@theme`에서 다크로 재정의된 네임드 스케일 배경(`bg-gray-700/55`, `bg-gray-800/60` 등)과 누락 hex(`#101010`, `#6B7280`)를 밝은 표면으로 매핑 → 어두운 상자에 검은 글씨가 안 보이던 footer/Card/배지 등 정상화
- **텍스트 대비 보강**: `text-gray-300` 등 옅은 회색 텍스트를 라이트 표면용 secondary 색으로 매핑
- 의미색(빨강/초록/주황, 등급 배지, 브랜드 `#3ECF8E`)은 의미 유지를 위해 **제외**

### 2.3 보안 분석 결과 페이지 실데이터 연동 (PipelineProgressPage)

- 하드코딩 mock(고정 점수·취약점 리스트) **전면 제거**
- 전달받은 `jobId`로 `fetchJobDetail`(요약) + `fetchJobResult`(상세 §3.9)를 `Promise.allSettled` 병렬 조회
- 표시 데이터: 보안 점수, 코드 품질 점수, 등급별 취약점 도넛, 탐지된 취약점 리스트 — 모두 실데이터(상세 → 요약 → 네비게이션 state 순 폴백)
- **verdict 기반 동적 배너**: `failed`(빨강) / `warning`(주황) / `passed`(초록)
- 로딩 스피너, 에러 카드, "취약점 없음", "백엔드 결과 준비 대기 중" 등 빈/실패 상태 처리
- finding별 scanner 배지·코드 스니펫·CVE/CVSS·파일:라인·AI 제안을 있을 때만 조건부 렌더

### 2.4 검사 항목 16종 + 등급별 선택 UI (NewPipelinePage, securityCatalog.ts)

#### 카탈로그 (신규 securityCatalog.ts)
- 16개 항목을 등급별 4개씩 정의 (CWE 코드·한줄 설명·등급 색상 포함)
  - 🔴 Critical: SQL Injection, Command Injection, Hardcoded Secret, Code Injection
  - 🟠 High: Insecure Deserialization, IDOR, Improper JWT Verification, Cleartext Transmission
  - 🟡 Medium: Path Traversal, XSS, Weak Cryptography, SSRF
  - 🟢 Low: Error Message Info Exposure, Missing HttpOnly, Missing Secure Flag, Weak Password Requirements

#### 선택 UI (화면 A 명세 반영)
- 기존 6개 → 16개, **기본 전체 선택**
- 등급별 전체선택/해제 토글 + 상단 전체 토글, 등급 색상 배지, 한줄 설명(보조텍스트 + 툴팁), 그룹별 선택 카운트
- **최소 1개 강제**: 0개 선택 시 실행 버튼 비활성 + 경고 문구
- 첫 실행 레포는 기존대로 전체 베이스라인 강제

#### environment 선택 + 제출 페이로드 (화면 A-2/A-3 명세 반영)
- environment 드롭다운: `development / feature / staging / production` — production/staging 안내 문구("Medium도 승인 필요로 승격")
- **선택한 항목만 파이프라인 실행**: `POST /api/pipelines` 바디에 `selected_items`(CWE id), `environment`, `commit_sha` 전송
  - 이전엔 무시되는 `env_vars`만 보내 항상 전체가 돌던 문제 해결
- `commit_sha`는 선택 repo+branch의 최신 커밋을 best-effort 조회(선택키 태깅으로 stale 방지)

### 2.5 진행 페이지/레포 상세 보강

- **PipelineProcessPage**: 파이프라인 메타데이터·클론 로그 커밋 SHA를 `setRepoPipelineInfo`로 localStorage 영속, environment를 결과 페이지로 전달
- **RepositoryDetailPage**: GitHub commits API 실패 시 파이프라인 메타데이터(`getRepoPipelineInfo`)로 커밋 메시지/SHA/브랜치/트리거 정보 폴백 → 소스 카드가 항상 의미 있는 값 표시

---

## 3. API 레이어 변경 (src/lib/api.ts)

#### 신규
- **`fetchJobResult(token, jobId)`** — §3.9 상세 결과 조회. `404`/`425`는 `null` 반환(미준비) → 호출부가 요약으로 폴백
- 타입: `JobResult`, `SecurityFinding`, `PipelineEnvironment`
- snake/camel·`line_number↔line_start`·`ai_recommendation↔ai_suggestion`·`scanner_name↔scanner` 등 콜백/응답 필드 차이 흡수, `severity_summary` 누락 시 scanner 요약 → findings 순 집계

#### `startPipeline` 페이로드 확장
- `selected_items`(CWE id 일관 전송), `environment`, `commit_sha`, `is_first_run` 추가
- 기존 `env_vars` 기반 선택 전달 제거(백엔드가 무시하던 경로)

---

## 4. 버전 표기 정리

`v0.8.0` → `v0.9.0`
- [package.json](../package.json):4
- [package-lock.json](../package-lock.json):3, 9

UI 표기 버전은 `app.getVersion()`(package.json)에서 동적으로 읽으므로 별도 하드코딩 없음. 서드파티 의존 라이브러리 버전 문자열은 보존.

---

## 5. 백엔드 호환성

- 기존 API 8종 모두 그대로 호환
- **신규 의존**: 결과 페이지 상세 데이터는 `GET /api/jobs/{id}/result`(§3.9)에 의존 — 미구현이어도 요약(`fetchJobDetail`)으로 폴백, findings 영역은 "백엔드 결과 준비 대기 중" 안내
- **선택 항목 실제 반영**: 프론트는 `selected_items`/`environment`/`commit_sha`를 전송하므로, 실제 스캔 범위 제한·환경별 게이트는 **백엔드가 이 필드들을 읽어 우분투 러너에 전달**하도록 구현 필요 (명세 §6 결정사항 #2)
- 테마 선호도는 프론트 localStorage에만 저장, 백엔드 요구 없음

---

## 6. UI 보존

- 기존 카드 구조·레이아웃·아이콘 유지, 색상은 다크모드 기준 그대로 + 라이트모드 토큰으로 보정
- 신규 라우트 없음. 추가 UI는 타이틀바 테마 토글, 검사 항목 그룹 선택, 결과 페이지 실데이터 렌더로 한정
