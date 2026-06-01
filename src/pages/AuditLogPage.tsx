import { AlertTriangle, FileClock, Loader2, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/contexts/AuthContext'
import {
  ApprovalForbiddenError,
  approveJob,
  AuthExpiredError,
  fetchApprovals,
  rejectJob,
  type ApprovalLogEntry,
  type ApprovalStatus,
} from '@/lib/api'

type StatusFilter = 'all' | ApprovalStatus

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '거부' },
]

const statusMeta: Record<ApprovalStatus, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'border-[#D97706] bg-[#78350F]/30 text-[#FCD34D]' },
  approved: { label: '승인', cls: 'border-[#3ECF8E] bg-[#065F46]/30 text-[#A7F3D0]' },
  rejected: { label: '거부', cls: 'border-[#DC2626] bg-[#7F1D1D]/30 text-[#FCA5A5]' },
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  return dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : value
}

export function AuditLogPage() {
  const navigate = useNavigate()
  const { token, logout } = useAuth()

  const [filter, setFilter] = useState<StatusFilter>('all')
  const [entries, setEntries] = useState<ApprovalLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(() => !!token)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  // Inline approve/reject (관리 화면): pending 행에서 사유 입력 후 처리.
  const [actionTarget, setActionTarget] = useState<{
    entry: ApprovalLogEntry
    type: 'approve' | 'reject'
  } | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [actionSubmitting, setActionSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionForbidden, setActionForbidden] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchApprovals(token, filter === 'all' ? undefined : filter)
      .then((list) => {
        if (!cancelled) setEntries(list)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AuthExpiredError) {
          logout()
          navigate('/auth', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : '감사 로그를 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, filter, refreshTick, logout, navigate])

  // Reset loading/error in the event handler (not the effect) so we never
  // call setState synchronously inside the effect body.
  function handleFilter(next: StatusFilter) {
    if (next === filter) return
    setIsLoading(true)
    setError(null)
    setFilter(next)
  }

  function openAction(entry: ApprovalLogEntry, type: 'approve' | 'reject') {
    setActionTarget({ entry, type })
    setActionReason('')
    setActionError(null)
    setActionForbidden(false)
  }

  async function submitAction() {
    if (!token || !actionTarget || actionSubmitting) return
    const reason = actionReason.trim()
    if (!reason) return
    setActionSubmitting(true)
    setActionError(null)
    setActionForbidden(false)
    try {
      const { entry, type } = actionTarget
      // 관리 화면의 승인은 전체 승인(approved_cwes 생략). 부분 승인은 화면 C에서.
      if (type === 'approve') await approveJob(token, entry.jobId, reason)
      else await rejectJob(token, entry.jobId, reason)
      setActionTarget(null)
      setRefreshTick((t) => t + 1)
    } catch (err) {
      if (err instanceof ApprovalForbiddenError) {
        setActionForbidden(true)
      } else {
        setActionError(err instanceof Error ? err.message : '처리에 실패했습니다.')
      }
    } finally {
      setActionSubmitting(false)
    }
  }

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        <div>
          <p className="flex items-center gap-2 text-[24px] font-bold text-white">
            <FileClock className="h-6 w-6 text-[#34D399]" /> 감사 로그
          </p>
          <p className="mt-1 text-[12px] text-[#6B7280]">승인 이력 (append-only)</p>
        </div>

        {/* append-only 안내 */}
        <div className="flex items-start gap-2 rounded-xl border border-[#404040] bg-[#1E1E1E] p-3 text-[12px] text-[#9CA3AF]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
          <p>
            모든 승인·거부 기록은 추가만 가능하며 수정·삭제할 수 없습니다(append-only). 커밋 불일치
            추적을 위해 스캔 커밋(scanned_commit_sha)을 함께 기록합니다.
          </p>
        </div>

        {/* 상태 필터 */}
        <div className="inline-flex w-fit items-center gap-1 rounded-xl border border-[#404040] bg-[#262626] p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleFilter(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
                filter === tab.key ? 'bg-[#3A3A3A] text-[#34D399]' : 'text-[#9CA3AF] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Card className="border-[#404040] bg-[#262626] p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-[#9CA3AF]">
              <Loader2 className="h-5 w-5 animate-spin text-[#34D399]" /> 감사 로그를 불러오는 중...
            </div>
          ) : error ? (
            <div className="p-6 text-center text-[13px] text-[#FCA5A5]">{error}</div>
          ) : entries.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-[#6B7280]">표시할 승인 이력이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#404040] text-[#6B7280]">
                    <th className="px-4 py-3 font-semibold">Job / 커밋</th>
                    <th className="px-4 py-3 font-semibold">대상 CWE</th>
                    <th className="px-4 py-3 font-semibold">사유</th>
                    <th className="px-4 py-3 font-semibold">승인자</th>
                    <th className="px-4 py-3 font-semibold">일시</th>
                    <th className="px-4 py-3 font-semibold">상태</th>
                    <th className="px-4 py-3 font-semibold">만료</th>
                    <th className="px-4 py-3 font-semibold">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const meta = statusMeta[e.status]
                    return (
                      <tr key={e.id} className="border-b border-[#2F2F2F] align-top text-[#D1D5DB]">
                        <td className="px-4 py-3">
                          <p className="font-mono text-[#D1D5DB]">{e.jobId ? e.jobId.slice(0, 8) : '—'}</p>
                          {e.scannedCommitSha ? (
                            <p className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-[#34D399]">
                              {e.scannedCommitSha.slice(0, 12)}
                              {e.commitMismatch ? (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[#FCD34D]"
                                  title={`요청 커밋과 불일치${e.requestedCommitSha ? ` (요청 ${e.requestedCommitSha.slice(0, 12)})` : ''}`}
                                >
                                  <AlertTriangle className="h-3 w-3" /> 불일치
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {e.cwes.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {e.cwes.map((c) => (
                                <span
                                  key={c}
                                  className="rounded-full border border-[#404040] px-2 py-0.5 text-[11px] text-[#9CA3AF]"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#6B7280]">—</span>
                          )}
                        </td>
                        <td className="max-w-[260px] px-4 py-3 text-[#A3A3A3]">{e.reason || '—'}</td>
                        <td className="px-4 py-3 text-[#D1D5DB]">{e.approver || '—'}</td>
                        <td className="px-4 py-3 text-[#9CA3AF]">{fmtDate(e.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#9CA3AF]">{fmtDate(e.expiresAt)}</td>
                        <td className="px-4 py-3">
                          {e.status === 'pending' ? (
                            <div className="flex gap-1.5">
                              <Button
                                type="button"
                                onClick={() => openAction(e, 'approve')}
                                className="h-7 bg-[#34D399] px-2.5 text-[11px] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
                              >
                                승인
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => openAction(e, 'reject')}
                                className="h-7 border-[#7F1D1D] bg-transparent px-2.5 text-[11px] text-[#FCA5A5] hover:bg-[#450A0A]/40"
                              >
                                거부
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[#6B7280]">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <Dialog
        open={!!actionTarget}
        onOpenChange={(open) => {
          if (!open && !actionSubmitting) setActionTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionTarget?.type === 'approve' ? '승인 처리' : '반려 처리'}
            </DialogTitle>
            <DialogDescription>
              Job {actionTarget?.entry.jobId.slice(0, 8)}
              {actionTarget?.type === 'approve'
                ? ' — 차단된 항목을 전체 승인합니다. 부분 승인은 결과 화면의 승인 페이지에서 가능합니다.'
                : ' — 승인을 반려합니다.'}
            </DialogDescription>
          </DialogHeader>

          <textarea
            value={actionReason}
            onChange={(e) => setActionReason(e.target.value)}
            rows={3}
            placeholder={
              actionTarget?.type === 'approve'
                ? '예: 검토 후 수용 — 차기 스프린트 패치 예정'
                : '예: 보안 기준 미충족 — 즉시 수정 필요'
            }
            className="flex w-full rounded-md border border-[#404040] bg-[#1E1E1E] px-3 py-2 text-sm text-white placeholder:text-[#6B7280] shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/40"
          />
          <p className="text-[11px] text-[#6B7280]">
            사유는 필수입니다. 무기한 예외는 금지되며, 승인은 보안책임자·팀리드 권한이 필요합니다.
          </p>

          {actionForbidden ? (
            <p className="rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-[12px] text-[#FCA5A5]">
              승인 권한이 없습니다. 보안책임자·팀리드 권한이 필요하며, 개발자 본인은 승인할 수 없습니다.
            </p>
          ) : null}
          {actionError ? (
            <p className="rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-[12px] text-[#FCA5A5]">
              {actionError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setActionTarget(null)}
              disabled={actionSubmitting}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={() => void submitAction()}
              disabled={actionSubmitting || actionReason.trim().length === 0}
              className={
                actionTarget?.type === 'approve'
                  ? 'bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]'
                  : 'border border-[#7F1D1D] bg-transparent text-[#FCA5A5] shadow-none hover:bg-[#450A0A]/40'
              }
            >
              {actionSubmitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {actionTarget?.type === 'approve' ? '승인' : '거부'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
