# v0.10.8 업데이트 내역

> **기준**: `862431b` (v0.10.7) → 현재
> **변경 파일**: 1개 (코드) + 문서 + 버전
> **주제**: 결과 화면 — 감점 내역을 토글 제거가 아니라 "항상 펼침"으로 복원

---

## 1. 변경 사항 ([PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx))

- v0.10.7에서 감점 내역 섹션을 통째로 제거했으나, 의도는 **접기 토글만 없애고 내용은 항상 표시**하는 것이었음.
- `<details>/<summary>` 토글을 제거하고 동일한 감점 내역 목록을 항상 펼친 `<div>`로 복원.

---

## 2. 검증
- `npx tsc -b` → 통과
- `npx eslint` (변경 파일) → 통과

---

## 3. 버전
`v0.10.7` → `v0.10.8`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9
