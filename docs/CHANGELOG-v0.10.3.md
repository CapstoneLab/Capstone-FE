# v0.10.3 업데이트 내역

> **기준**: `7938258` (v0.10.2) → 현재
> **변경 파일**: 2개 (코드) + 버전/문서
> **주제**: 레포 상세 "소스/브랜치 목록" — GitHub API로 브랜치 목록·푸시 시각 동기화

---

## 1. 변경 사항

### 1.1 GitHub 레포 메타 조회 추가 (api.ts)
- [fetchGithubRepoExtras(owner, repo)](../src/lib/api.ts) 신규 — 공개 레포 기준 **무인증**으로 GitHub에서 조회:
  - `GET /repos/{o}/{r}/branches?per_page=100` → 브랜치명 목록
  - `GET /repos/{o}/{r}` → `pushed_at`(푸시 시각), `default_branch`
- 두 호출 병렬, 실패 시 해당 필드만 빈값으로 degrade (커밋 메시지 조회와 동일한 무인증 방식)

### 1.2 레포 상세에 반영 (RepositoryDetailPage.tsx)
- **브랜치 목록**: GitHub에서 받은 목록을 우선 표시(없으면 기존 캐시 브랜치 폴백)
- **푸시 시각**: GitHub 레포의 `pushed_at`을 최우선 소스로 사용 → 커밋 작성일(commit date)이 아니라 **실제 마지막 푸시 시각**으로 동기화

### 동작
- 브랜치/푸시 시각이 GitHub의 현재 값과 동기화됨
- 비공개 레포는 무인증 조회 불가(404) → 기존 캐시 값으로 폴백

---

## 2. 버전

`v0.10.2` → `v0.10.3`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9

---

## 3. 참고

- "푸시 시각"은 GitHub의 실제 `pushed_at`을 따른다 — 레포에 새 커밋을 push해야 갱신된다(과거 push가 없으면 그 시점 그대로 표시됨).
- 비공개 레포 동기화는 백엔드 프록시(`/api/repos/.../branches`, `/commits/{branch}`)가 정상 경로(JWT 인증).
