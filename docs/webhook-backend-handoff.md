# GitHub Webhook Backend 연동 요청서

프론트 대시보드의 저장소 `탐지` 토글과 GitHub push 기반 자동 파이프라인 실행을
연결하기 위한 백엔드 구현 요청서입니다.

## 1. 프론트가 호출하는 API

### 웹훅 상태 변경

```http
PUT /api/repos/{owner}/{repo}/webhook
Authorization: Bearer {application_jwt}
Content-Type: application/json
```

요청 본문:

```json
{
  "enabled": true,
  "events": ["push"]
}
```

`enabled: true`이면 GitHub 저장소에 push 웹훅을 등록하거나 기존 웹훅을 갱신합니다.
`enabled: false`이면 해당 웹훅을 비활성화하거나 삭제합니다.

성공 응답:

```json
{
  "enabled": true,
  "url": "https://api.example.com/webhooks/github/123",
  "events": ["push"]
}
```

### 웹훅 상태 조회

```http
GET /api/repos/{owner}/{repo}/webhook
Authorization: Bearer {application_jwt}
```

응답 형식은 PUT 성공 응답과 동일합니다.

## 2. GitHub 웹훅 수신

GitHub 저장소에는 다음과 같은 백엔드 공개 HTTPS 주소를 등록해야 합니다.

```http
POST /webhooks/github
X-GitHub-Event: push
X-GitHub-Delivery: {delivery_id}
X-Hub-Signature-256: sha256={hmac}
Content-Type: application/json
```

필수 처리:

1. `X-Hub-Signature-256`을 웹훅 secret으로 검증합니다.
2. `X-GitHub-Delivery`를 저장해 중복 이벤트를 멱등 처리합니다.
3. `X-GitHub-Event`가 `push`가 아니면 파이프라인을 실행하지 않습니다.
4. `repository.full_name`으로 저장소 소유자와 저장소를 확인합니다.
5. `ref`에서 브랜치를 추출합니다. 예: `refs/heads/main` → `main`
6. `after`를 검사 대상 커밋 SHA로 사용합니다.
7. 삭제 이벤트(`after`가 40개의 0`)는 파이프라인을 실행하지 않습니다.

## 3. 웹훅에서 파이프라인 실행

검증된 push 이벤트마다 다음 API를 내부적으로 실행합니다.

```http
POST /api/pipelines
Authorization: Bearer {application_jwt_or_internal_service_token}
Content-Type: application/json
Idempotency-Key: github:{delivery_id}
```

요청 본문:

```json
{
  "repo_url": "https://github.com/owner/repository",
  "branch": "main",
  "trigger_source": "webhook",
  "commit_sha": "0123456789abcdef0123456789abcdef01234567",
  "source": "capstone",
  "environment": "development",
  "workflow_path": null
}
```

`selected_items`는 웹훅 전용 기본 보안검사 정책을 적용하거나, 백엔드 계정/저장소
설정에 저장된 정책을 적용합니다. 웹훅 secret과 GitHub 토큰은 프론트로 반환하면
안 됩니다.

## 4. 권장 응답 코드

### 프론트 API

- `200`: 웹훅 상태 조회 또는 변경 성공
- `401`: 애플리케이션 인증 만료
- `403`: 저장소 권한 부족
- `404`: 저장소 또는 웹훅 설정 없음
- `502`: GitHub API 등록 실패

### GitHub 수신 API

- `202`: 이벤트 접수 및 파이프라인 실행 예약
- `400`: 잘못된 payload
- `401` 또는 `403`: signature 검증 실패
- `409`: 이미 처리한 delivery id

## 5. 프론트 동작

프론트는 다음 파일에서 위 API를 사용합니다.

- `src/lib/api.ts`
  - `setRepositoryWebhook`
  - `fetchRepositoryWebhook`
- `src/pages/DashboardPage.tsx`
  - 저장소 `탐지` 토글
  - 파이프라인 히스토리 자동 갱신

- 탐지 토글은 **토글한 저장소 자신**(`{owner}/{repo}`)에 웹훅을 등록·해제합니다.
- 대시보드 진입 시 사용자의 모든 저장소에 대해 `GET /api/repos/{owner}/{repo}/webhook`을
  동시 4개씩 호출해 토글과 "웹훅 연결됨" 배지를 서버 상태로 맞춥니다.
  웹훅이 없는 저장소는 `200 { "enabled": false }` 또는 `404` 중 하나로 응답하면 됩니다.
  그 외 오류는 "웹훅 상태 확인 불가"로 표시됩니다.
- 실행 기록의 웹훅 배지·필터·새 실행 알림은 `trigger_source`가 `webhook`(또는 `push` 포함)인지로
  판단합니다. 웹훅으로 만든 파이프라인은 반드시 `trigger_source: "webhook"`으로 저장해 주십시오.

대시보드는 실행 중인 파이프라인이 있으면 3초마다, 없으면 10초마다
`GET /api/pipelines/history`를 조회합니다. 따라서 웹훅으로 생성된 파이프라인은
최대 10초 이내에 화면에 표시됩니다.

## 6. 백엔드 완료 확인 목록

- [ ] `GET /api/repos/{owner}/{repo}/webhook` 구현
- [ ] `PUT /api/repos/{owner}/{repo}/webhook` 구현
- [ ] GitHub push 웹훅 등록/갱신/해제 구현
- [ ] signature 검증 구현
- [ ] delivery id 중복 방지 구현
- [ ] push 브랜치와 commit SHA 추출 구현
- [ ] `trigger_source: "webhook"` 파이프라인 실행 구현
- [ ] 동일 저장소·브랜치 실행 중복 정책 적용
- [ ] 웹훅 secret과 GitHub 토큰 비노출 확인
- [ ] push 후 파이프라인이 생성되는 통합 테스트 추가

## 7. GitHub OAuth 권한 필수 설정

웹훅 등록 API가 GitHub API에서 `403`을 반환하면, 프론트 주소 문제가 아니라
백엔드가 보관한 GitHub OAuth Access Token에 저장소 웹훅 권한이 없는 상태입니다.
백엔드의 GitHub authorize URL에 최소한 다음 스코프를 포함해야 합니다.

```text
read:user user:email admin:repo_hook
```

비공개 저장소를 읽거나 파이프라인 대상으로 사용한다면 `repo`도 추가합니다.

```text
read:user user:email repo admin:repo_hook
```

백엔드는 GitHub API 호출 시 애플리케이션 JWT가 아니라 OAuth 교환 결과로 받은
GitHub Access Token을 사용해야 합니다. 토큰 교환 후 `GET https://api.github.com/user`
응답의 `X-OAuth-Scopes` 헤더에 `admin:repo_hook`가 포함되는지 확인하십시오.

기존에 발급된 토큰에는 새 스코프가 자동으로 추가되지 않습니다. 백엔드에서 스코프를
수정한 뒤 사용자는 GitHub의 **Settings → Applications → Authorized OAuth Apps**에서
해당 OAuth 앱의 권한을 철회하고 다시 로그인해야 새 동의 화면이 표시됩니다.
그 다음 다음 요청이 성공해야 합니다.

```http
PUT /api/repos/CapstoneLab/Capstone-FE/webhook
Authorization: Bearer {application_jwt}
```

이 프론트 저장소에는 GitHub OAuth authorize URL을 생성하는 백엔드 코드가 없으므로,
위 스코프를 프론트에서 추가하는 것만으로는 이미 발급된 토큰의 권한을 변경할 수 없습니다.

### 확인 결과 (2026-11-14)

`GET /auth/github/login`의 302 리다이렉트를 확인한 결과, 백엔드는 이미
`scope=read:user user:email repo read:org admin:repo_hook`를 요청하고 있습니다.
따라서 authorize URL 스코프 수정은 완료된 상태이며, 403이 계속되면 다음을 확인합니다.

1. **구 토큰 재사용**: 로그아웃 후 다시 로그인해 새 동의 화면에서 권한을 승인했는지,
   백엔드가 재로그인 시 저장된 토큰을 새 토큰으로 교체하는지.
2. **조직 OAuth 앱 제한**: `CapstoneLab` 조직이 OAuth App access restrictions를 켜 두었다면
   조직 Owner가 **Organization Settings → Third-party access → OAuth app policy**에서
   이 앱을 승인해야 합니다. GitHub 응답 메시지에 "organization has enabled OAuth App access
   restrictions"가 포함됩니다.
3. **저장소 Admin 권한**: 웹훅 생성은 스코프와 별개로 로그인한 계정이 해당 저장소의
   Admin 권한을 가져야 합니다.
4. **백엔드 에러 전달**: GitHub 응답의 `message`를 `detail`로 그대로 반환해 주십시오.
   프론트는 이 값을 화면에 그대로 표시합니다.
