import { Ban, CheckCircle2, ExternalLink, Loader2, Rocket, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import {
  ApprovalForbiddenError,
  decideApproval,
  fetchJobDetail,
  fetchPipelineDeployment,
  type JobDetail,
  type SecurityFinding,
  type SecuritySeverity,
} from '@/lib/api'
import { approvalSeverities, type GateCounts } from '@/lib/deploymentGate'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateJob, jobKeys } from '@/hooks/useJobQueries'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  repoName: string
  branch: string
  counts: GateCounts
  findings: SecurityFinding[]
  /** Gate block reasons, e.g. "Insecure Deserialization (CWE-502, High) 검출".
   *  Listed when the result carries counts but no findings list. */
  reasons?: string[]
  /** The backend gate let the run through and it was already deployed. */
  deployedWithoutApproval?: boolean
  /** Called when the backend continues THIS job after approval (no new job):
   *  the pipeline page reopens it live instead of navigating away. */
  onResumed?: () => void
}

type Outcome =
  | { kind: 'approved'; deployJobId: string; isFollowup: boolean; resumed: boolean; message: string }
  | { kind: 'rejected' }

const severityLabel: Record<SecuritySeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
const severityColor: Record<SecuritySeverity, string> = {
  critical: '#EF4444',
  high: '#F97316',
  medium: '#EAB308',
  low: '#22C55E',
}

const POLL_MS = 5000
const POLL_LIMIT_MS = 15 * 60 * 1000

export function DeployApprovalDialog({ open, onOpenChange, jobId, repoName, branch, counts, findings, reasons = [], deployedWithoutApproval = false, onResumed }: Props) {
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const queryClient = useQueryClient()

  const [approverName, setApproverName] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // Deployment tracking after approval.
  const [deployStatus, setDeployStatus] = useState<JobDetail['status'] | null>(null)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [pollTimedOut, setPollTimedOut] = useState(false)

  useEffect(() => {
    if (open && !approverName) setApproverName(user?.name || user?.login || '')
    // Only prefill when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const severities = approvalSeverities(counts)
  const items = useMemo(
    () => {
      const inScope = findings.filter((f) => f.inScope && severities.includes(f.severity))
      // Scope flags can be missing on some results — fall back to the grade.
      return inScope.length > 0 ? inScope : findings.filter((f) => severities.includes(f.severity))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findings, severities.join(',')],
  )

  const nameValid = approverName.trim().length > 0

  async function submit(action: 'approve' | 'reject') {
    if (!token || !nameValid || submitting) return
    setSubmitting(action)
    setError(null)
    const name = approverName.trim()
    const reason = `[승인자: ${name}] ${comment.trim() || (action === 'approve' ? '검토 후 승인' : '검토 후 거부')}`
    try {
      if (action === 'approve') {
        // Creates the pending approval first when the backend has none yet.
        const res = await decideApproval(token, jobId, 'approve', reason, name)
        if (res.resumed || res.resumeFromStage || res.followupJobId === jobId) {
          // The same job continues from the gate (build → deploy). Drop its
          // finished-run caches so nothing restores the stopped state.
          await queryClient.cancelQueries({ queryKey: jobKeys.run(jobId) })
          queryClient.removeQueries({ queryKey: jobKeys.run(jobId) })
          onOpenChange(false)
          if (onResumed) {
            // Already on this job's pipeline page: reopen it live in place.
            // (Navigating to the same route would not remount the page.)
            onResumed()
          } else {
            navigate('/pipeline/progress', { state: { jobId, repoName, branch, resumed: true } })
          }
          return
        }
        void invalidateJob(queryClient, jobId)
        setOutcome({
          kind: 'approved',
          deployJobId: res.resumed ? jobId : res.followupJobId || jobId,
          isFollowup: !res.resumed && !!res.followupJobId,
          resumed: res.resumed,
          message: res.message,
        })
      } else {
        await decideApproval(token, jobId, 'reject', reason, name)
        void invalidateJob(queryClient, jobId)
        setOutcome({ kind: 'rejected' })
      }
    } catch (err) {
      if (err instanceof ApprovalForbiddenError) {
        // Anyone who signs may approve; a 403 means the server still enforces
        // a role check that has to be removed on the backend.
        setError(`서버가 승인을 거부했습니다(403). 서버에 남아 있는 역할 권한 검사가 해제되어야 서명만으로 승인할 수 있습니다.${err.detail ? ` (${err.detail})` : ''}`)
      } else {
        setError(err instanceof Error ? err.message : '승인 처리에 실패했습니다.')
      }
    } finally {
      setSubmitting(null)
    }
  }

  // After approval, poll the deploy job until it finishes so the user can see
  // whether the approval actually led to a deployment.
  const deployJobId = outcome?.kind === 'approved' ? outcome.deployJobId : null
  useEffect(() => {
    if (!open || !token || !deployJobId) return
    let cancelled = false
    let timer: number | undefined
    const startedAt = Date.now()

    const tick = async () => {
      try {
        const [detail, deployment] = await Promise.all([
          fetchJobDetail(token, deployJobId),
          fetchPipelineDeployment(token, deployJobId).catch(() => ({ url: null })),
        ])
        if (cancelled) return
        if (!detail) throw new Error('job not found yet')
        setDeployStatus(detail.status)
        if (deployment.url) setDeployUrl(deployment.url)
        const failed = detail.status === 'failed' || detail.status === 'cancelled'
        const finished = detail.status === 'success' || failed
        if (finished && (deployment.url || failed)) return
        if (finished && Date.now() - startedAt > 60_000) return
      } catch {
        // transient — keep polling
      }
      if (cancelled) return
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        setPollTimedOut(true)
        return
      }
      timer = window.setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [open, token, deployJobId])

  function goToProgress() {
    if (!deployJobId) return
    onOpenChange(false)
    navigate('/pipeline/progress', { state: { jobId: deployJobId, repoName, branch } })
  }

  const summary = severities
    .map((s) => `${severityLabel[s]} ${counts[s]}건`)
    .join(', ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,520px)] border-[#404040] bg-[#242424] text-gray-50">
        {outcome?.kind === 'approved' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#A7F3D0]">
                <CheckCircle2 className="h-5 w-5" /> 승인 완료
              </DialogTitle>
              <DialogDescription>
                {approverName.trim()} 님이 승인했습니다.
                {outcome.message ? ` ${outcome.message}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3 text-[13px]">
              <p className="flex items-center gap-2 font-semibold text-white">
                <Rocket className="h-4 w-4 text-[#34D399]" /> 배포 확인
              </p>
              <p className="mt-1 text-[12px] text-[#9CA3AF]">
                {outcome.resumed
                  ? '승인된 실행이 멈춘 지점(빌드)부터 이어서 배포를 진행합니다.'
                  : outcome.isFollowup
                  ? `승인 후 배포 작업이 시작되었습니다. (Job ${deployJobId!.slice(0, 8)})`
                  : '백엔드가 후속 배포 작업 ID를 주지 않아 현재 작업의 배포 상태를 확인합니다.'}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[12px]">
                {deployUrl ? (
                  <a
                    href={deployUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-[#34D399] hover:underline"
                  >
                    배포됨 — {deployUrl} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : deployStatus === 'failed' || deployStatus === 'cancelled' ? (
                  <span className="text-[#FCA5A5]">배포 작업이 실패했습니다. 진행 화면에서 실패 단계를 확인하세요.</span>
                ) : deployStatus === 'success' ? (
                  <span className="text-[#FDE68A]">작업은 성공했지만 배포 URL이 보고되지 않았습니다.</span>
                ) : pollTimedOut ? (
                  <span className="text-[#FDE68A]">배포 확인 시간이 초과되었습니다. 진행 화면에서 확인하세요.</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[#D1D5DB]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#34D399]" />
                    배포 진행 확인 중{deployStatus ? ` (${deployStatus})` : ''}…
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-[#404040] bg-transparent text-[#D1D5DB] hover:bg-[#262626]"
              >
                닫기
              </Button>
              <Button
                type="button"
                onClick={goToProgress}
                className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
              >
                배포 진행 보기
              </Button>
            </div>
          </>
        ) : outcome?.kind === 'rejected' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#FCA5A5]">
                <Ban className="h-5 w-5" /> 승인 거부됨
              </DialogTitle>
              <DialogDescription>
                {approverName.trim()} 님이 거부했습니다. 배포되지 않으며, 코드를 수정한 뒤 다시 실행해야 합니다.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button type="button" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#FDBA74]">
                <ShieldAlert className="h-5 w-5" /> 배포 승인
              </DialogTitle>
              <DialogDescription>
                {repoName || jobId}
                {branch ? ` · ${branch}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <p className="text-[14px] text-white">
                다음 항목{summary ? ` (${summary})` : ''}이 발견되었습니다.
              </p>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-[#404040] bg-[#1E1E1E] p-2">
                {items.length === 0 && reasons.length > 0 ? (
                  reasons.map((reason, index) => (
                    <p key={index} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] text-[#E5E7EB]">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F97316]" />
                      {reason}
                    </p>
                  ))
                ) : items.length === 0 ? (
                  <p className="p-2 text-[12px] text-[#9CA3AF]">
                    항목 상세를 불러오지 못했습니다. 결과 화면의 탐지 목록을 확인하세요.
                  </p>
                ) : (
                  items.map((f) => (
                    <div key={f.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px]">
                      <span
                        className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
                        style={{ backgroundColor: severityColor[f.severity] }}
                      >
                        {severityLabel[f.severity]}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#E5E7EB]">
                          {f.categoryLabel || f.title || f.cwe || '항목'}
                          {f.cwe ? <span className="ml-1.5 font-normal text-[#9CA3AF]">{f.cwe}</span> : null}
                        </p>
                        {f.filePath ? (
                          <p className="truncate text-[11px] text-[#34D399]">
                            {f.filePath}
                            {f.lineNumber ? `:${f.lineNumber}` : ''}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <p className="text-[15px] font-semibold text-white">승인하시겠습니까?</p>
              <p className="text-[11px] text-[#9CA3AF]">이름으로 서명하면 누구나 승인할 수 있습니다. 서명은 감사 로그에 남습니다.</p>
              {deployedWithoutApproval ? (
                <p className="rounded-md border border-[#D97706] bg-[#78350F]/30 p-2 text-[12px] text-[#FDE68A]">
                  서버 보안 게이트가 이 실행을 통과시켜 이미 배포되었습니다. 배포 게이트 정책상 위 항목은 승인이
                  필요하므로, 승인하면 수용 기록이 남고 거부하면 수정 후 재배포가 필요합니다.
                </p>
              ) : (
                <p className="text-[12px] text-[#9CA3AF]">승인하면 위 항목을 수용하고 배포를 진행합니다.</p>
              )}

              <div>
                <label htmlFor="approver-name" className="text-[12px] font-semibold text-[#D1D5DB]">
                  승인자 서명 — 이름 (필수)
                </label>
                <Input
                  id="approver-name"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  placeholder="예: 홍길동"
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="approver-comment" className="text-[12px] font-semibold text-[#D1D5DB]">
                  의견 (선택)
                </label>
                <textarea
                  id="approver-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="예: 검토 후 수용 — 차기 스프린트 패치 예정"
                  className="mt-1 flex w-full rounded-md border border-[#404040] bg-[#1E1E1E] px-3 py-2 text-sm text-white placeholder:text-[#6B7280] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/40"
                />
              </div>

              {error ? (
                <p className="rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-[12px] text-[#FCA5A5]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                disabled={!nameValid || !!submitting}
                onClick={() => void submit('reject')}
                className="border border-[#7F1D1D] bg-transparent text-[#FCA5A5] shadow-none hover:bg-[#450A0A]/40"
              >
                {submitting === 'reject' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                거부
              </Button>
              <Button
                type="button"
                disabled={!nameValid || !!submitting}
                onClick={() => void submit('approve')}
                className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
              >
                {submitting === 'approve' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                승인하고 배포
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
