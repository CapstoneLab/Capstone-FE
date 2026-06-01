# v0.10.1 업데이트 내역

> **기준**: `0b3123a` (v0.10.0) → 현재
> **변경 파일**: 1개 (코드) + 버전/문서

---

## 변경 사항

### 파이프라인 시작 엔드포인트 변경 (백엔드 요청)
- `POST /api/pipelines` → **`POST /start-pipeline`** ([src/lib/api.ts](../src/lib/api.ts) `startPipeline`)
- 취소/로그/단계(`/api/pipelines/{id}/cancel|logs|steps`)는 변경 없음

### 실 API 검증 결과 (api.pwd.kr)
새 도메인에 직접 붙여 경로를 점검했고, 다음을 확인:
- `GET /api/security/catalog` → 200, `GET /api/approvals`·`/api/jobs/{id}/result` → 401(인증 필요), `/api/pipelines/{id}/logs·steps` → 200 ✅
- `POST /start-pipeline` → 422(존재, body 검증) ✅
- GitHub 로그인: 노션의 `/auth/github`는 404였고 **기존 `/auth/github/login`이 GitHub OAuth로 정상 리다이렉트(302)** → 경로 유지(되돌림)

### 버전
`v0.10.0` → `v0.10.1`

---

## ⚠️ 백엔드 확인 필요 (프론트 영역 아님)

1. **`/start-pipeline` 인증**: 잘못된 토큰으로도 401이 아닌 422 응답 → JWT 인증을 안 거치는 것으로 보임. 프론트가 JWT로 호출할 시작 엔드포인트가 `/start-pipeline`이 맞는지 확인 필요. (틀리면 `/api/pipelines`로 즉시 복구 가능)
2. **OAuth redirect_uri**: `/auth/github/login`의 redirect_uri가 아직 옛 EC2 주소(`http://ec2-54-221-222-244.../auth/github/callback`) → 백엔드 OAuth 설정 + GitHub OAuth 앱 callback URL을 `api.pwd.kr`로 갱신 필요. (IP 노출 + 콜백 경로 문제)
