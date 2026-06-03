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
| 4 | GET  | `/api/jobs/{job_id}` | Job 상세 (요약) — **확정 대기** ⚠️ | O |
| 5 | GET  | `/api/pipelines/{job_id}/logs` | 실시간 로그 라인 | O → `/pipeline-logs` |
| 6 | GET  | `/api/pipelines/{job_id}/steps` | 단계별 진행 상태 | O → `/pipeline-steps` |
| 7 | POST | `/api/pipelines/{job_id}/cancel` | **실행 중인 파이프라인 취소** | O (SSH `pkill -9 -f {job_id}`) |
| 8 | DELETE | `/api/pipelines/{job_id}` | **Job 완전 삭제** (DB cascade + 결과파일) | O (실행 중이면 kill 선행) |
| 9 | GET  | `/api/jobs/{job_id}/result` | **보안 분석 상세 결과** (findings 리스트, AI 제안) | O → `/pipeline-result` 또는 ubuntu push 후 DB 조회 |

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
사용처: [src/lib/api.ts](../src/lib/api.ts) `startPipeline` (v0.10.4부터 `/api/pipelines` 호출 — 409 중복 실행 방지 적용)

**요청 바디**
```json
{
  "repo_url": "https://github.com/octocat/hello-world",
  "branch": "main",
  "trigger_source": "manual"
}
```
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| repo_url | string | ✅ | GitHub HTTPS URL |
| branch | string |  | 기본값: 레포 default_branch |
| trigger_source | string |  | `manual` \| `webhook` \| `schedule` \| `windows-api` 등 (자유 문자열) |

> ⚠️ **`env_vars` 필드는 백엔드 미지원**. 프론트는 envVars 옵션을 페이로드에서 제외해야 함 (현재 보내고 있지만 백엔드가 무시).

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

### 3.4 GET `/api/jobs/{job_id}` — Job 상세 (요약)
사용처: [src/lib/api.ts:245](../src/lib/api.ts#L245) — **PipelineProcessPage 폴링 / Dashboard 카드 핵심 의존**

> ⚠️ **상태: 확정 대기**
> 백엔드 최신 확정 명세(2026-05-24)에서 이 엔드포인트가 빠져 있음. 그러나 프론트의 진행 페이지가 **2초 주기로 호출**하여 job 전체 상태(`running`/`success`/`failed`)와 진행 단계를 가져오는 핵심 API.
> §3.6 `/steps` 만으로는 job 전체 status(특히 `queued`, `running`) 와 메타데이터(repo_url, branch, trigger_source, created_at) 를 알 수 없음.
> **백엔드 측에 존속 여부 확인 필요** → §6 참고.

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
사용처: [src/lib/api.ts:318](../src/lib/api.ts#L318)

**쿼리 파라미터 (선택)**
- `since`: ISO 8601, 이 시각 이후 라인만 반환 (롱폴링/증분 갱신용) — *백엔드 지원 여부 미확인*
- `limit`: number — *백엔드 지원 여부 미확인*

**응답 200**
```json
{
  "job_id": "uuid",
  "lines": [
    "[build.log] Building project...",
    "[lightweight-security.log] Scanning secrets..."
  ]
}
```

---

### 3.6 GET `/api/pipelines/{job_id}/steps` — 단계 진행
사용처: [src/lib/api.ts:337](../src/lib/api.ts#L337)

**응답 200**
```json
{
  "job_id": "uuid",
  "steps": [
    {
      "step_id": "uuid",
      "step_name": "build",
      "step_type": "build",
      "status": "success",
      "error_message": null,
      "started_at": "2026-05-24T10:00:00Z",
      "ended_at": "2026-05-24T10:01:00Z",
      "duration_secs": 60.0
    }
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
  "job_id": "uuid",
  "status": "cancelled",
  "killed": true,
  "message": "파이프라인이 취소되었습니다"
}
```

**백엔드 내부 동작**
1. job이 `queued` 또는 `running` 상태일 때만 허용 (그 외 → `409 Conflict`)
2. 우분투에 SSH 접속 → `pkill -9 -f {job_id}` 실행 → `killed` 플래그로 결과 표시
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
{
  "job_id": "uuid",
  "deleted": true,
  "message": "파이프라인이 삭제되었습니다"
}
```

**백엔드 내부 동작**
1. 어떤 상태든 삭제 가능
2. `queued` / `running` 상태이면 SSH `pkill -9 -f {job_id}` 선행
3. DB cascade 삭제: `jobs`, `steps`, `findings`, `summary` 등 관련 레코드 모두 제거
4. 로컬 결과 JSON 파일(`result_{job_id}.json` 등)도 삭제

**에러**
- 404: `job_id` 없음
- 502: SSH 호출 실패 (실행 중이었을 때)

---

### 3.9 GET `/api/jobs/{job_id}/result` — 보안 분석 상세 결과 ★
사용처: 보안 분석 결과 페이지(`/pipeline/result`) — 현재 프론트는 mock 데이터로 렌더링 중. 이 엔드포인트가 준비되면 실제 데이터로 교체 예정.

> ⚠️ **§3.4 `GET /api/jobs/{job_id}` 와의 차이**
> - §3.4 는 **요약** (job 메타, 단계 상태, severity 집계, verdict) 만 반환
> - §3.9 는 **상세** (개별 finding 1건 1건의 CVE/파일경로/AI 제안 등) 를 반환
> - 결과 페이지에서는 보통 두 API를 같이 호출 (요약 + 상세)

**요청**
- Header: `Authorization: Bearer <token>`
- Query (선택): `?severity=critical,high` — 등급 필터, `?limit=100&offset=0` — 페이징

**응답 200**
```json
{
  "job_id": "job_01H...",
  "repo_url": "https://github.com/octocat/hello-world",
  "branch": "main",
  "completed_at": "2026-05-23T10:03:21Z",

  "scores": {
    "security_score": 62,
    "code_quality_score": 75
  },

  "verdict": {
    "overall_status": "warning",
    "status_reason": "1 critical, 4 high findings detected",
    "total_findings": 61
  },

  "severity_summary": {
    "critical": 4,
    "high": 11,
    "medium": 19,
    "low": 27
  },

  "scanner_summaries": [
    { "scanner": "semgrep",  "count": 50, "critical": 4, "high": 9, "medium": 15, "low": 22 },
    { "scanner": "gitleaks", "count": 8,  "critical": 0, "high": 2, "medium": 3,  "low": 3  },
    { "scanner": "trivy",    "count": 3,  "critical": 0, "high": 0, "medium": 1,  "low": 2  }
  ],

  "findings": [
    {
      "id": "uuid",
      "scanner": "semgrep",
      "rule_id": "python.sql-injection",
      "cve": null,
      "cvss": null,
      "title": "SQL Injection",
      "severity": "critical",
      "file_path": "app/db.py",
      "line_start": 42,
      "line_end": 42,
      "code_snippet": "query = f\"SELECT * FROM users WHERE id={user_id}\"",
      "code_snippet_start_line": 40,
      "description": "SQL 인젝션 취약점",
      "ai_suggestion": "파라미터 바인딩을 사용하세요",
      "references": []
    }
  ],

  "pagination": {
    "total": 61,
    "limit": 100,
    "offset": 0,
    "has_more": false
  }
}
```

**필드 enum / 타입**
- `severity` (findings 내): `critical` | `high` | `medium` | `low`
- `scanner`: `semgrep` | `gitleaks` | `trivy` 등 (자유 문자열, 프론트에서 표시만)
- `scores.*`: 0~100 정수
- `cvss`: 문자열 (e.g. `"7.5"`) — 점수와 별개로 원본 표기 보존
- `line_start`, `line_end`: 1-based 줄 번호

**백엔드 내부 동작 (의무)**
1. job 이 종료 상태(`success` / `failed` / `cancelled`) 일 때만 200 반환
2. 진행 중(`queued` / `running`) → `425 Too Early` (또는 200에 `findings: []`)
3. 결과 데이터 출처:
   - **권장**: ubuntu가 스캔 완료 시점에 백엔드 콜백 (§4.6) 으로 push → 백엔드 DB에 저장 → 이 API는 DB에서 조회
   - **대안**: 이 API 요청 시점에 백엔드가 ubuntu의 `/pipeline-result?job_id=X` 를 pull → 응답 가공
4. `ai_suggestion` 은 LLM 호출로 생성 (느릴 수 있음). DB 캐시 권장.

**에러**
- 404: `job_id` 없음
- 425 Too Early: 아직 종료되지 않은 job (스펙 합의 필요, 응답 정책 결정)
- 502/504: ubuntu 호출 실패 (pull 모드 사용 시)

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

### 4.6 백엔드 ← 우분투 결과 콜백 (확정)

우분투 러너는 두 가지 시점에 백엔드로 콜백을 호출함. **단일 엔드포인트**에서 `callback_type` 으로 분기.

```
[Ubuntu Runner] ──HTTP POST──► [Backend]
                POST /get-results
                인증: 없음 (내부 콜백, 외부 노출 금지)
                Header: Content-Type: application/json
```

> ⚠️ `/get-results` 경로는 **외부에 노출되면 안 됨**. 방화벽으로 우분투 IP만 허용하거나, shared secret 토큰을 추가하는 게 안전.

#### 4.6.1 `step_complete` — 단계 종료 시점마다 호출

각 step이 끝날 때마다 우분투가 백엔드에 알림. 백엔드는 DB의 해당 step 레코드를 업데이트.

```json
{
  "job_id": "uuid",
  "callback_type": "step_complete",
  "repo_url": "https://github.com/owner/repo",
  "branch": "main",
  "step": {
    "name": "build",
    "step_name": "build",
    "status": "success",
    "started_at": "2026-05-24T10:00:00Z",
    "finished_at": "2026-05-24T10:01:00Z",
    "duration_secs": 60
  }
}
```

#### 4.6.2 `pipeline_complete` — 파이프라인 전체 종료 시 1회 호출

전체 실행이 끝나면 우분투가 최종 결과 (steps, logs, findings 전부) 를 한 번에 push. 백엔드는 이를 DB에 저장해 §3.9 응답에 사용.

```json
{
  "job_id": "uuid",
  "callback_type": "pipeline_complete",
  "repo_url": "https://github.com/owner/repo",
  "branch": "main",
  "status": "success",
  "started_at": "2026-05-24T10:00:00Z",
  "ended_at": "2026-05-24T10:05:00Z",
  "steps": [
    {
      "name": "build",
      "status": "success",
      "started_at": "2026-05-24T10:00:00Z",
      "finished_at": "2026-05-24T10:01:00Z",
      "duration_secs": 60
    }
  ],
  "logs": [
    "[build.log] Building project...",
    "[lightweight-security.log] [1] rule=aws-access-key | src/config.py:12 | leaked key"
  ],
  "security": {
    "findings": [
      {
        "scanner_name": "gitleaks",
        "severity": "high",
        "rule_id": "aws-access-key",
        "title": "AWS Access Key",
        "file_path": "src/config.py",
        "line_number": 12,
        "message": "Leaked AWS key",
        "code_snippet": "...",
        "code_snippet_start_line": 10,
        "ai_recommendation": "환경변수로 이동하세요"
      }
    ]
  },
  "metadata": {
    "run_id": "run-uuid",
    "job_id": "uuid"
  }
}
```

#### 콜백 데이터와 프론트 API 응답의 매핑

| 콜백 필드 (ubuntu → backend) | 프론트 응답 필드 (§3.9 result) |
|---|---|
| `security.findings[].scanner_name` | `findings[].scanner` |
| `security.findings[].line_number` | `findings[].line_start` (그리고 `line_end` 도 같은 값 또는 별도 계산) |
| `security.findings[].message` | `findings[].description` |
| `security.findings[].ai_recommendation` | `findings[].ai_suggestion` |
| `step.finished_at` | `steps[].ended_at` |
| `ended_at` (pipeline) | `completed_at` |

> 백엔드는 callback 받아서 위 매핑대로 가공해 DB에 저장하면, 프론트가 §3.9 호출할 때 그대로 응답 가능.

---

## 5. 마이그레이션 체크리스트

- [x] 백엔드: §3.1 ~ §3.8 엔드포인트 구현
- [ ] **백엔드: §3.9 `GET /api/jobs/{id}/result` 신규 구현**
- [ ] **백엔드: §4.6 우분투 결과 콜백 — 옵션 A(push) 또는 옵션 B(pull) 선택 후 구현**
- [ ] 백엔드: 우분투 러너 클라이언트 모듈 분리 (`services/ubuntu_runner.py` 등)
- [x] 프론트: API 호출 경로를 명세대로 정리 (v0.8.0)
- [x] 프론트: §3.9 결과 API 연동 — 결과 페이지의 mock 데이터 제거 (v0.9.0, `fetchJobResult`)
- [x] 프론트: 검사 항목 16종 카탈로그 + 등급별 선택 UI, `selected_items`/`environment`/`commit_sha` 전송 (v0.9.0)
- [x] 프론트: 401 자동 재로그인, 409 충돌 다이얼로그 처리 (v0.8.0)
- [ ] 우분투 러너 다운/타임아웃 시나리오 테스트 (502/504 정상 반환 확인)

---

## 6. 합의가 필요한 결정 사항

### 🔥 긴급 — v0.8.0 동작에 직접 영향

1. **§3.4 `GET /api/jobs/{job_id}` 존속 여부**
   - 백엔드 2026-05-24 확정 명세에서 빠짐. 하지만 프론트 진행 페이지 폴링이 이걸로 status/메타데이터를 받음.
   - **3가지 옵션:**
     - (a) 백엔드가 §3.4를 그대로 유지 → 프론트 변경 없음
     - (b) §3.6 `/steps` 응답에 job summary 필드 추가 (status, repo_url, branch, started_at, completed_at, trigger_source) → 프론트 폴링 로직 단순화
     - (c) 별도 `GET /api/pipelines/{id}` (job summary) 신설
   - **추천**: (b) — REST 일관성 + 호출 횟수 감소

2. **`env_vars` 처리** ([src/lib/api.ts:280](../src/lib/api.ts#L280))
   - 프론트는 `SELECTED_CHECKS`, `IS_FIRST_RUN` 을 env_vars 로 전달 중 (선택된 취약점 검사 항목)
   - 백엔드 확정 명세에는 `env_vars` 필드 없음
   - **확인 필요**: 백엔드가 받아서 우분투에 전달하는지? 안 한다면 사용자가 고른 검사 항목이 무시됨.
   - 대안: `POST /api/pipelines` 바디에 `selected_checks: string[]`, `is_first_run: boolean` 등 명시적 필드 추가

3. **`trigger_source` enum**
   - 명세: `manual | webhook | schedule`
   - 프론트 송신값: `windows-api` (커스텀)
   - 백엔드가 그대로 echo 해주는지 / validation 거는지 확인 필요

### ⏳ 기존 합의사항

4. **§3.9 미완료 job 응답**: `425 Too Early` 반환 vs `200` + `findings: []` 반환
5. **AI 제안 (`ai_suggestion`) 생성 시점**: 스캔 종료 직후 일괄 생성 (콜백에 포함됨) vs 결과 페이지 요청 시 lazy 생성
6. **`existing_job_id` 응답 필드**: 409 응답 바디에 기존 실행 중인 `job_id` 포함 — 프론트 다이얼로그의 "취소 후 재실행" 동작에 필수
7. **인증 토큰**: GitHub Access Token 그대로 사용 vs 백엔드 자체 JWT 발급 (현재 백엔드는 자체 JWT 발급 방향으로 진행 중인 듯 — credentials=False 변경)
8. **실시간성**: 폴링 유지 vs SSE/WebSocket 도입 시점
9. **Job 중복 방지**: 같은 repo+branch 동시 실행 허용 여부 → 409 정책 합의 (현재 프론트는 다이얼로그 처리 완료)
