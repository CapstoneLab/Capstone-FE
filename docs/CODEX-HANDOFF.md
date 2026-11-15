# Codex 인계 — Claude 작업분 (2026-11-15 ~ 11-16)

Capstone-FE: Electron + React 19 + Vite + TanStack Query 데스크톱 앱. 백엔드는 `https://112.186.136.153`.
이 문서는 Claude가 작업한 내용 중 **아직 main에 없는 것**과, 이어서 작업할 때 알아야 할 규칙을 정리합니다.

## 1. 저장소 상태 (가장 먼저 처리)

```
local main  = origin/main(9eb97f8) 기준 + 2커밋, 아직 push 안 함
  e4cbd2b  feat: pipeline-page approval, instant start and update fixes v1.7.4
  14207ca  wip: lagging-result fallback, result cache finality, approval resume
origin/main = 9eb97f8 + Codex 2커밋 (v1.7.5)
  172cf81  fix: distinguish stage duration and synchronize initial pipeline state
  611266d  fix: reopen the same pipeline after signed approval resume
```

**할 일: 로컬 2커밋을 origin/main 위로 rebase하고, 겹치는 부분을 합친 뒤 v1.7.6으로 올린다.**
- 611266d(같은 잡 재개)와 14207ca의 재개 기능(`usePipelineExecution.resume`, `reopenAfterGate`, `ApprovalResponse.resumed`)이 **같은 기능**이다. 한쪽 구현으로 통일한다.
  - 판정 기준: 응답 `resumed` / `resume_from_stage` / `followup_job_id === jobId` 중 하나라도 맞으면 같은 잡을 재개한 것으로 본다.
- 시간 계산은 **Codex 구현(`useServerNow` + `/api/time`, `executionTiming.ts`)이 기준**이다. Claude 쪽에 남아 있는 `estimateClockOffset`, `runStoppedAtMs`, `finishedElapsedSecs`, `timeBreakdown`(`pipelineExecution.ts`)과 테스트(`pipelineTiming.test.ts`)는 페이지에서 쓰지 않는다. 정리하거나 지워도 된다.
- 충돌이 잦은 파일: `PipelineProcessPage.tsx`, `usePipelineExecution.ts`, `PipelineProgressPage.tsx`, `translations.ts`(키 중복 주의), `api.ts`, `package.json`(버전).
- 검증: `npx tsc -b --noEmit`, `npx vitest run`(로컬 기준 127개 통과), `npx eslint src/pages src/hooks src/lib`, `npx vite build`.

## 2. 로컬 2커밋에 들어 있는 기능

### 승인 (서버 판정이 기준)
- 승인 가능 여부는 **서버의 `result.approval_eligible`**로 정한다(9eb97f8 방침 유지). 개수 규칙으로 사후 승인을 만들지 않는다.
- **진행 화면(`PipelineProcessPage`)에서 승인한다.**
  - 승인 대기면 승인 창을 자동으로 한 번 연다.
  - 06 보안 게이트 카드의 오류 상세 아래에 [배포 승인 검토] 버튼을 둔다(`StageCard`의 `action`).
  - 실행 요약의 실패 사유 아래에 [승인 요청]을 둔다.
  - 승인 불가면 서버의 `approval_reason`을 표시한다.
- 결과 화면은 승인 창을 **자동으로 열지 않는다**(버튼만 있음). 사용자 요구사항이다.
- `decideApproval()`(`api.ts`): approve/reject가 `404 Pending approval not found`이면 `/approval/request` 후 한 번 재시도한다. 409는 무시한다. 백엔드도 404를 고쳤지만 안전장치로 둔다.
- **서명 승인**: "보안책임자·팀리드 권한", "본인 승인 금지" 문구는 전부 제거됐다. 입력란은 "승인자 서명 — 이름(필수)"이고 `approver_name`으로 보낸다. 403이 나면 서버의 역할 검사가 남아 있다는 뜻으로 안내한다(`docs/approval-signature-handoff.md`).
- `DeployApprovalDialog`
  - 결과에 개수만 있고 findings가 비면 게이트 차단 사유(`reasons`)를 대신 보여준다.
  - 같은 잡이 재개되면 `onResumed()`를 부르고 창을 닫는다.

### 결과가 늦게 저장되는 문제 (14207ca)
- 실행이 끝난 직후 `/api/jobs/{id}/result`가 "통과, 0건"으로 올 수 있다. 예전 캐시는 이를 영구 저장했다(**버그**).
- `resultStaleTime`(`useJobQueries.ts`): 판정이 있고, `completed_at`이 있고, 완료 후 10분이 지난 결과만 `Infinity`. 그 전에는 15초.
- 영구 캐시 `buster: 'v2'`(`queryClient.ts`): 이전에 잘못 저장된 결과를 버린다.
- `gateVerdictFromSteps()`(`gateMessage.ts`)와 `resultLagsGate()`(`deploymentGate.ts`)로 결과가 게이트 기록보다 늦는지 판단한다.
  - 게이트 단계 오류 메시지가 `BLOCK_*`인데 결과가 pass/0건이면 "결과 지연"으로 본다.
  - 그동안 게이트 기록(판정·개수·점수)을 표시하고, 결과를 5초마다 다시 받는다(`useJobResultQuery`의 `refetchInterval`).

### 시작·진행
- [파이프라인 실행]은 클릭 즉시 `POST /api/pipelines`를 보내고 곧바로 진행 화면으로 이동한다.
  - 진행 화면은 `pendingStartId`로 대기 중인 요청을 받아(`lib/pendingStart.ts`, `PendingStartView`) 잡 id가 오면 그 잡으로 바꾼다.
  - 409와 시작 오류도 진행 화면에서 처리한다.
- 서버 카탈로그를 기다리지 않는다. 사용자가 선택을 건드리지 않았으면 `selected_items: []`(서버가 전체 검사)를 보낸다.
- 완료 개수 = 성공한 단계 + **백엔드가 skipped로 보고한 단계**(`summarizeProgress`).
  - 실패 뒤에 도달하지 못한 단계는 세지 않는다.
  - f790e9a(v1.7.1)는 실패한 실행도 8/8로 셌다. 원격에 이 버그가 아직 남아 있는지 확인할 것.
- 성공했는데 건너뛴 단계가 있으면 "파이프라인 완료 · 건너뜀 N개"로 표시한다.
- 초기 요청 3개(상세·단계·로그)를 기다리지 않고 도착하는 대로 반영한다. 배포 단계가 성공하면 그 즉시 배포 URL을 조회한다.
- 시작 지연 측정(`lib/startTiming.ts`): 클릭 → API 응답 → 화면 표시 → 첫 단계 시작. 진행 화면 하단에 표시하고 localStorage에도 저장한다.

### 백엔드 요청 반영 (8건)
- 409 응답은 `detail.existing_job_id`에서 읽는다(`conflictExistingJobId`).
- 첫 실행 여부는 서버 이력(`fetchLatestRepoHistory`)으로 판단하고, 실제 검사 범위를 안내한다.
- 저장소 목록을 먼저 보여주고, 브랜치는 선택한 저장소 것만 받는다(`['repo-branches', name]`).
- 검사 항목은 모두 서버 카탈로그를 쓴다(`useSecurityCatalog`). 코드에 박힌 14개 목록은 쓰지 않는다.
- 승인 페이지에도 승인 가능 여부를 적용했다.
- 끝난 실행·단계가 "실행 중"으로 되돌아가지 않게 막았다(`keepTerminal`, `applyStepPatch` 가드).

### 업데이터 (`electron/main.cjs`)
- 설치 파일 실행이 Windows 스마트 앱 컨트롤/Defender에 막히면(`spawn UNKNOWN/EACCES/EPERM`) 안내 문구를 띄우고 파일을 탐색기에 표시한다. 앱을 종료하지 않는다.
- 원인은 릴리스가 **코드 서명 없이** 빌드되는 것이다(`signAndEditExecutable=false`). 근본 해결은 서명 도입이며, 이건 팀이 결정할 사항이다.

## 3. 백엔드 요청 문서 (docs/)
| 문서 | 내용 | 상태 |
|---|---|---|
| `approval-signature-handoff.md` | 역할 검사·본인 승인 금지 제거, `approver_name` 서명 필수 | **백엔드 반영 완료**(2026-11-16, 사용자 확인) — 실제 승인으로 검증 필요 |
| `approval-resume-handoff.md` | 승인 시 같은 잡을 빌드부터 재개, `resumed`/`resume_from_stage` 계약 | **백엔드 반영 완료**(2026-11-16, 사용자 확인). 프론트는 611266d·로컬 커밋 둘 다 구현 → 통합 필요 |
| `deploy-timing-subpath-handoff.md` | 단계 밖 대기 약 75초, 서비스 하위 경로·리다이렉트 | 경로 문제는 서버에서 해결됨 |

## 4. 사용자 선호·작업 규칙
- 답변은 **한국어**로 한다.
- 승인은 **파이프라인 진행 화면**에서 한다. 결과 화면에서 승인 창이 자동으로 뜨면 안 된다.
- 권한·역할 개념을 만들지 않는다. 이름으로 서명하면 누구나 승인할 수 있다.
- push는 사용자가 명시적으로 요청할 때만 한다. 버전은 push 직전 `origin/main`보다 높게 올린다(Claude와 Codex가 병렬로 push해서 번호가 자주 겹쳤다).
- 커밋 작성자는 기존 커밋과 같게 `태현 <78199616+NekoNyangYee@users.noreply.github.com>`. 전역 git 설정이 없으므로 `git -c user.name=… -c user.email=…`로 지정한다.

## 5. 개발 환경 함정
- 개발 실행: `Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run dev`. VS Code 셸이 `ELECTRON_RUN_AS_NODE=1`을 물려주면 Electron이 Node로 실행돼 죽는다. 동시에 하나만 띄운다.
- 앱이 단일 인스턴스 잠금을 쓴다. **설치된 Secupipeline이 켜져 있으면 개발 앱이 바로 종료된다**("clean exit").
- 사용자 PC의 설치본: `%LOCALAPPDATA%\Programs\secupipeline`. 버전은 `resources\app.asar` 안의 `package.json`에서 확인한다.
- 소스 파일 다수가 CRLF다. 정확히 일치시켜 치환하는 스크립트는 `\r\n`을 정규화한 뒤 쓴다.
- `AuthContext`·`queryClient`·`main.tsx`를 수정하면 핫 리로드가 Provider를 꼬아 `useAuth must be used within AuthProvider`가 날 수 있다. 앱을 다시 시작하면 해결된다.
- 기존부터 있던 lint 오류: `components/visual/Aurora.tsx`, `SoftAurora.tsx`, `contexts/*Context.tsx`(react-refresh 규칙).
- OneDrive 폴더라 `git gc`/repack이 `mmap failed`로 실패할 수 있다. 무해하다.

## 6. 미확인·다음 단계
1. 1절의 rebase와 통합, v1.7.6 정리.
2. 실제 실행으로 확인할 것(sample_java6 = `jongha021229/sample_java6`, High 1건 CWE-502로 승인 필요가 나오는 샘플):
   - 진행 화면 승인 버튼과 창이 뜨는지
   - 서명 승인이 403 없이 되는지
   - 같은 잡이 빌드부터 재개되는지
   - 결과 화면이 게이트 기록과 일치하는지(지연 안내가 사라지는지)
3. 결과 지연 안내가 계속 사라지지 않으면 서버 `/result`가 해당 잡에 빈 결과를 계속 돌려주는 것이다. 백엔드 버그로 보고한다.
4. 코드 서명(Azure Trusted Signing 등)을 도입할지 팀이 결정해야 한다.
