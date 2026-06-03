# v0.10.5 업데이트 내역

> **기준**: `4acdf8a` (v0.10.4) → 현재
> **변경 파일**: 1개 (코드) + 문서 + 버전
> **주제**: 결과 화면 — 등급별 취약점 차트 0 표시 버그 수정, 라이트 모드 배포 게이트 배너 가독성 개선

---

## 1. 변경 사항 ([PipelineProgressPage.tsx](../src/pages/PipelineProgressPage.tsx))

### 1.1 "등급별 취약점 (검사 범위 기준)" 차트가 0으로 뜨는 버그 수정
- 기존: `counts = vd?.counts ?? result?.severitySummary ?? ...` — `??`는 `vd.counts`가 **존재하면**(전부 0이어도) 거기서 멈춤. 백엔드가 in-scope counts를 0 또는 다른 필드명으로 주면 findings가 있어도 차트가 0.
- 수정: `vd.counts`는 **합계 > 0일 때만** 사용. 0/누락이면 **실제 in-scope findings를 직접 카운트**("검사 범위 기준"의 ground truth), 그다음 `severitySummary` → `detail.severityCounts` 순 폴백.

### 1.2 라이트 모드 배포 게이트 배너 가독성 개선
- 배너 tone 클래스가 다크 모드 전용(`bg-...#7C2D12/30` 반투명 어두운 틴트 + 연한 텍스트). 흰 카드 위에선 연한 파스텔 배경 + 연한 텍스트 = 대비 부족(글씨 안 보임).
- 라이트 모드용 tone 맵 신규(`toneBannerClassLight` / `toneTitleClassLight` / `toneMsgClassLight`): pastel-100 솔리드 배경 + 700/800 진한 텍스트.
- `useTheme().resolvedTheme`로 라이트/다크 분기. 다크 모드 외형은 변동 없음.

---

## 2. 버전

`v0.10.4` → `v0.10.5`
- [package.json](../package.json):4, [package-lock.json](../package-lock.json):3, 9
