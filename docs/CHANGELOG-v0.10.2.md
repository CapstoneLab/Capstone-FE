# v0.10.2 업데이트 내역

> **기준**: `c3107ab` (v0.10.1) → 현재
> **변경 파일**: 2개 (코드) + 버전/문서
> **주제**: 레포 상세 "소스" 카드의 커밋 메시지 표시 개선

---

## 1. 이전 버전(v0.10.1)과의 차이 요약

| 구분 | v0.10.1 | v0.10.2 (이번) |
|---|---|---|
| 커밋 메시지 조회 | GitHub 직접 호출에 **백엔드 JWT** 첨부 → GitHub이 401 거부 → 못 가져옴 | **인증 없이** 호출 → 공개 레포의 실제 커밋 메시지 표시 |
| 커밋 메시지 폴백 | clone 로그/SHA 추정값까지 폴백 → stale 값(예: "moddak2")이 끼는 문제 | 실제 조회된 커밋만 사용 → 없으면 "커밋 메시지가 없습니다" |
| 빈 메시지 문구 | "(커밋 메시지를 가져오지 못했습니다)" | "커밋 메시지가 없습니다" |

---

## 2. 변경 사항

### 2.1 GitHub 커밋 메시지 조회를 인증 없이 (api.ts)
- [fetchLatestCommit](../src/lib/api.ts)의 GitHub 직접 호출에서 **Authorization 헤더 제거**.
  - 배경: 백엔드가 자체 JWT를 발급하면서, 그 JWT를 GitHub API에 보내면 401로 거부됨.
  - 공개 레포는 GitHub API를 **인증 없이도 200**으로 조회 가능(레이트리밋 60req/hr·IP, CORS 지원) → 실제 커밋 메시지가 표시됨.
  - 비공개 레포는 404 → null → "커밋 메시지가 없습니다"로 자연 degrade. (정상 경로는 백엔드 `/api/repos/{owner}/{repo}/commits/{branch}` 프록시가 생기면 그쪽 사용)

### 2.2 커밋 메시지는 "실제 조회된 커밋"만 사용 (RepositoryDetailPage.tsx)
- [커밋 메시지 계산](../src/pages/RepositoryDetailPage.tsx)을 `latestCommit.message`(GitHub/프록시) → `repo.source.commitMessage` 순으로만 사용.
- clone 로그에서 추출해 localStorage에 캐시한 값(`pipelineInfo.commitMessage`)과 SHA 기반 대체 문구("커밋 {sha}")는 **메시지로 쓰지 않음** → 과거에 캐시된 stale 값이 계속 보이던 문제 해결.
- 실제 메시지가 없으면 **"커밋 메시지가 없습니다"** 표시.

### 동작 결과
- 커밋이 있는 (공개) 레포 → 그 레포의 **실제 최신 커밋 메시지** 표시
- 메시지를 가져올 수 없거나 없는 경우 → **"커밋 메시지가 없습니다"**
- (참고: `moddak2/Samplejavascript2` 테스트 레포는 실제 최신 커밋 메시지가 "moddak2"라, 그대로 "moddak2"가 표시됨 — 정상)

---

## 3. 버전

`v0.10.1` → `v0.10.2`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9

---

## 4. 참고 (변경 없음 / 백엔드 영역)

- 비공개 레포 커밋 메시지 + 완전한 정상 경로는 백엔드의 `/api/repos/{owner}/{repo}/commits/{branch}` 프록시가 필요(현재 404).
- OAuth `redirect_uri`가 아직 옛 EC2 주소를 가리키는 문제는 백엔드 설정 영역(로그인/IP 노출 관련, 별도 처리 필요).
