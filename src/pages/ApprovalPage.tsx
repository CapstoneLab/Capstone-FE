import { ArrowLeft, Ban, CheckCircle2, FileClock, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuth } from '@/contexts/AuthContext'
import {
  ApprovalForbiddenError,
  approveJob,
  fetchJobResult,
  rejectJob,
  requestApproval,
  type ApprovalResponse,
  type JobResult,
  type SecurityFinding,
} from '@/lib/api'

type LocationState = {
  jobId?: string
  repoName?: string
  branch?: string
}

export function ApprovalPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState
  const jobId = locationState.jobId ?? ''

  const [result, setResult] = useState<JobResult | null>(null)
  const [isLoading, setIsLoading] = useState(() => !!(jobId && token))
  const [loadError, setLoadError] = useState<string | null>(null)

  const [reason, setReason] = useState('')
  const [selectedCwes, setSelectedCwes] = useState<Set<string>>(new Set())
  const [requested, setRequested] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  // Terminal outcomes of this screen.
  const [approveResult, setApproveResult] = useState<ApprovalResponse | null>(null)
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    if (!jobId || !token) return
    let cancelled = false
    fetchJobResult(token, jobId)
      .then((res) => {
        if (cancelled) return
        setResult(res)
        // C-3 default: pre-select every blocking High CWE (전체 승인 기본).
        if (res) {
          const cwes = res.findings
            .filter((f) => f.inScope && f.severity === 'high' && f.cwe)
            .map((f) => f.cwe as string)
          setSelectedCwes(new Set(cwes))
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '결과를 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [jobId, token])

  const repoName = result?.repoName || locationState.repoName || ''
  const branch = result?.branch || locationState.branch || ''
  const vd = result?.verdictDetail ?? null
  const verdict = vd?.verdict ?? null
  const commitShort = vd?.scannedCommitSha ? vd.scannedCommitSha.slice(0, 12) : null

  // C-3: only in-scope High findings are eligible. Critical is never listed
  // (승인 불가). Dedupe by CWE since approved_cwes is keyed by CWE.
  const highFindings = useMemo(
    () => (result?.findings ?? []).filter((f) => f.inScope && f.severity === 'high'),
    [result],
  )
  const highCweItems = useMemo(() => {
    const byCwe = new Map<string, SecurityFinding>()
    for (const f of highFindings) {
      if (f.cwe && !byCwe.has(f.cwe)) byCwe.set(f.cwe, f)
    }
    return Array.from(byCwe.values())
  }, [highFindings])

  const reasonValid = reason.trim().length > 0
  const allSelected = highCweItems.length > 0 && highCweItems.every((f) => selectedCwes.has(f.cwe!))

  function toggleCwe(cwe: string, checked: boolean | 'indeterminate') {
    setSelectedCwes((prev) => {
      const next = new Set(prev)
      if (checked) next.add(cwe)
      else next.delete(cwe)
      return next
    })
  }

  async function runAction(fn: () => Promise<ApprovalResponse>, onOk: (r: ApprovalResponse) => void) {
    if (!token || submitting) return
    setSubmitting(true)
    setActionError(null)
    setForbidden(false)
    try {
      const res = await fn()
      onOk(res)
    } catch (err) {
      if (err instanceof ApprovalForbiddenError) {
        setForbidden(true)
      } else {
        setActionError(err instanceof Error ? err.message : '승인 처리에 실패했습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequest = () =>
    runAction(
      () => requestApproval(token!, jobId, reason.trim() || undefined),
      () => setRequested(true),
    )
  const handleApproveAll = () =>
    runAction(
      () => approveJob(token!, jobId, reason.trim()),
      (r) => setApproveResult(r),
    )
  const handleApprovePartial = () =>
    runAction(
      () => approveJob(token!, jobId, reason.trim(), Array.from(selectedCwes)),
      (r) => setApproveResult(r),
    )
  const handleReject = () =>
    runAction(
      () => rejectJob(token!, jobId, reason.trim()),
      () => setRejected(true),
    )

  if (!jobId) {
    return (
      <MainLayout>
        <Card className="p-6 text-center text-[#FCA5A5]">
          job_id가 전달되지 않았습니다. 결과 화면에서 다시 진입해 주세요.
        </Card>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => navigate('/dashboard')}>대시보드로</Button>
        </div>
      </MainLayout>
    )
  }

  if (isLoading) {
    return (
      <MainLayout>
        <Card className="flex items-center justify-center gap-3 p-10 text-[#9CA3AF]">
          <Loader2 className="h-5 w-5 animate-spin text-[#34D399]" />
          승인 정보를 불러오는 중...
        </Card>
      </MainLayout>
    )
  }

  if (loadError && !result) {
    return (
      <MainLayout>
        <Card className="border-[#7F1D1D] bg-[#450A0A]/40 p-6 text-center text-[#FCA5A5]">
          {loadError}
        </Card>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => navigate('/pipeline/result', { state: { jobId, repoName, branch } })}>
            결과로 돌아가기
          </Button>
        </div>
      </MainLayout>
    )
  }

  const headerBlock = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[18px] font-bold text-white">배포 승인</p>
        <p className="mt-2 flex items-center gap-2 text-[24px] font-bold leading-none text-white">
          <ShieldCheck className="h-6 w-6 text-[#F97316]" /> {repoName || jobId}
        </p>
        <p className="mt-1 text-[12px] text-[#6B7280]">
          브랜치 {branch || '-'}
          {commitShort ? ` | 스캔 커밋 ${commitShort}` : ''} | ID: {jobId}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-9 border-[#404040] bg-transparent px-3 text-xs text-[#D1D5DB] hover:bg-[#262626]"
          onClick={() => navigate('/approvals')}
        >
          <FileClock className="mr-1.5 h-3.5 w-3.5" /> 감사 로그
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 border-[#404040] bg-transparent px-3 text-xs text-[#D1D5DB] hover:bg-[#262626]"
          onClick={() => navigate('/pipeline/result', { state: { jobId, repoName, branch } })}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> 결과로
        </Button>
      </div>
    </div>
  )

  // C-5: Critical block — approval is impossible, so the screen never offers
  // any approve control (and the backend would 403 anyway).
  if (verdict === 'block') {
    return (
      <MainLayout>
        <section className="w-full space-y-4">
          {headerBlock}
          <Card className="border-[#DC2626] bg-[#7F1D1D]/30 p-6">
            <p className="flex items-center gap-2 text-[16px] font-semibold text-[#FCA5A5]">
              <Ban className="h-5 w-5" /> Critical 차단 — 승인 불가
            </p>
            <p className="mt-2 text-[13px] text-[#FECACA]">
              Critical은 예외 없이 차단됩니다. 코드 수정 후 새 커밋으로 재실행하세요.
            </p>
          </Card>
        </section>
      </MainLayout>
    )
  }

  // Only block_pending_approval enters the approval flow.
  if (verdict !== 'block_pending_approval') {
    return (
      <MainLayout>
        <section className="w-full space-y-4">
          {headerBlock}
          <Card className="border-[#404040] bg-[#262626] p-6 text-center text-[13px] text-[#9CA3AF]">
            이 결과는 승인이 필요한 상태가 아닙니다. (현재 판정: {verdict ?? '알 수 없음'})
          </Card>
        </section>
      </MainLayout>
    )
  }

  // Terminal: approved.
  if (approveResult) {
    return (
      <MainLayout>
        <section className="w-full space-y-4">
          {headerBlock}
          <Card className="border-[#3ECF8E] bg-[#065F46]/30 p-6">
            <p className="flex items-center gap-2 text-[16px] font-semibold text-[#A7F3D0]">
              <CheckCircle2 className="h-5 w-5" /> 승인 처리됨
            </p>
            {approveResult.message ? (
              <p className="mt-2 text-[13px] text-[#D1FAE5]">{approveResult.message}</p>
            ) : null}
            {approveResult.acknowledgedCwes.length > 0 ? (
              <p className="mt-2 text-[13px] text-[#D1FAE5]">
                수용 처리됨: {approveResult.acknowledgedCwes.join(', ')}
              </p>
            ) : null}
            {commitShort ? (
              <p className="mt-2 text-[12px] text-[#A7F3D0]">
                이 승인은 커밋 {commitShort}에만 유효합니다. 새 커밋에 같은 High가 있으면 다시 승인이
                필요합니다.
              </p>
            ) : null}
          </Card>

          {approveResult.followupJobId ? (
            <Card className="border-[#404040] bg-[#262626] p-4">
              <p className="text-[13px] font-semibold text-[#D1D5DB]">후속 파이프라인 추적</p>
              <p className="mt-1 text-[12px] text-[#9CA3AF]">
                승인 후 후속 잡이 자동 실행되었습니다. Job {approveResult.followupJobId.slice(0, 8)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-[#404040] bg-transparent px-3 text-xs text-[#D1D5DB] hover:bg-[#1E1E1E]"
                  onClick={() =>
                    navigate('/pipeline/progress', {
                      state: { jobId: approveResult.followupJobId, repoName, branch },
                    })
                  }
                >
                  후속 진행 보기
                </Button>
                <Button
                  type="button"
                  className="h-8 bg-[#34D399] px-3 text-xs text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
                  onClick={() =>
                    navigate('/pipeline/result', {
                      state: { jobId: approveResult.followupJobId, repoName, branch },
                    })
                  }
                >
                  후속 결과 보기
                </Button>
              </div>
            </Card>
          ) : null}
        </section>
      </MainLayout>
    )
  }

  // Terminal: rejected.
  if (rejected) {
    return (
      <MainLayout>
        <section className="w-full space-y-4">
          {headerBlock}
          <Card className="border-[#DC2626] bg-[#7F1D1D]/30 p-6">
            <p className="flex items-center gap-2 text-[16px] font-semibold text-[#FCA5A5]">
              <Ban className="h-5 w-5" /> 승인 거부됨
            </p>
            <p className="mt-2 text-[13px] text-[#FECACA]">
              수용 불가로 처리되었습니다. 코드를 수정한 뒤 새 커밋으로 재실행하세요.
            </p>
          </Card>
        </section>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        {headerBlock}

        {/* C-1: blocking reasons + High items + request creation */}
        <Card className="border-[#EA580C] bg-[#7C2D12]/20 p-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-[#FDBA74]">
            <ShieldAlert className="h-4.5 w-4.5" /> 승인 필요 — 차단을 유발한 High 항목
          </p>

          {(vd?.blockReasons ?? []).length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-[#FED7AA]">
              {vd!.blockReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 space-y-2">
            {highCweItems.length === 0 ? (
              <p className="text-[12px] text-[#9CA3AF]">
                차단을 유발한 High 항목 정보를 불러오지 못했습니다.
              </p>
            ) : (
              highCweItems.map((f) => (
                <div
                  key={f.cwe}
                  className="flex items-center justify-between rounded-md border border-[#404040] bg-[#1E1E1E] px-3 py-2 text-[12px]"
                >
                  <span className="font-semibold text-white">{f.policyItem || f.title}</span>
                  <span className="text-[#9CA3AF]">{f.cwe}</span>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={submitting || requested}
              onClick={handleRequest}
              className="h-8 border-[#EA580C] bg-transparent px-3 text-xs text-[#FDBA74] hover:bg-[#7C2D12]/40"
            >
              {requested ? '승인 대기 중' : '승인 요청 생성'}
            </Button>
            {requested ? (
              <span className="text-[12px] text-[#FED7AA]">승인 담당자의 검토를 기다리는 중입니다.</span>
            ) : null}
          </div>
        </Card>

        {/* C-2 / C-3: reason + partial selection + approve/reject */}
        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="text-[15px] font-semibold text-white">승인 / 거부</p>
          <p className="mt-1 text-[12px] text-[#9CA3AF]">
            승인은 보안책임자·팀리드 권한이 필요합니다. 개발자 본인은 승인할 수 없습니다.
          </p>

          {/* C-3: blocking High CWEs as checkboxes — Critical은 노출 안 함 */}
          {highCweItems.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] font-semibold text-[#D1D5DB]">수용할 항목 선택 (부분 승인)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {highCweItems.map((f) => (
                  <label
                    key={f.cwe}
                    htmlFor={`ack-${f.cwe}`}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-[#2F2F2F] bg-[#171717] p-2.5"
                  >
                    <Checkbox
                      id={`ack-${f.cwe}`}
                      checked={selectedCwes.has(f.cwe!)}
                      onCheckedChange={(c) => toggleCwe(f.cwe!, c)}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">
                        {f.policyItem || f.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#9CA3AF]">{f.cwe}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[#6B7280]">
                선택한 항목만 수용됩니다. 나머지 High는 여전히 차단되어 다시 승인이 필요할 수 있습니다.
              </p>
            </div>
          ) : null}

          {/* C-2: reason (required) */}
          <div className="mt-3">
            <label htmlFor="approval-reason" className="text-[12px] font-semibold text-[#D1D5DB]">
              사유 (필수)
            </label>
            <textarea
              id="approval-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="예: 검토 후 수용 — 차기 스프린트 패치 예정"
              className="mt-1 flex w-full rounded-md border border-[#404040] bg-[#1E1E1E] px-3 py-2 text-sm text-white placeholder:text-[#6B7280] shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/40"
            />
            <p className="mt-1 text-[11px] text-[#6B7280]">
              무기한 예외는 금지됩니다. 수용 사유와 패치 계획을 구체적으로 남겨 주세요.
            </p>
          </div>

          {forbidden ? (
            <p className="mt-3 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-[12px] text-[#FCA5A5]">
              승인 권한이 없습니다. 보안책임자·팀리드 권한이 필요하며, 개발자 본인은 승인할 수 없습니다.
            </p>
          ) : null}
          {actionError ? (
            <p className="mt-3 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-[12px] text-[#FCA5A5]">
              {actionError}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              disabled={!reasonValid || submitting}
              onClick={handleReject}
              className="border border-[#7F1D1D] bg-transparent text-[#FCA5A5] shadow-none hover:bg-[#450A0A]/40"
            >
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              거부
            </Button>
            {/* Partial approve — only meaningful when a strict subset is chosen */}
            <Button
              type="button"
              disabled={!reasonValid || submitting || selectedCwes.size === 0 || allSelected}
              onClick={handleApprovePartial}
              variant="outline"
              className="border-[#EA580C] bg-transparent text-[#FDBA74] hover:bg-[#7C2D12]/40"
            >
              선택 항목 승인 ({selectedCwes.size})
            </Button>
            <Button
              type="button"
              disabled={!reasonValid || submitting}
              onClick={handleApproveAll}
              className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
            >
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              전체 승인
            </Button>
          </div>
        </Card>
      </section>
    </MainLayout>
  )
}
