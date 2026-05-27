# v0.8.0 업데이트 내역

> **기준**: `96b01e4` (v0.7.1) → 현재 워킹 트리
> **변경 파일**: 7개 (코드 5개 · 문서 1개 · 설정 1개)
> **변경량**: +1067 / -102 줄

---

## 1. 변경 파일 한눈에 보기

| 파일 | 추가 | 삭제 | 핵심 변경 |
|---|---:|---:|---|
| [src/pages/PipelineProcessPage.tsx](../src/pages/PipelineProcessPage.tsx) | +516 | -49 | 실시간 단계 추적, 라이브 elapsed, 로그 슬라이스, 보안 게이트, 배포 도메인 자동 추출 |
| [src/pages/RepositoryDetailPage.tsx](../src/pages/RepositoryDetailPage.tsx) | +331 | -31 | 하드코딩 시드 제거, 실제 API/캐시 데이터, 커밋 정보 GitHub 직접 폴백, 도메인 인라인 편집 |
| [src/lib/api.ts](../src/lib/api.ts) | +136 | 0 | `deriveJobStatus`, `fetchLatestCommit`, 탐지/도메인 localStorage 헬퍼 |
| [src/pages/DashboardPage.tsx](../src/pages/DashboardPage.tsx) | +57 | -15 | verdict 기반 상태 판정, 실시간 진행률, 탐지 토글 영속화 |
| [package-lock.json](../package-lock.json) | +21 | -2 | 버전 0.7.1 → 0.8.0 |
| [docs/backend-api-spec.md](./backend-api-spec.md) | +3 | -3 | v0.7.0 → v0.8.0 표기 |
| [package.json](../package.json) | +3 | -2 | 버전 0.7.1 → 0.8.0 |

---

## 2. 기능 단위 변경 요약

### 2.1 파이프라인 실시간 진행 가시화 (PipelineProcessPage.tsx)

#### 단계 라이프사이클 추적 (신규 핵심 메커니즘)
- 프론트엔드가 직접 각 단계의 시작·종료를 관찰해 `stepLifecycle` 상태에 기록
  - `observedStartMs`, `observedEndMs`: 백엔드 `step.startedAt/endedAt` 우선, 없으면 wall clock
  - `startLogIdx`, `endLogIdx`: 글로벌 로그 배열 인덱스로 단계별 슬라이스 경계
- **인덱스 기반 stable 키** (`step-${idx}`) — placeholder('ph-clone') ↔ 백엔드 stepId 전환 시 키가 바뀌어 추적이 끊기던 문제 해결
- **이전 단계 `endLogIdx` 상속** — 새 단계 시작 시 직전 단계 끝 지점부터 슬라이스, 중간 진입(refresh) 시에도 누락 없음
- **Missed window 처리** — 폴 간격 사이에 단계가 빨리 끝나도 이전 단계 종료 지점부터 현재까지 슬라이스로 복구

#### 단계별 실제 시간 표시
- duration 우선순위: lifecycle(observedEnd-Start) > 라이브 elapsed > 백엔드 `durationSecs` > `(endedAt-startedAt)` > 마지막 라이브 ref
- 백엔드가 `durationSecs: 1`처럼 부정확하게 보내도 프론트엔드 관찰값으로 정확 표시
- 진행 중 단계는 매 초 라이브 카운터 갱신

#### 로그 표시 개선
- `findLogsForStep` 6단계 폴백 체인:
  1. 단계명/타입 대소문자 무시 정확 매칭
  2. 부분 문자열 매칭 (`[lightweight-security]` ↔ `security-light`)
  3. **라이프사이클 로그 슬라이스** (가장 신뢰)
  4. 아이콘 클래스 매칭
  5. 백엔드 타임스탬프 윈도우
  6. 진행 중 단계 → 일반 버킷의 최근 20줄
- 각 로그 라인에 `+Xs` 형식의 경과 시간 prefix
- 빈 로그 상태 메시지 분기: `running` / `pending` / `terminal` 별 안내문

#### 폴링 동작
- 폴 간격 2s → **1.5s**
- 종료 후 **3회 grace 폴링** — 실패 직전 trailing 로그 캐치
- `Promise.all` → **`Promise.allSettled`** — job/logs 독립적 처리, 한쪽 실패가 다른 쪽 데이터를 폐기하지 않음
- 빈 로그 응답으로 누적 로그 wipe 방지

#### "지금 무엇이 돌고 있는가" 패널 (신규)
- 진행 과정 카드 상단에 spinning loader + 현재 단계 아이콘/이름 + 라이브 elapsed + 최근 로그 1줄
- 종료 상태에선 전체 결과/총 소요 시간 표시

#### 단계 추가
- **보안 게이트** 단계 추가 (심화 보안 검사 ↓ / 빌드 ↑ 위치)
- `stepIconMap`에 `gate|verdict|threshold|게이트` 규칙을 generic security 앞에 배치, `ShieldCheck` 아이콘

#### Accordion 동작
- `type="single"` → **`type="multiple"` + controlled**
- 진행 중 단계 자동 펼침, 사용자가 연 항목은 자동으로 닫히지 않음

#### 배포 도메인 자동 추출 (신규)
- 배포 단계 완료 시 그 단계 로그에서 `https?://...` URL 자동 추출 (뒤에서부터 검색)
- `setRepoDomainUrl(cacheKey, repoName, url)`로 localStorage 영속
- 레포 상세 페이지에서 자동 표시

---

### 2.2 레포지토리 상세 페이지 (RepositoryDetailPage.tsx)

#### 데이터 소스 전환 (하드코딩 → 실제 데이터)
| 필드 | 이전 | 이후 |
|---|---|---|
| 레포 이름/visibility/description/branches/언어/stars/링크 | `repositorySeed` 고정 | `getCachedRepos`/`fetchReposWithBranches` |
| pipelineStatus | 시드 정적 값 | 추적 Job 중 매칭+최신 → `deriveJobStatus(considerVerdict=false)` |
| 커밋 메시지 | 시드 | `fetchLatestCommit` (백엔드 프록시 → **GitHub API 직접 폴백**) |
| 푸시 사용자/시각 | 시드 | 커밋 author 정보 → 백엔드 pushed_by → fallback |
| 도메인 URL | 시드 | **인라인 편집 + localStorage 영속** + 배포 단계에서 자동 채움 |

#### 신규 동작
- 캐시 미스 시 자동 fetch + 스켈레톤 로딩
- `createdAt` 기준 최신 Job 선택 (이전 `completedAt` 기준은 오래 실행되다 늦게 끝난 실패 Job이 더 최근 성공 Job을 가렸음)
- 시드 fallback 제거 — 매칭 실패 시 "레포지토리를 찾을 수 없습니다" 명확 표시
- 인증 만료 시 자동 로그아웃 + `/auth` 리다이렉트
- 도메인 URL 카드: `편집`/`추가` 버튼 → 인라인 입력창(엔터=저장, ESC=취소) → localStorage 영속

---

### 2.3 대시보드 (DashboardPage.tsx)

#### 상태 판정 정확화
- `deriveJobStatus(considerVerdict=true)` 적용
  - 백엔드가 `job.status='success'`로 보내도 `verdict='failed'`이거나 step 중 하나라도 failed면 **failed로 표기**
  - 이전엔 보안 검사 실패해도 "성공"으로 표시되던 문제 해결

#### 실시간 진행률
- 실행 중 카드의 정적 `w-1/3` 펄스 바 → **실제 단계 진행률 바**
- `{completedSteps}/{totalSteps} 단계` 카운터 + 현재 진행 중 단계 이름 표시
- 활성 작업 폴링 간격 5s → **3s**

#### 탐지 토글 영속화
- `getRepoDetectEnabled/setRepoDetectEnabled` 도입
- 토글 클릭 → 즉시 localStorage 저장 → 페이지 재진입/새로고침에도 유지
- 이전엔 매번 리셋되던 문제 해결

---

### 2.4 공통 API 레이어 (src/lib/api.ts)

#### 신규 함수
- **`deriveJobStatus(job, options?)`** — Job 상태 판정 공용 헬퍼
  - `options.considerVerdict` (기본 true): verdict='failed' 또는 step 실패면 failed
  - `false`로 호출 시(레포 상세): 실행 성공 여부만 판단, 보안 verdict 무시
- **`fetchLatestCommit(token, owner, repo, branch)`** — 최신 커밋 조회 (best-effort)
  - 1차: 백엔드 프록시 `/api/repos/.../commits/{branch}`
  - 2차: **GitHub API 직접 호출** `https://api.github.com/repos/.../commits/{branch}` (백엔드 spec에 commits proxy 없음)
  - 토큰은 GitHub OAuth Access Token 그대로 사용
- **`getRepoDetectEnabled/setRepoDetectEnabled(cacheKey, repoId, enabled)`** — 탐지 토글 영속화
- **`getRepoDomainUrl/setRepoDomainUrl(cacheKey, repoIdentifier, url)`** — 배포 도메인 영속화

#### 타입 export 추가
- `GitHubCommitInfo` 타입

---

## 3. 버전 표기 정리

`v0.7.0/v0.7.1` → `v0.8.0` 일괄 갱신
- [package.json](../package.json):4
- [package-lock.json](../package-lock.json):3, 9
- [docs/backend-api-spec.md](./backend-api-spec.md):546, 548, 555

서드파티 의존 라이브러리(`class-variance-authority@0.7.1`, `@hapi/hoek@11.0.7` 등)와 SVG 좌표값은 임의 변경 시 깨질 수 있어 보존.

---

## 4. 백엔드 호환성

- 기존 백엔드 API 명세 8종 (`/api/repos`, `/api/pipelines`, `/api/jobs/{id}` 등) 모두 그대로 호환
- `fetchLatestCommit`이 사용하는 `/api/repos/{owner}/{repo}/commits/{branch}` 프록시는 spec에 없어서 404 시 GitHub 직접 호출로 자동 폴백 — 백엔드 변경 불필요
- 모든 추가 데이터(탐지 토글, 도메인 URL)는 프론트엔드 localStorage에만 저장, 백엔드 스토리지 요구 없음

---

## 5. UI 보존

- 카드 구조·색상·레이아웃·아이콘은 모두 기존 디자인 유지
- 추가된 UI는 기존 카드 안의 보강 요소(인라인 편집 버튼, 라이브 카운터, "현재 실행 중" 패널)
- 새 라우트·페이지 추가 없음
