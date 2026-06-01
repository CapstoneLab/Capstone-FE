# v0.10.0 업데이트 내역

> **기준**: `b4a5361` (v0.9.0) → 현재 워킹 트리
> **변경 파일**: 12개 (코드 수정 8개 · 신규 2개 · 설정 2개)
> **변경량**: 약 +920 / -254 줄 (코드 기준)

---

## 1. 변경 파일 한눈에 보기

| 파일 | 구분 | 핵심 변경 |
|---|---|---|
| [src/pages/PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx) | 수정 | 결과 화면(B) verdict 게이트 모델 전면 반영 (B-0~B-6) |
| [src/pages/ApprovalPage.tsx](../src/pages/ApprovalPage.tsx) | 신규 | 승인 화면(C) — 요청/사유/전체·부분 승인/거부 |
| [src/pages/AuditLogPage.tsx](../src/pages/AuditLogPage.tsx) | 신규 | 감사 로그(D) — 승인 이력 + pending approve/reject |
| [src/lib/api.ts](../src/lib/api.ts) | 수정 | verdict/finding 파싱, 승인·카탈로그·감사 API, Base URL |
| [src/data/securityCatalog.ts](../src/data/securityCatalog.ts) | 수정 | 카탈로그 `id`를 backend `key`로 정렬 + 동적 카탈로그 헬퍼 |
| [src/pages/NewPipelinePage.tsx](../src/pages/NewPipelinePage.tsx) | 수정 | `GET /api/security/catalog` 연동(로컬 폴백) |
| [src/App.tsx](../src/App.tsx) | 수정 | `/pipeline/approval`, `/approvals` 라우트 추가 |
| [src/data/repositories.ts](../src/data/repositories.ts) · [src/pages/RepositoryDetailPage.tsx](../src/pages/RepositoryDetailPage.tsx) | 수정 | EC2 DNS 샘플/placeholder 제거(IP 비노출) |
| [.env](../.env) · [vite.config.ts](../vite.config.ts) · [electron/main.cjs](../electron/main.cjs) | 설정 | Base URL EC2 → 도메인 |
| [package.json](../package.json) · [package-lock.json](../package-lock.json) | 설정 | 버전 0.9.0 → 0.10.0 |

---

## 2. 기능 단위 변경 요약

### 2.1 HTTPS 도메인 전환 — IP 비노출

- 백엔드가 EC2 공인 IP(`54.221.222.244`) → HTTPS 도메인(`api.pwd.kr`)으로 전환됨에 따라 프론트의 Base URL을 교체.
  - 기존: `http://ec2-54-221-222-244.compute-1.amazonaws.com/capstonelab/capstone-back`
  - 변경: `https://api.pwd.kr/capstonelab/capstone-back`
- 교체 위치: [.env](../.env), [vite.config.ts](../vite.config.ts)(개발 프록시 fallback), [electron/main.cjs](../electron/main.cjs)(Electron fallback + 인증 허용 호스트 자동 파생)
- 그 외 EC2 DNS가 노출돼 있던 미사용 샘플 데이터([repositories.ts](../src/data/repositories.ts))와 입력 placeholder([RepositoryDetailPage.tsx](../src/pages/RepositoryDetailPage.tsx))도 중립 예시로 교체 → **프론트 소스에서 공인 IP 노출 0건**
- 그 외 API 호출부는 모두 `VITE_API_BASE_URL`에서 파생되어 추가 수정 불필요

### 2.2 보안 정책 카탈로그 — API 연동

- `GET /api/security/catalog`로 16항목 카탈로그를 로드하고, 실패 시 번들된 로컬 카탈로그로 폴백([NewPipelinePage.tsx](../src/pages/NewPipelinePage.tsx))
- 카탈로그 식별자(`id`)를 backend `key`(`sql-injection` 등)로 정렬 → `selected_items` 전송·결과 매칭 일관화([securityCatalog.ts](../src/data/securityCatalog.ts))
- API 응답의 `grade`→severity 매핑, 설명은 로컬 카탈로그에서 보강

### 2.3 결과 화면(B) — verdict 게이트 모델 + 응답 파싱 정합

- 백엔드 실제 응답 구조에 맞춰 파싱 수정 ([api.ts](../src/lib/api.ts) `mapJobResult`):
  - `security.verdict`가 **문자열**("block")이고 `score`/`gauge_color`/`block_reasons`/`*_count`가 `security` 바로 밑 **형제 필드**인 플랫 구조 우선 처리(중첩 형태도 허용)
  - 카운트는 `counts` 객체 또는 플랫 `critical_count`/`high_count`/… 모두 수용
- 화면 렌더(B-0~B-6):
  - **gauge_color / score_label 그대로 사용**(점수로 색 재계산 금지)
  - 게이트 위계 카드 우선 노출(현재 판정 하이라이트) + 점수 게이지는 보조 지표
  - verdict 4종(pass/warn/block_pending_approval/block) 배지·색·메시지·액션 분기
  - `out_of_scope_count > 0` 미검사 경고 배너(미검사 보기/전체 재검사)
  - block_reasons·warn_reasons 원문 출력, scanned_commit_sha 표시 + 불일치 경고
  - acknowledged_cwes "수용된 취약점" 배지(점수 반영 안내)
  - findings: in_scope 분리("정책 범위 밖" 섹션), CWE 분류, policy_item null→"16항목 외", code_snippet, AI 수정 제안 펼치기
- 등급 배지 고정색 정합: Critical🔴 / High🟠 / Medium🟡 / Low🟢

### 2.4 승인 화면(C) — block_pending_approval 전용 (신규)

- API([api.ts](../src/lib/api.ts)): `requestApproval`/`approveJob`/`rejectJob` (`/api/jobs/{id}/approval/*`), 403 → `ApprovalForbiddenError`
- [ApprovalPage.tsx](../src/pages/ApprovalPage.tsx):
  - C-1: 차단 유발 High 항목 표시 + 승인 요청 생성
  - C-2: 사유 필수(textarea), 권한 안내, 전체 승인 / 거부
  - C-3: 부분 승인 — High CWE 체크박스 → `approved_cwes`, **Critical 미노출**
  - C-4: follow-up job 추적 + 커밋 한정 안내 + acknowledged 수용 표시
  - C-5: block(Critical) 진입 시 승인 버튼 없이 수정 안내
- 결과 화면(B)의 "승인 요청" CTA가 block_pending_approval일 때 화면 C로 연결

### 2.5 감사 로그(D) (신규)

- API([api.ts](../src/lib/api.ts)): `fetchApprovals(status?)` → `GET /api/approvals?status=`, `ApprovalLogEntry` 매핑
- [AuditLogPage.tsx](../src/pages/AuditLogPage.tsx):
  - 컬럼: Job/커밋 · 대상 CWE · 사유 · 승인자 · 일시 · 상태 · 만료
  - 상태 필터(전체/대기/승인/거부), append-only 안내, 커밋 불일치 추적(scanned_commit_sha)
  - **pending 행 approve/reject 버튼** + 사유 다이얼로그(전체 승인/거부, 403 권한 안내)
- 결과 화면(B)·승인 화면(C) 헤더에서 "감사 로그" 진입

---

## 3. 버전 표기 정리

`v0.9.0` → `v0.10.0`
- [package.json](../package.json):4
- [package-lock.json](../package-lock.json):3, 9

UI 표기 버전은 `app.getVersion()`(package.json)에서 동적으로 읽음.

---

## 4. 백엔드 호환성

- 신규 의존 엔드포인트: `GET /api/security/catalog`, `GET /api/jobs/{id}/result`(verdict 포함), `POST /api/jobs/{id}/approval/{request|approve|reject}`, `GET /api/approvals`
- 모두 실패/미구현 시 폴백 처리(카탈로그→로컬, 결과→요약, 감사→빈 목록)되어 화면이 깨지지 않음
- `selected_items`는 카탈로그 `key` 기준 전송, `approved_cwes`/`acknowledged_cwes`는 CWE 기준

---

## 5. 미해결 / 확인 대기

- **파이프라인 시작 경로**: 현재 `POST /api/pipelines` 유지 (문서 일부는 `/start-pipeline` 표기) — 백엔드 확정 필요
- **GitHub 로그인 경로**: 현재 `/auth/github/login` 유지 (문서 일부는 `/auth/github` 표기) — 백엔드 확정 필요
- git 히스토리의 과거 EC2 주소는 본 커밋 이후에도 잔존(이미 외부 공개된 값이며, 직접 접근 차단은 인프라 영역). 필요 시 history rewrite 별도 진행
