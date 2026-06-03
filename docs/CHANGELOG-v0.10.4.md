# v0.10.4 업데이트 내역

> **기준**: `03a5697` (v0.10.3) → 현재
> **변경 파일**: 1개 (코드) + 문서 + 버전
> **주제**: 파이프라인 시작 엔드포인트 `/start-pipeline` → `/api/pipelines` 전환 (409 중복 실행 방지), 감사 로그 응답 파싱 정합

---

## 1. 변경 사항

### 1.1 파이프라인 시작 엔드포인트 전환 (api.ts)
- `startPipeline`이 `POST /start-pipeline` → **`POST /api/pipelines`** 로 전환 (API 명세 §2-1 권장)
- `/api/pipelines`는 동일 `repo_url`+`branch`에 실행 중인 파이프라인이 있으면 **409 `CONFLICT`** 반환 → 기존 `PipelineConflictError` 처리가 이제 실제 동작
- 409 응답의 `existing_job_id`를 파싱해 기존 실행 중 job으로 안내 (백엔드가 해당 필드 포함하도록 배포 완료)
- error 로그 문자열·JSDoc 주석을 `/api/pipelines` 및 실제 동작(`selected_items`는 catalog key 배열)에 맞게 정리

### 1.2 감사 로그 응답 파싱 정합 (api.ts)
- `GET /api/approvals` 응답이 `{ total, records: [...] }` 형태 → 리스트 추출 키에 `records` 추가
- 승인자 필드 `approver_id`를 `mapApprovalEntry`의 `approver` 매핑에 추가

### 유지된 동작
- `environment` / `trigger_source` / `is_first_run` 필드는 그대로 전송 — 백엔드가 `StartPipelineRequest` 모델에서 정상 수신·저장 확인됨

---

## 2. 백엔드 확인 결과 (정합성)

| 항목 | 결과 |
| --- | --- |
| `/api/pipelines` JWT 인증 | 토큰 없음/만료 시 401 `UNAUTHORIZED` 정상 |
| 정상 응답 | 202 Accepted + `{ job_id, status: "pending", message }` |
| 409 중복 방지 | `existing_job_id` 포함하도록 배포 완료 |
| 추가 필드 | `environment`/`trigger_source`/`is_first_run` 모두 정상 수신·저장 |
| `selected_items` | catalog key 배열(`["sql-injection", ...]`) 형식 확인 |
| `GET /api/approvals` | 존재, JWT 필요, `{ total, records }` 응답 |

---

## 3. 버전

`v0.10.3` → `v0.10.4`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9
