# Pipeline Execution Status — Backend Contract

프론트 파이프라인 실행 화면(`/pipeline/progress`)이 GitHub Actions 수준의 상태 표시를 하기 위해
백엔드에 기대하는 데이터 계약입니다. 프론트는 **백엔드가 보고한 값만** 표시하며, 진행률·소요 시간·
단계 상태를 추정하거나 시뮬레이션하지 않습니다. 값이 없으면 `—`로 표시됩니다.

기존 API 계약은 그대로 유지하며, 아래 항목은 **추가 필드/이벤트**입니다. 이미 같은 의미의 테이블·컬럼이
있다면 새로 만들 필요 없이 해당 값을 응답에 실어 주시면 됩니다.

## 1. 단계 정의 (순서 고정)

| # | 화면 이름 | 기존 `step_type` | 로그 태그 |
|---|---|---|---|
| 1 | Repository Clone | `clone` | `[clone.log]` |
| 2 | Dependency Installation | `install` | `[install.log]` |
| 3 | Vulnerability Scan | `security-light` | `[lightweight-security.log]` |
| 4 | Testing | `test` | `[test.log]` |
| 5 | Deep Security Scan | `security-deep` | `[deep-security.log]` |
| 6 | Security Gate | `security-gate` | `[security-gate.log]` |
| 7 | Build | `build` | `[build.log]` |
| 8 | Deployment | `deploy` | `[deploy.log]` |

프론트는 `step_type` → `step_name` → 위치(8개가 순서대로 올 때) 순으로 단계를 매칭합니다.

## 2. 실행(Execution) 필드

`GET /api/jobs/{job_id}` 의 `job` 객체 (기존 필드 + 추가 필드)

| 필드 | 상태 | 비고 |
|---|---|---|
| `job_id`, `repo_url`, `branch`, `status`, `started_at`, `completed_at`, `duration_secs`, `trigger_source` | 기존 | |
| `commit_sha` | **추가** | 헤더 Commit 표시. 없으면 clone 로그의 `HEAD is now at <sha>`를 사용 |
| `triggered_by` | **추가** | 실행한 사용자 login 또는 webhook 발신자 |
| `current_stage`, `total_stages`, `completed_stages` | 권장 | 히스토리 API에는 이미 `completed_steps/total_steps` 존재 |

`status` 값: `queued` · `running` · `success` · `failed` · `cancelled`

## 3. 단계(Stage) 필드

`GET /api/pipelines/{job_id}/steps` 의 `steps[]`

| 필드 | 필수 | 비고 |
|---|---|---|
| `step_id`, `step_type`, `step_name` | O | |
| `status` | O | `pending` · `running` · `success` · `failed` · `skipped` · **`cancelled`(추가)** |
| `started_at` | O | 단계가 **실제로 시작될 때** 기록. 실행 중 경과 시간은 이 값 기준으로 계산 |
| `ended_at` (또는 `finished_at`) | O | 종료 시 기록 |
| `duration_secs` | 권장 | `started_at/ended_at`이 있으면 프론트가 계산 |
| `error_message` | 실패 시 O | 실패 사유. 카드의 "Error details"에 그대로 표시 |

실패 정책: 한 단계가 실패하면 이후 실행되지 않은 단계를 `skipped`로 저장해 주세요.
취소 시 실행 중이던 단계는 `cancelled`, 나머지는 `skipped`. (프론트는 Job이 종료됐는데도
`pending/running`으로 남은 단계를 같은 규칙으로 표시하지만, DB에도 동일하게 남겨야 히스토리가 정확합니다.)

## 4. 로그

`GET /api/pipelines/{job_id}/logs` → `{ "lines": string[] }` (기존, 전체 로그)

- 각 줄 앞에 단계 태그 `[<tag>.log]`를 붙여 주세요 (1절 표). 태그가 없는 줄은 "General"로 분류됩니다.
- 줄에 ISO-8601 타임스탬프가 있으면 그대로 표시합니다. 없으면 실시간 수신 시각을 사용하고,
  히스토리에서는 줄 번호를 표시합니다. **가능하면 `2026-11-14T10:00:05Z [build.log] ...` 처럼 시각을 포함**해 주세요.
- 심각도는 줄의 `ERROR`/`WARN`/`DEBUG` 토큰으로 판별합니다(없으면 INFO).

권장(선택): `GET /api/pipelines/{job_id}/steps/{step_id}/logs` — 단계별 로그. 없으면 프론트가 태그로 분류합니다.

## 5. 실시간 이벤트 (기존 WebSocket)

`wss://<api>/api/pipelines/{job_id}/logs/ws` — 연결 후 프론트가 `{"type":"authenticate","token":...}` 전송.
같은 Job을 보는 **모든 연결에 브로드캐스트**해 주세요(여러 사용자/창 동시 모니터링).

| `type` | 상태 | payload |
|---|---|---|
| `log_snapshot` | 기존 | `lines: string[]` (연결 직후 전체 로그) |
| `log_batch` | 기존 | `events: [{ step_name, message, level?, timestamp? }]` — `level`, `timestamp` **추가 권장** |
| `step_complete` | 기존 | (payload 없어도 됨 — 프론트가 steps 재조회) |
| `pipeline_complete` | 기존 | 종료 → 프론트가 최종 상태 재조회 후 연결 종료 |
| `pipeline_started` | 추가 | |
| `stage_started` | 추가 | `step: { step_id, step_type, status:"running", started_at }` |
| `stage_progress` | 추가 | `step: {...}` (선택) |
| `stage_completed` | 추가 | `step: { ..., status:"success", ended_at, duration_secs }` |
| `stage_failed` | 추가 | `step: { ..., status:"failed", ended_at, error_message }` |
| `stage_skipped` | 추가 | `step: { ..., status:"skipped" }` |
| `pipeline_failed` | 추가 | |
| `pipeline_cancelled` | 추가 | |

- 모든 이벤트에 단조 증가하는 `seq`를 넣어 주시면, 재연결 시 중복 이벤트를 프론트가 버립니다.
- 이벤트는 **DB에 상태를 저장한 뒤** 발행해 주세요. 프론트는 이벤트를 받으면 즉시 화면에 반영하고,
  곧바로 REST로 저장된 상태를 다시 읽어 맞춥니다.
- 연결이 끊기면 프론트는 지수 백오프(2s→15s)로 재연결하고, 그동안 REST 폴링(2.5s)으로 화면을 유지하며,
  재연결 직후 전체 상태를 한 번 재동기화합니다.

## 6. 취소

`POST /api/pipelines/{job_id}/cancel` (기존). 실제 실행 프로세스를 중지한 뒤 Job을 `cancelled`,
실행 중 단계를 `cancelled`로 저장하고 응답해 주세요. 프론트는 응답을 받은 뒤 REST로 상태를 다시 읽어
표시합니다(낙관적 업데이트 없음).

## 7. GitHub 커밋 상태 보고 (요청)

Secupipeline은 GitHub Actions가 아니므로, 지금은 GitHub 저장소 화면(커밋 옆 ✓/✗, PR 체크)에
실행 상태가 전혀 보이지 않습니다. 실행 상태가 바뀔 때마다 GitHub Commit Status API로 보고해 주세요.

```http
POST https://api.github.com/repos/{owner}/{repo}/statuses/{commit_sha}
Authorization: Bearer {사용자 GitHub OAuth Access Token}

{
  "state": "pending | success | failure | error",
  "context": "secupipeline",
  "description": "Running: Build (7/8)",
  "target_url": "<Secupipeline 실행 화면 URL 또는 결과 페이지>"
}
```

| 시점 | `state` | `description` 예 |
|---|---|---|
| Job 생성(queued) | `pending` | `Queued` |
| 단계 시작 | `pending` | `Running: Testing (4/8)` |
| 전체 성공 | `success` | `All checks passed (8/8)` |
| 단계 실패 | `failure` | `Failed at Security Gate` |
| 취소 | `error` | `Cancelled` |

- 필요한 스코프: 공개 저장소 `repo:status`, 비공개 저장소 `repo` (현재 authorize URL에 `repo` 포함 → 추가 작업 없음).
- `description`은 최대 140자입니다.
- 웹훅/수동 실행 모두 `commit_sha`가 있을 때 보고합니다.

### 7-0. Details 링크 → 데스크톱 앱 실행 화면 열기

데스크톱 앱은 `secupipeline://pipeline/{job_id}` 링크를 받으면 해당 실행의 진행 화면을 엽니다
(앱이 꺼져 있으면 켜고, 켜져 있으면 앞으로 가져와 이동). `job_id`는 영문/숫자/`-`/`_`만 허용합니다.

GitHub는 `target_url`에 http(s)가 아닌 링크를 넣으면 거부하거나 링크를 표시하지 않을 수 있으므로,
백엔드에 **https 중계 페이지**를 하나 두고 그 주소를 `target_url`로 넣어 주세요.

```http
GET /open/pipeline/{job_id}     (인증 불필요, HTML 응답)
```

```html
<!doctype html><meta charset="utf-8"><title>Secupipeline</title>
<p>Secupipeline 앱에서 실행 화면을 여는 중입니다…</p>
<p><a href="secupipeline://pipeline/{job_id}">앱이 열리지 않으면 여기를 누르세요</a></p>
<script>location.href = 'secupipeline://pipeline/{job_id}'</script>
```

- `target_url` 예: `https://{API 서버}/open/pipeline/9b298878-723d-4215-b530-284b2ee0833c`
- 브라우저가 "Secupipeline을(를) 여시겠습니까?"를 물으면 허용하면 앱이 열립니다.
- `job_id`는 HTML에 넣기 전에 형식을 검증하세요(`^[A-Za-z0-9_-]{1,128}$`).

### 7-1. 단계별 체크 표시 (GitHub Actions처럼 여러 줄)

GitHub의 "All checks have passed / N successful checks" 팝업처럼 **단계마다 한 줄씩** 보이게 하려면,
단계마다 서로 다른 `context`로 상태를 보고합니다. context가 다르면 GitHub는 각각을 별도 체크로 표시합니다.

| 단계 | `context` |
|---|---|
| 1 | `Secupipeline / 1. Repository Clone (push)` |
| 2 | `Secupipeline / 2. Install Dependencies (push)` |
| 3 | `Secupipeline / 3. Lightweight Security Scan (push)` |
| 4 | `Secupipeline / 4. Test (push)` |
| 5 | `Secupipeline / 5. Deep Security Scan (push)` |
| 6 | `Secupipeline / 6. Security Gate (push)` |
| 7 | `Secupipeline / 7. Build (push)` |
| 8 | `Secupipeline / 8. Deploy (push)` |

수동 실행이면 `(push)` 대신 `(manual)`을 붙입니다.

| 시점 | 대상 context | `state` | `description` 예 |
|---|---|---|---|
| Job 생성 | 8개 전부 | `pending` | `Queued` |
| 단계 시작 | 해당 단계 | `pending` | `Running…` |
| 단계 성공 | 해당 단계 | `success` | `Successful in 1m 05s` |
| 단계 실패 | 해당 단계 | `failure` | `Failed in 12s` (오류 요약 가능) |
| 실패/취소 후 남은 단계 | 나머지 단계 | `error` | `Skipped` / `Cancelled` |

- 결과 예: 모두 성공하면 커밋 옆에 ✓, 팝업에 "All checks have passed — 8 successful checks"가 표시됩니다.
- `target_url`은 단계마다 같은 실행 결과 URL을 넣으면 됩니다(각 줄의 "Details" 링크).
- 아이콘은 GitHub가 정하므로 Actions 로고와는 다르게 보입니다(Statuses API 한계). GitHub Actions와 완전히 같은 모양(Checks 탭, 소요 시간 자동 표시)은 **Checks API**가 필요한데, 이 API는 **GitHub App 설치 토큰**으로만 호출할 수 있어 현재 OAuth 토큰으로는 불가합니다.
- 상태 보고 실패가 파이프라인 실패로 이어지지 않도록, 호출 오류는 로그만 남깁니다.

## 8. 백엔드 검증 시나리오

- [ ] 8단계 전체 성공 → `success`, 8/8
- [ ] 각 단계(1~8)별 실패 → 해당 단계 `failed` + `error_message`, 이후 단계 `skipped`, Job `failed`
- [ ] 실행 중 취소 → 프로세스 실제 종료, 실행 중 단계 `cancelled`
- [ ] 실행 중 새로고침 → `started_at` 기준으로 경과 시간이 이어짐
- [ ] WebSocket 끊김/복구 → 중복 로그 없음(`seq`), 상태 재동기화
- [ ] 두 사용자가 같은 Job을 동시에 조회 → 양쪽 모두 실시간 갱신
- [ ] push 직후 GitHub 커밋 옆에 `secupipeline` 상태가 pending → success/failure로 표시
