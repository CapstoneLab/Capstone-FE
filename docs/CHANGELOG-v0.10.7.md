# v0.10.7 업데이트 내역

> **기준**: `e2f05e7` (v0.10.6) → 현재
> **변경 파일**: 1개 (코드) + 문서 + 버전
> **주제**: 결과 화면 — 검사 항목 매칭 robust화, 감점 내역 토글 제거

---

## 1. 변경 사항 ([PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx))

### 1.1 검사 항목이 "미검사"로 뜨던 문제 재수정
- v0.10.6의 key/CWE 매칭으로도 안 맞는 케이스가 있어, `selected_items`가 catalog key(`sql-injection`)·표시명(`SQL Injection`)·CWE id(`CWE-89`)·숫자(`89`) 등 **어떤 형식이든** 매칭되도록 영숫자 정규화 매처로 교체.
- `normToken`(영숫자만 소문자), `cweKey`(숫자만 뽑아 `cwe89` 통일) 헬퍼 추가. catalog 항목은 id·cwe·표시명 후보 토큰으로 비교.

### 1.2 감점 내역 토글 제거
- 보안 점수 카드의 `감점 내역`(score_breakdown) 접기 섹션 삭제.

---

## 2. 백엔드 연계 (이번 릴리스 기준 수정 완료 통보 받음)
- `scores.code_quality_score` 실제 계산값 반영 (프론트는 표시만 — 변경 없음)
- result `selected_items` 형식/위치 정합
- verdict in-scope counts·score를 findings 기준으로 채워 전송

---

## 3. 검증
- `npx tsc -b` → 통과
- `npx eslint` (변경 파일) → 통과

---

## 4. 버전
`v0.10.6` → `v0.10.7`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9
