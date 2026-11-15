# 승인 후 멈춘 지점부터 재개 — 백엔드 변경 요청

작성일: 2026-11-16

## 현재 동작

보안 게이트가 `BLOCK_PENDING_APPROVAL`로 잡을 멈춘 뒤 승인하면, 서버가 **후속 잡(`followup_job_id`)을 새로 만들어
클론부터 8단계를 전부 다시 실행**합니다. 클론·설치·테스트·보안 검사가 반복되어 시간이 오래 걸리고,
같은 커밋을 다시 스캔하므로 결과도 달라질 수 있습니다.

## 원하는 동작

승인하면 **같은 잡이 멈춘 지점부터 이어서** 실행됩니다.

```
01 클론 ✓ → … → 06 보안 게이트 ✗(승인 대기) ──승인──▶ 07 빌드 → 08 배포
```

- 클론~보안 게이트는 다시 실행하지 않습니다(같은 작업 공간·커밋·스캔 결과 재사용).
- 보안 게이트 단계는 "승인됨"으로 기록합니다(`status: success`, `error_message`에 승인자/사유 요약).

## API 계약

### `POST /api/jobs/{id}/approval/approve` 응답

```json
{
  "status": "approved",
  "resumed": true,
  "resume_from_stage": "build",
  "job_id": "<같은 잡 id>",
  "acknowledged_cwes": ["CWE-502"],
  "message": "승인되어 빌드부터 재개합니다"
}
```

- `resumed: true`이고 `resume_from_stage`가 있으면, 프론트는 **같은 실행 화면에서 그대로 추적**합니다.
- 하위 호환: `followup_job_id`를 계속 쓴다면 **같은 잡 id**를 넣어 주세요. 프론트는 이것도 "재개"로 처리합니다.
  다른 id를 주면 지금처럼 새 잡 화면으로 이동합니다.

### 잡 상태 전이

| 시점 | 잡 `status` | 단계 |
|---|---|---|
| 게이트에서 멈춤 | `failed` (또는 `awaiting_approval`) | 07·08 `skipped` |
| 승인 직후 | **`running`** | 06 `success`, 07·08 **`pending`**, `completed_at = null` |
| 빌드·배포 진행 | `running` | 07 → 08 순서로 `running` → `success`/`failed` |
| 끝 | `success` / `failed` | `completed_at` 갱신, `duration_secs`는 재개 구간까지 포함 |

### 실시간 채널

- `/api/pipelines/{id}/logs/ws`는 **같은 잡 채널**로 재개 구간의 `stage_*`, `log_batch`, `pipeline_*` 이벤트를 계속 보내 주세요.
- 이벤트 `seq`는 이전 값에 이어서 증가해야 합니다(프론트가 `after_seq`로 이어 받습니다).
- 재개 시작 시 `pipeline_resumed`(또는 `pipeline_started`) 이벤트를 한 번 보내 주세요.

### 결과·배포

- `GET /api/jobs/{id}/result`는 같은 스캔 결과를 유지하고, `approval_eligible`은 `false`, `acknowledged_cwes`는 승인 항목으로 갱신해 주세요.
- `GET /api/pipelines/{id}/deployment`는 재개 구간의 배포 결과를 반환해 주세요.

## 프론트 반영 상태 (v1.7.4)

- 응답의 `resumed` / `resume_from_stage` / `followup_job_id == job_id`를 읽어 같은 잡을 다시 실시간 추적합니다.
  이때 07·08을 대기로 돌리고, 폴링과 WebSocket을 다시 엽니다.
- 백엔드가 아직 새 후속 잡을 만드는 동안에는 지금처럼 후속 잡 화면으로 넘어갑니다.
