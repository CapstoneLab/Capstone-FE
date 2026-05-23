# 백엔드 API 요구사항 명세 (Frontend ↔ Backend)

> 대상: 프론트엔드(React/Vite) ↔ 백엔드 서버 간 REST API
> 백엔드는 이 명세의 엔드포인트를 노출하고, 내부적으로 우분투 러너의 `/start-pipeline`, `/pipeline-logs`, `/pipeline-steps` 등을 호출/위임한다.
> 기준 코드: [src/lib/api.ts](../src/lib/api.ts)

---

## 0. 아키텍처 전제

```
[Frontend(Vite)] ──HTTPS──► [Backend(API Server)] ──HTTP/SSH──► [Ubuntu Runner]
                              (이 문서의 대상)              (/start-pipeline 등)
```

- 프론트는 `API_BASE` (`/api-proxy` 또는 `VITE_API_BASE_URL`)를 baseURL로 사용한다.
- **모든 엔드포인트는 백엔드가 노출**한다. 우분투 러너 호출은 백엔드 내부 책임이며 프론트에 노출되지 않는다.
- 인증은 모든 보호된 엔드포인트에서 `Authorization: Bearer <token>` 헤더로 수행한다 (GitHub OAuth Access Token).

---

## 1. 공통 규약

### 1.1 Base URL
- 프로덕션: `https://<backend-host>` (프론트의 `/api-proxy`가 이 호스트로 리버스 프록시)
- 개발: `VITE_API_BASE_URL`로 주입

### 1.2 인증
- 헤더: `Authorization: Bearer <github_access_token>`
- 미인증/만료: `401 Unauthorized`, 권한 없음: `403 Forbidden`

### 1.3 요청/응답 포맷
- Content-Type: `application/json`
- **필드 네이밍: snake_case** (프론트 `pick()`가 snake_case/camelCase 둘 다 수용하지만, 백엔드는 snake_case로 통일)
- 시간: ISO 8601 UTC (`2026-05-23T12:34:56Z`)

### 1.4 에러 응답 표준
```json
{
  "error": "VALIDATION_ERROR",
  "detail": "repo_url is required",
  "message": "사람이 읽을 수 있는 한국어 메시지"
}
```
- 프론트는 `detail` → `message` 순으로 읽어 사용자에게 노출한다 ([src/lib/api.ts:299](../src/lib/api.ts#L299)).

### 1.5 HTTP 상태 코드
| 코드 | 의미 |
|---|---|
| 200 | 조회 성공 |
| 202 | 비동기 작업 접수 (파이프라인 시작) |
| 400 | 요청 바디/파라미터 오류 |
| 401 | 토큰 없음/만료 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (이미 실행 중인 job 등) |
| 500 | 서버 내부 오류 |
| 502 | 우분투 러너 호출 실패 |
| 504 | 우분투 러너 응답 타임아웃 |

---

## 2. 엔드포인트 목록

| # | Method | Path | 용도 | 우분투 위임 |
|---|---|---|---|---|
| 1 | GET  | `/api/repos` | 사용자 GitHub 레포 목록 | X (GitHub API) |
| 2 | GET  | `/api/repos/{owner}/{repo}/branches` | 브랜치 목록 | X (GitHub API) |
| 3 | POST | `/api/pipelines` | **파이프라인 시작** (신규/수정 대상) | O → `/start-pipeline` |
| 4 | GET  | `/api/jobs/{job_id}` | Job 상세 (보안 리포트 포함) | O |
| 5 | GET  | `/api/pipelines/{job_id}/logs` | 실시간 로그 라인 | O → `/pipeline-logs` |
| 6 | GET  | `/api/pipelines/{job_id}/steps` | 단계별 진행 상태 | O → `/pipeline-steps` |
| 7 | POST | `/api/pipelines/{job_id}/cancel` | **실행 중인 파이프라인 취소** | O (SSH `pkill -9 -f {job_id}`) |
| 8 | DELETE | `/api/pipelines/{job_id}` | **Job 완전 삭제** (DB cascade + 결과파일) | O (실행 중이면 kill 선행) |

---

## 3. 엔드포인트 상세

### 3.1 GET `/api/repos` — 레포지토리 목록
사용처: [src/lib/api.ts:64](../src/lib/api.ts#L64)

**요청**
- Header: `Authorization: Bearer <token>`

**응답 200**
```json
{
  "repos": [
    {
      "id": 12345,
      "full_name": "octocat/hello-world",
      "description": "...",
      "private": false,
      "default_branch": "main",
      "updated_at": "2026-05-20T08:00:00Z",
      "pushed_at": "2026-05-22T11:00:00Z",
      "pushed_by": "octocat",
      "stargazers_count": 42,
      "language": "TypeScript",
      "html_url": "https://github.com/octocat/hello-world"
    }
  ]
}
```

---

### 3.2 GET `/api/repos/{owner}/{repo}/branches` — 브랜치 목록
사용처: [src/lib/api.ts:78](../src/lib/api.ts#L78)

**응답 200**
```json
{ "branches": [{ "name": "main" }, { "name": "dev" }] }
```

---

### 3.3 POST `/api/pipelines` — 파이프라인 시작 ★
사용처: [src/lib/api.ts:273](../src/lib/api.ts#L273) (현재 `/start-pipeline` 직호출 중 → 이 경로로 변경 필요)

**요청 바디**
```json
{
  "repo_url": "https://github.com/octocat/hello-world",
  "branch": "main",
  "trigger_source": "manual",
  "env_vars": { "NODE_ENV": "production" }
}
```
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| repo_url | string | ✅ | GitHub HTTPS URL |
| branch | string |  | 기본값: 레포 default_branch |
| trigger_source | string |  | `manual` \| `webhook` \| `schedule` |
| env_vars | object<string, string> |  | 러너에 전달할 환경변수 |

**응답 202**
```json
{
  "job_id": "job_01H...",
  "status": "queued",
  "message": "파이프라인이 큐에 등록되었습니다"
}
```

**백엔드 내부 동작 (의무)**
1. 토큰 검증 → 사용자 식별
2. `repo_url`이 해당 사용자의 권한 범위인지 확인 (403 가능)
3. 동일 repo+branch가 이미 `running`이면 `409 Conflict` 반환
4. DB에 `job` 레코드 INSERT (status=`queued`, created_at)
5. 우분투 러너의 `/start-pipeline`을 호출하여 실제 실행 위임
6. 우분투 응답을 받아 DB 갱신 후 위 응답 반환
7. 우분투 호출 실패 시 → `502 Bad Gateway`, job은 `failed`로 마킹

**에러**
- 400: `repo_url` 누락/포맷 오류
- 401/403: 인증/권한
- 409: 이미 실행 중
- 502/504: 우분투 호출 실패/타임아웃

---

### 3.4 GET `/api/jobs/{job_id}` — Job 상세
사용처: [src/lib/api.ts:245](../src/lib/api.ts#L245)

**응답 200**
```json
{
  "job": {
    "job_id": "job_01H...",
    "repo_url": "https://github.com/octocat/hello-world",
    "branch": "main",
    "trigger_source": "manual",
    "status": "success",
    "overall_result": "passed",
    "created_at": "2026-05-23T10:00:00Z",
    "started_at": "2026-05-23T10:00:05Z",
    "completed_at": "2026-05-23T10:03:21Z",
    "duration_secs": 196
  },
  "steps": [
    {
      "step_id": "checkout",
      "step_name": "Checkout",
      "step_type": "git",
      "status": "success",
      "error_message": null,
      "started_at": "2026-05-23T10:00:05Z",
      "ended_at": "2026-05-23T10:00:10Z",
      "duration_secs": 5
    }
  ],
  "security": {
    "verdict": {
      "overall_status": "passed",
      "status_reason": "No critical issues",
      "total_findings": 3
    },
    "summaries": [
      { "scanner": "trivy", "count": 2, "critical": 0, "high": 0, "medium": 1, "low": 1 },
      { "scanner": "semgrep", "count": 1, "critical": 0, "high": 0, "medium": 0, "low": 1 }
    ]
  }
}
```

**필드 enum**
- `status`: `queued` | `running` | `success` | `failed` | `cancelled`
- `step.status`: `pending` | `running` | `success` | `failed` | `skipped`
- `verdict.overall_status`: `passed` | `warning` | `failed`

**404**: 해당 `job_id` 없음

---

### 3.5 GET `/api/pipelines/{job_id}/logs` — 로그 라인
사용처: [src/lib/api.ts:318](../src/lib/api.ts#L318) (현재 `/pipeline-logs?job_id=`)

> ⚠️ 프론트가 쿼리스트링 방식을 쓰므로 **둘 중 하나 합의 필요**.
> 권장: `/api/pipelines/{job_id}/logs` (REST 일관성). 합의 후 프론트도 함께 변경.

**쿼리 파라미터 (선택)**
- `since`: ISO 8601, 이 시각 이후 라인만 반환 (롱폴링/증분 갱신용)
- `limit`: number (기본 500)

**응답 200**
```json
{ "lines": ["[10:00:05] Cloning repo...", "[10:00:10] Done"] }
```

---

### 3.6 GET `/api/pipelines/{job_id}/steps` — 단계 진행
사용처: [src/lib/api.ts:337](../src/lib/api.ts#L337)

**응답 200**
```json
{
  "steps": [
    { "step_id": "checkout", "step_name": "Checkout", "step_type": "git", "status": "success", "started_at": "...", "ended_at": "...", "duration_secs": 5, "error_message": null }
  ]
}
```

---

### 3.7 POST `/api/pipelines/{job_id}/cancel` — 파이프라인 취소 ★

**요청**
- Header: `Authorization: Bearer <token>`
- Body: 없음

**응답 200**
```json
{
  "job_id": "job_01H...",
  "status": "cancelled",
  "message": "파이프라인이 취소되었습니다"
}
```

**백엔드 내부 동작**
1. job이 `queued` 또는 `running` 상태일 때만 허용 (그 외 → `409 Conflict`)
2. 우분투에 SSH 접속 → `pkill -9 -f {job_id}` 실행
3. DB의 `status`를 `cancelled` 로 업데이트, `completed_at` 기록
4. (선택) 현재 진행 중이던 step도 `cancelled` 마킹

**에러**
- 404: `job_id` 없음
- 409: 이미 `success` / `failed` / `cancelled` 상태 (취소 불가)
- 502: SSH/우분투 호출 실패

---

### 3.8 DELETE `/api/pipelines/{job_id}` — Job 삭제 ★

**요청**
- Header: `Authorization: Bearer <token>`

**응답 200**
```json
{ "job_id": "job_01H...", "message": "삭제 완료" }
```
또는 **204 No Content** (body 없이)

**백엔드 내부 동작**
1. 어떤 상태든 삭제 가능
2. `queued` / `running` 상태이면 SSH `pkill -9 -f {job_id}` 선행
3. DB cascade 삭제: `jobs`, `steps`, `findings`, `summary` 등 관련 레코드 모두 제거
4. 로컬 결과 JSON 파일(`result_{job_id}.json` 등)도 삭제

**에러**
- 404: `job_id` 없음
- 502: SSH 호출 실패 (실행 중이었을 때)

---

## 4. 비기능 요구사항

### 4.1 성능
- `/api/jobs/{id}`, `/api/pipelines/{id}/steps`는 **p95 < 300ms** (DB 조회만)
- `/api/pipelines/{id}/logs`는 **p95 < 800ms** (라인 500개 기준)
- `POST /api/pipelines`는 우분투 호출 포함 **p95 < 2s**, 타임아웃 5s

### 4.2 폴링 부하 대비
- 프론트는 진행 중인 job에 대해 `logs`, `steps`를 주기적으로 polling 한다 (예: 2~3s).
- 백엔드는 `ETag` 또는 `If-Modified-Since` 지원 권장 → 304로 부하 절감.
- 향후 SSE/WebSocket으로 마이그레이션 가능하도록 응답 모델 유지.

### 4.3 보안
- CORS: 프론트 origin만 허용
- Rate limit: 토큰당 60req/min (조회), 10req/min (`POST /api/pipelines`)
- 우분투 러너와의 통신은 내부 네트워크 또는 mTLS, **외부에 노출 금지**
- `env_vars`는 로그에 그대로 출력하지 않음 (마스킹)

### 4.4 관측성
- 모든 요청에 `request_id` 부여, 응답 헤더 `X-Request-Id`로 반환
- 우분투 호출 실패 시 구조화 로그 (`event=ubuntu_call_failed job_id=... status=...`)

### 4.5 멱등성
- `POST /api/pipelines`는 **`Idempotency-Key` 헤더 지원 권장** (네트워크 재시도로 중복 job 생성 방지)

---

## 5. 마이그레이션 체크리스트

- [ ] 백엔드: 위 6개 엔드포인트 구현
- [ ] 백엔드: 우분투 러너 클라이언트 모듈 분리 (`services/ubuntu_runner.py` 등)
- [ ] 프론트: `startPipeline` URL을 `/start-pipeline` → `/api/pipelines`로 변경 ([src/lib/api.ts:284](../src/lib/api.ts#L284))
- [ ] 프론트: `fetchPipelineLogs`, `fetchPipelineSteps` URL을 `/api/pipelines/{id}/logs`, `/api/pipelines/{id}/steps` 로 변경 (선택, 합의 시)
- [ ] 인증 토큰 만료 처리(401 → 로그인 화면 리디렉트) E2E 확인
- [ ] 우분투 러너 다운/타임아웃 시나리오 테스트 (502/504 정상 반환 확인)

---

## 6. 합의가 필요한 결정 사항

1. **로그/스텝 엔드포인트 경로**: `/pipeline-logs?job_id=` (현행) vs `/api/pipelines/{id}/logs` (REST 권장) — 어느 쪽으로?
2. **인증 토큰**: GitHub Access Token 그대로 사용 vs 백엔드 자체 JWT 발급
3. **실시간성**: 폴링 유지 vs SSE/WebSocket 도입 시점
4. **Job 중복 방지**: 같은 repo+branch 동시 실행 허용 여부 → 409 정책 합의
