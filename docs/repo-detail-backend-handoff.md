# 레포지토리 상세 페이지 — 백엔드 요청 사항

대상 화면: 레포지토리 상세(`/repository/:repoId`)의 **도메인 주소** 카드, **파이프라인 최근 상태** 카드.

## 프론트에서 바뀐 점 (참고)

- 최근 실행은 이제 `GET /api/pipelines/history?repo={owner}/{repo}&limit=20`로 조회합니다.
  응답의 `repo_url`에서 `owner/repo`를 뽑아 **정확히 일치하는 항목만** 쓰고,
  `created_at` 내림차순 첫 번째를 "최근 실행"으로 봅니다.
  (예전에는 이 기기에서 실행한 job id만 봤기 때문에 웹훅이나 다른 기기에서 돌린 실행은 "보류"로 떴습니다.)
- 그 job은 `GET /api/jobs/{id}`로 상세 조회하고, `steps`가 비어 있으면 `GET /api/pipelines/{id}/steps`를 추가로 호출합니다.
- 실행 중(`queued`/`running`)이면 5초마다 다시 조회합니다.
- 도메인 주소는 두 줄로 나눠서 표시합니다.
  1. **SecuPipeline 배포**: 최근 실행의 `GET /api/pipelines/{id}/deployment`를 조회하고, URL이 없으면 최근 **성공** 실행의 deployment를 조회합니다.
  2. **외부 배포**: 사용자가 직접 입력한 URL을 쓰고, 입력값이 없으면 GitHub 저장소의 `homepage`를 씁니다. 직접 입력한 값은 지금은 localStorage에만 저장됩니다.

## 요청 사항

### 1. 파이프라인 히스토리 (필수)

`GET /api/pipelines/history?repo=...&limit=&offset=`

- `repo`에 `owner/repo` 형식의 full name을 넣었을 때 해당 레포의 실행이 조회돼야 합니다. 대소문자 무시, `repo_url` 부분 일치면 충분합니다.
- **웹훅으로 실행된 것을 포함해**, 사용자에게 보이는 모든 실행이 나와야 합니다.
- 정렬: `created_at DESC`.
- 가능하면 항목마다 `repo_full_name`(`owner/repo`)을 추가해 주세요. 지금은 프론트가 `repo_url`에서 파싱하고 있습니다.

### 2. 실패 지점과 사유 (필수)

`GET /api/jobs/{id}`(또는 `GET /api/pipelines/{id}/steps`)의 `steps[]`:

- 실패한 step은 `status: "failed"`여야 합니다.
- **`error_message`를 반드시 채워 주세요.** 실제 원인(예: `npm test exited with code 1`, stderr 마지막 몇 줄)이면 됩니다. 비어 있으면 화면에는 "실패 사유가 보고되지 않았습니다"만 표시됩니다.
- `step_type`은 기존 계약(`docs/pipeline-execution-backend-contract.md`)의 8단계 식별자(`clone`, `install`, `lightweight-security`, `test`, `deep-security`, `security-gate`, `build`, `deploy`)를 써 주세요. 프론트는 이 값으로 "N단계에서 실패"를 판단합니다.
- step이 하나라도 실패하면 job의 `status`도 `failed`여야 합니다.

### 3. SecuPipeline 배포 URL (필수)

`GET /api/pipelines/{id}/deployment`

- deploy 단계가 성공했다면 다음 형식으로 응답해 주세요.
  ```json
  { "deployment": { "url": "https://...", "status": "active", "deployed_at": "2026-11-15T07:00:00Z" } }
  ```
- 배포되지 않은 job이면 `404`를 주거나 `{ "deployment": null }`로 응답해 주세요.
- 이 endpoint가 없거나 비어 있으면 "아직 이 서비스로 배포하지 않음"으로 표시됩니다. 지금 화면이 이 상태입니다.

### 4. 외부 배포 URL을 서버에 저장 (권장)

지금은 직접 입력한 외부 URL이 브라우저 localStorage에만 있어서 다른 기기나 재설치 후에는 사라집니다.

- `GET /api/repos/{owner}/{repo}/deployment-settings` → `{ "external_url": "https://..." | null }`
- `PUT /api/repos/{owner}/{repo}/deployment-settings` body `{ "external_url": "https://..." | null }`
- 서버에서 http(s) URL인지 검증해 주세요.

API가 생기면 프론트에서 localStorage 대신 이 API를 쓰도록 바꾸겠습니다.

### 5. `/api/repos` 응답에 `homepage` 포함 (권장)

GitHub repo 객체의 `homepage` 필드를 그대로 넘겨 주세요. 지금은 프론트가 GitHub API를 인증 없이 직접 호출해서 가져오는데, 이 방식은 public 레포만 되고 시간당 60회 rate limit이 있습니다.

### 6. (선택) 한 번에 조회하는 요약 API

호출 수를 줄이고 싶다면 아래 하나로 1~3번을 대체할 수 있습니다.

`GET /api/repos/{owner}/{repo}/summary`
```json
{
  "latest_run": { "job_id": "...", "status": "failed", "branch": "main", "created_at": "...",
                  "failed_step": { "step_type": "test", "error_message": "..." } },
  "latest_success_job_id": "...",
  "deployment": { "url": "https://...", "job_id": "...", "deployed_at": "..." },
  "external_url": "https://..."
}
```

---

# 결과 페이지: 탐지된 취약점 한국어화 요청

대상 API는 `GET /api/jobs/{id}/result`의 `findings[]`입니다. 지금은 `title`, `description`, `ai_suggestion`에 스캐너(Semgrep) 원문이 영어로 들어옵니다.
프론트는 한국어 모드에서 CWE와 정책 항목을 기준으로 한국어 설명을 대신 보여주고 있습니다. 다만 이 설명은 항목별 고정 문구라 개별 탐지 내용을 반영하지 못합니다.

요청 사항 (선택, 있으면 프론트가 우선 사용):
- finding마다 `title_ko`, `description_ko`, `ai_suggestion_ko` 필드를 추가해 주세요.
- 특히 **AI 수정 제안은 한국어로 생성**해 주세요(`ai_suggestion_ko`). 영어 제안은 한국어 모드에서 "원문 보기" 안으로 숨겨집니다.
- `cwe`는 항상 `CWE-숫자` 형식으로 넣어 주세요. 프론트의 한국어 설명은 이 값으로 매칭합니다.
