# v0.13.0 업데이트 내역

> **기준**: `c03bc7b` (v0.12.1) → 현재
> **요약**: 원격 v0.12.1을 pull·머지한 뒤, 취약점 카탈로그 14종 축소·결과 다운로드(CSV/XLSX/JSON/PDF 보고서)·라이트모드 전면 보강·로그인 CORS 회귀 수정

---

## 주요 변경점

### 1. 취약점 카탈로그 16종 → 14종 (Semgrep 정적 탐지 가능 항목만)
- [securityCatalog.ts](../src/data/securityCatalog.ts)에서 **IDOR(CWE-639)**, **Weak Password Requirements(CWE-521)** 제거
  - 두 항목은 인가/정책 로직형이라 Semgrep 패턴 매칭으로 신뢰성 있게 탐지 불가
- 남은 14종: Critical 4 · High 3 · Medium 4 · Low 3
- 잔존 "16개" 하드코딩 문구를 동적(`securityCheckCatalog.length`)·중립("정책 항목 외")으로 정리 ([PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx), [api.ts](../src/lib/api.ts))

### 2. 결과 다운로드 모달 (CSV · XLSX · JSON · 커스텀 PDF 보고서)
- 동작 없던 "결과 다운로드" 버튼에 모달 연결 ([PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx))
- 신규 [ResultDownloadDialog.tsx](../src/components/ResultDownloadDialog.tsx) · [reportExport.ts](../src/lib/reportExport.ts)
  - **CSV**: 탐지 항목 표 (UTF-8 BOM, 엑셀 한글 호환)
  - **XLSX**: SheetJS(`xlsx`) — 요약/탐지항목 2시트, 동적 import로 지연 로딩(별도 청크)
  - **JSON**: 구조화 리포트
  - **커스텀 보고서(PDF)**: 브랜드 헤더·등급별 카드·범위 내/밖 findings 표를 담은 자체 양식
- **Electron PDF 생성**: 인쇄창 미리보기 미지원 문제를 해결 — 메인 프로세스 `printToPDF`로 실제 PDF를 생성·저장·열기 ([main.cjs](../electron/main.cjs) `report:save-pdf`, [preload.cjs](../electron/preload.cjs) `desktop.report.savePdf`, [desktop.d.ts](../src/types/desktop.d.ts)). 브라우저에서는 iframe 인쇄로 폴백

### 3. 라이트모드 전면 보강 ([index.css](../src/index.css))
- **버튼/리스트 호버**: 라이트모드에 hover/active 오버라이드가 전무해 호버 시 어두운색으로 뒤집히던 문제 해결 — 중립 hover(`hover:bg-[#262626]`/`gray-600/65~75`/`white/3~5` 등)를 라이트 그레이로 매핑
- **보더**: 과한 검은 테두리(`--app-border: #000000`)를 **부드러운 회색 hairline(`#e5e7eb`)**으로 변경. `gray-500*`·`white/10~20` 등 누락 보더 보강
- **라벨/텍스트**: `text-gray-400/500`, `hover:text-white/gray-100/[#D1D5DB]` 등 누락분 가독성 색으로 매핑
- **다크 배너 배경**: amber/orange/blue 다크 틴트를 라이트 틴트로 (짝 텍스트도 어둡게)
- **아이콘 라이트 대응**: 녹색 배지/칩 배경은 연녹색 틴트로, 녹색 아이콘/액센트(`green-300/400`·`#34D399`·`#3ECF8E`·`#6EE7B7`·`#A7F3D0`·`#D1FAE5`)는 진녹색으로, cyan/indigo 액션 아이콘도 어둡게. 터미널 목업·솔리드 CTA는 의도적 제외

### 4. 로그인 CORS 회귀 수정
- dev에서 API 호출이 백엔드 절대 URL로 직접 나가 **CORS 차단**되던 문제 수정
- [AuthContext.tsx](../src/contexts/AuthContext.tsx)·[api.ts](../src/lib/api.ts)의 `API_BASE`를 프로토콜 기반 분기로 복원: `file:`(패키지)는 절대 URL, dev(`http:`)는 **vite 프록시(`/api-proxy`)** 경유로 CORS 회피
- `fetchPipelineSteps` 응답을 `{ steps, job }`(`PipelineStepsResponse`)으로 확장

### 5. 버전
- `0.12.1` → **`0.13.0`**
