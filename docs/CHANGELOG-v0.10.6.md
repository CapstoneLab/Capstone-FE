# v0.10.6 업데이트 내역

> **기준**: `dadae50` (v0.10.5) → 현재
> **변경 파일**: 1개 (코드) + 문서 + 버전
> **주제**: 결과 화면(PipelineProgressPage) — 보안 점수 보정, 등급별 차트 검사범위 안/밖 2분할, 검사 항목 매칭, finding 카드 정리(스캐너 배지 제거·제목/설명 분리·복사 기능)

---

## 1. 변경 사항 ([PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx))

### 1.1 보안 점수가 안 깎이는 문제 보정
- 백엔드 점수가 `null`이거나, **in-scope findings가 있는데 100점**(= empty-derived)이면 차트와 동일한 in-scope counts로 `computeSecurityScore` 재계산.
- 정상적으로 깎인 백엔드 점수(예: 94)는 그대로 사용(B-0 존중) — 100/빈 값일 때만 동작하는 안전장치.

### 1.2 등급별 취약점 차트 2분할
- 한 카드 안에서 **위: 검사 범위 기준(in-scope)** / **아래: 검사 범위 밖 기준(out-of-scope)** 으로 분할.
- 각 블록은 도넛 + 등급별 범례 + total. 공통 렌더 `renderSeverityBreakdown` 헬퍼로 추출.
- out-of-scope는 게이트 영향 없음을 라벨로 명시.

### 1.3 검사 항목이 전부 "미검사"로 뜨던 문제
- 원인: 백엔드가 `selected_items`를 CWE id(`CWE-89`)로 echo → catalog key(`sql-injection`)와 매칭 실패.
- 수정: key/CWE 어느 형식이든 대소문자 무시로 매칭(`isItemSelected`). 헤더 카운트도 실제 매칭 항목 수로 표시.

### 1.4 finding 카드 정리
- **스캐너 배지 제거**: 우상단 `semgrep` 등 스캐너 표시 삭제.
- **제목/설명 분리**: 제목은 본문 첫 문장 요약(80자 캡), 설명은 전체 본문. 백엔드가 별도 짧은 title을 주면 우선 사용.
- **복사 기능**: 코드 스니펫·AI 수정 제안에 복사 버튼("복사"→"복사됨"). `file:` 프로토콜(패키지 Electron) 대응 위해 `navigator.clipboard` + `execCommand('copy')` 폴백(`copyToClipboard`).

---

## 2. 검증

- `npx tsc -b` → 통과(타입 오류 없음)
- `npx eslint` (변경 파일) → 통과

---

## 3. 버전

`v0.10.5` → `v0.10.6`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9
