import {
  ArrowDownToLine,
  Ban,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleMinus,
  Clock3,
  CodeXml,
  Copy,
  ExternalLink,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  Hammer,
  Hash,
  Loader2,
  Maximize2,
  Minimize2,
  Package,
  Rocket,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Timer,
  User,
  XCircle,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
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
import { getAuthCacheKey } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import { useServerNow } from '@/hooks/useServerNow'
import { executionTiming } from '@/lib/executionTiming'
import { usePipelineExecution, type ConnectionState } from '@/hooks/usePipelineExecution'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchJobResult, useJobResultQuery } from '@/hooks/useJobQueries'
import { DeployApprovalDialog } from '@/components/DeployApprovalDialog'
import { parseGateMessage } from '@/lib/gateMessage'
import type { SecuritySeverity, VerdictKind } from '@/lib/api'
import { getStartTiming, startTimingDurations } from '@/lib/startTiming'
import { getPendingStart } from '@/lib/pendingStart'

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '-'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}
import { isWebhookTrigger, PipelineConflictError, setRepoDomainUrl, setRepoPipelineInfo } from '@/lib/api'
import {
  LOG_LEVELS,
  PIPELINE_STAGES,
  buildStageViews,
  executionTone,
  filterLogEntries,
  formatClock,
  formatDateTime,
  formatDurationSecs,
  formatLogsForCopy,
  isTerminalJobStatus,
  resolveLogStage,
  stageDurationSecs,
  summarizeProgress,
  type ExecutionTone,
  type LogEntry,
  type LogFilter,
  type LogLevel,
  type StageStatus,
  type StageView,
} from '@/lib/pipelineExecution'

type LocationState = {
  jobId?: string
  /** Start request still in flight (see lib/pendingStart). */
  pendingStartId?: string
  repoName?: string
  branch?: string
  commitSha?: string
}

type ResolvedLogEntry = LogEntry & { resolvedStage: number | null }

type Translate = (key: string, replacements?: Record<string, string | number>) => string

/** Language-dependent labels shared by the page's sub-components. */
type Labels = {
  t: Translate
  stageName: (index: number | null) => string
  status: (status: StageStatus) => string
  level: (level: LogLevel) => string
  duration: (secs: number | null | undefined) => string
}

const STAGE_ICONS: ComponentType<{ className?: string }>[] = [
  GitBranch,
  Package,
  Shield,
  FlaskConical,
  ShieldAlert,
  ShieldCheck,
  Hammer,
  Rocket,
]

const STATUS_COLOR: Record<StageStatus, string> = {
  success: '#3ECF8E',
  running: '#60A5FA',
  failed: '#EF4444',
  pending: '#6B7280',
  skipped: '#6B7280',
  cancelled: '#9CA3AF',
}

const TONE_COLOR: Record<ExecutionTone, string> = {
  success: '#3ECF8E',
  running: '#60A5FA',
  failed: '#EF4444',
  queued: '#6B7280',
  cancelled: '#9CA3AF',
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  INFO: 'text-[#93C5FD]',
  WARN: 'text-[#FCD34D]',
  ERROR: 'text-[#FCA5A5]',
  DEBUG: 'text-[#9CA3AF]',
}

const CONNECTION_STYLE: Record<ConnectionState, { color: string; pulse: boolean }> = {
  connecting: { color: '#F59E0B', pulse: true },
  live: { color: '#34D399', pulse: true },
  reconnecting: { color: '#F59E0B', pulse: false },
  closed: { color: '#6B7280', pulse: false },
}

function stageKey(index: number) {
  return `stage-${index}`
}

function shortSha(sha: string) {
  return sha ? sha.slice(0, 7) : ''
}

function commitUrl(repoUrl: string, sha: string): string | null {
  if (!sha || !/github\.com/i.test(repoUrl)) return null
  return `${repoUrl.replace(/\.git$/, '').replace(/\/+$/, '')}/commit/${sha}`
}

function toMs(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Re-renders every second while `active`, for live elapsed timers. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

function StageStatusIcon({ status, animate, className = 'h-6 w-6' }: {
  status: StageStatus
  animate: boolean
  className?: string
}) {
  const style = { color: STATUS_COLOR[status] }
  switch (status) {
    case 'success':
      return <CheckCircle2 className={className} style={style} />
    case 'failed':
      return <XCircle className={className} style={style} />
    case 'running':
      return animate ? (
        <Loader2 className={`${className} animate-spin`} style={style} />
      ) : (
        <CircleDot className={className} style={style} />
      )
    case 'skipped':
      return <CircleMinus className={className} style={style} />
    case 'cancelled':
      return <Ban className={className} style={style} />
    default:
      return <CircleDashed className={className} style={style} />
  }
}

function MetaItem({ icon: Icon, label, children }: {
  icon: ComponentType<{ className?: string }>
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#6B7280]">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="mt-1 truncate text-[14px] text-[#E5E7EB]">{children}</div>
    </div>
  )
}

function LogLines({ entries, emptyText, showStage, labels }: {
  entries: ResolvedLogEntry[]
  emptyText: string
  showStage: boolean
  labels: Labels
}) {
  if (entries.length === 0) {
    return <p className="font-mono text-[12px] text-[#6B7280]">{emptyText}</p>
  }
  return (
    <>
      {entries.map((entry) => {
        const at = entry.timestampMs ?? (entry.live ? entry.receivedAtMs : null)
        return (
          <div
            key={entry.seq}
            className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2 font-mono text-[12px] leading-5"
          >
            <span
              className="text-[#6B7280]"
              title={at === null ? labels.t('run.logs.line', { n: entry.seq + 1 }) : undefined}
            >
              {at !== null ? formatClock(at) : `#${String(entry.seq + 1).padStart(4, '0')}`}
            </span>
            <span className={`min-w-[2.75rem] font-semibold ${LEVEL_CLASS[entry.level]}`}>
              {labels.level(entry.level)}
            </span>
            <span className="min-w-0 break-all text-[#D1D5DB]">
              {showStage ? (
                <span className="mr-2 text-[#808080]">[{labels.stageName(entry.resolvedStage)}]</span>
              ) : null}
              {entry.message}
            </span>
          </div>
        )
      })}
    </>
  )
}

export function PipelineProcessPage() {
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState
  // Opened straight from the "파이프라인 실행" click: the start request is
  // still in flight. Show that, then attach to the execution once it has an id.
  if (!locationState.jobId && locationState.pendingStartId) {
    return <PendingStartView key={locationState.pendingStartId} locationState={locationState} />
  }
  // Remount per execution so live state, timers and sockets never leak
  // from one execution into another.
  return <PipelineExecutionView key={locationState.jobId ?? ''} locationState={locationState} />
}

type PendingOutcome =
  | { kind: 'waiting' }
  | { kind: 'conflict'; existingJobId: string | null }
  | { kind: 'error'; message: string }

function PendingStartView({ locationState }: { locationState: LocationState }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const request = getPendingStart(locationState.pendingStartId)
  const [outcome, setOutcome] = useState<PendingOutcome>(() =>
    request ? { kind: 'waiting' } : { kind: 'error', message: t('run.pending.lost') },
  )
  const [startedAt] = useState(() => Date.now())
  const now = useNow(outcome.kind === 'waiting')

  useEffect(() => {
    if (!request) return
    let cancelled = false
    request
      .then(({ jobId }) => {
        if (cancelled) return
        if (!jobId) {
          setOutcome({ kind: 'error', message: t('pipelineNew.serverNoJobId') })
          return
        }
        // Replace this entry: Back still returns to the new-pipeline page.
        navigate('/pipeline/progress', {
          replace: true,
          state: { jobId, repoName: locationState.repoName, branch: locationState.branch },
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof PipelineConflictError) {
          setOutcome({ kind: 'conflict', existingJobId: error.existingJobId })
        } else {
          setOutcome({
            kind: 'error',
            message: error instanceof Error ? error.message : t('pipelineNew.startFailed'),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [request, navigate, locationState.repoName, locationState.branch, t])

  const target = [locationState.repoName, locationState.branch].filter(Boolean).join(' · ')
  const openExisting = (jobId: string) =>
    navigate('/pipeline/progress', {
      replace: true,
      state: { jobId, repoName: locationState.repoName, branch: locationState.branch },
    })

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        <Card className="border-[#404040] bg-[#262626] p-6">
          {outcome.kind === 'waiting' ? (
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-[#34D399]" />
              <div>
                <p className="text-[16px] font-semibold text-white">{t('run.pending.title')}</p>
                <p className="mt-1 text-[13px] text-[#9CA3AF]">
                  {target ? `${target} · ` : ''}
                  {t('run.pending.elapsed', { secs: Math.max(0, Math.floor((now - startedAt) / 1000)) })}
                </p>
              </div>
            </div>
          ) : outcome.kind === 'conflict' ? (
            <div>
              <p className="text-[16px] font-semibold text-[#FDBA74]">{t('pipelineNew.conflictTitle')}</p>
              <p className="mt-1 text-[13px] text-[#D1D5DB]">
                {t('pipelineNew.conflictDescription', {
                  repo: locationState.repoName || t('pipelineNew.thisRepo'),
                  branch: locationState.branch ? ` (${locationState.branch})` : '',
                })}
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => navigate('/pipeline/new', { replace: true })}>
                  {t('run.pending.back')}
                </Button>
                <Button
                  disabled={!outcome.existingJobId}
                  onClick={() => outcome.existingJobId && openExisting(outcome.existingJobId)}
                  className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
                >
                  {t('pipelineNew.openExisting')}
                </Button>
              </div>
              {!outcome.existingJobId ? (
                <p className="mt-2 text-right text-[12px] text-[#FCA5A5]">{t('pipelineNew.missingJobId')}</p>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="text-[16px] font-semibold text-[#FCA5A5]">{t('pipelineNew.startFailed')}</p>
              <p className="mt-1 break-words text-[13px] text-[#D1D5DB]">{outcome.message}</p>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => navigate('/pipeline/new', { replace: true })}>{t('run.pending.back')}</Button>
              </div>
            </div>
          )}
        </Card>
      </section>
    </MainLayout>
  )
}

function PipelineExecutionView({ locationState }: { locationState: LocationState }) {
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const { locale, t } = useLanguage()
  const jobId = locationState.jobId ?? ''
  const cacheKey = getAuthCacheKey(token, user)

  const labels: Labels = useMemo(
    () => ({
      t,
      stageName: (index) =>
        index === null ? t('run.stage.general') : t(`run.stage.${PIPELINE_STAGES[index].key}`),
      status: (status) => t(`run.status.${status}`),
      level: (level) => t(`run.level.${level}`),
      duration: (secs) => formatDurationSecs(secs, locale),
    }),
    [t, locale],
  )

  const { job, logs, activity, connection, error, deployUrl, setDeployUrl, cancel } =
    usePipelineExecution(jobId, token)

  const [isCancelling, setIsCancelling] = useState(false)
  // Raw backend detail of a failed cancel (shown as a tooltip).
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const [openStages, setOpenStages] = useState<string[]>([])
  const [logFilter, setLogFilter] = useState<LogFilter>({
    stage: 'all',
    levels: new Set(LOG_LEVELS),
  })
  const [logsOpen, setLogsOpen] = useState('all-logs')
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [following, setFollowing] = useState(true)
  const [copied, setCopied] = useState(false)

  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)
  const jobStatus = job?.status ?? 'queued'
  const isTerminal = isTerminalJobStatus(jobStatus)
  const serverNow = useServerNow(executionTiming(job, null).ticking)
  const now = serverNow ?? 0
  const timing = executionTiming(job, serverNow)
  // Activity timestamps ("마지막 로그 N초 전") are this PC's receive times.
  const localNow = useNow(timing.ticking)
  // Re-read each render (cheap): phases are recorded by the execution hook.
  const timingEntry = jobId ? getStartTiming(jobId) : null
  const startTiming = timingEntry ? startTimingDurations(timingEntry) : null

  // Once the run finishes, fetch its result in the background so "보안 결과"
  // opens instantly from the query cache.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (isTerminal) prefetchJobResult(queryClient, token, jobId)
  }, [isTerminal, queryClient, token, jobId])

  const stages = useMemo(() => buildStageViews(job?.steps ?? [], jobStatus, job?.completedAt), [job?.steps, jobStatus, job?.completedAt])
  const progress = summarizeProgress(stages)
  const tone = executionTone(jobStatus)
  const toneColor = TONE_COLOR[tone]
  const currentStage = progress.currentIndex >= 0 ? stages[progress.currentIndex] : null
  const failedStage = stages.find((stage) => stage.status === 'failed') ?? null

  const stageDuration = (stage: StageView) =>
    stage.status === 'running' && serverNow === null ? null : stageDurationSecs(stage, now)

  const resolvedLogs: ResolvedLogEntry[] = useMemo(
    () => logs.map((entry) => ({ ...entry, resolvedStage: resolveLogStage(entry, stages, now) })),
    [logs, stages, now],
  )

  const logsByStage = useMemo(() => {
    const map = new Map<number, ResolvedLogEntry[]>()
    for (const entry of resolvedLogs) {
      if (entry.resolvedStage === null) continue
      const list = map.get(entry.resolvedStage) ?? []
      list.push(entry)
      map.set(entry.resolvedStage, list)
    }
    return map
  }, [resolvedLogs])

  const visibleLogs = useMemo(() => filterLogEntries(resolvedLogs, logFilter), [resolvedLogs, logFilter])

  const repoName = job?.repoName || locationState.repoName || ''
  const branch = job?.branch || locationState.branch || ''

  // Commit: backend field first, then navigation state, then what the
  // clone stage actually printed ("HEAD is now at <sha>").
  const cloneCommit = useMemo(() => {
    for (const entry of logsByStage.get(0) ?? []) {
      const head = entry.raw.match(/HEAD\s+is\s+now\s+at\s+([0-9a-f]{7,40})\s+(.+)/i)
      if (head) return { sha: head[1], message: head[2].trim() }
      const labeled = entry.raw.match(/(?:commit|sha)\s*[:=]\s*([0-9a-f]{7,40})\b/i)
      if (labeled) return { sha: labeled[1], message: '' }
    }
    return null
  }, [logsByStage])
  const commitSha = job?.commitSha || locationState.commitSha || cloneCommit?.sha || ''
  const commitLink = commitUrl(job?.repoUrl ?? '', commitSha)

  const totalElapsed = timing.stages

  const triggerLabel = (source: string, by: string): string => {
    const base = isWebhookTrigger(source)
      ? t('run.trigger.webhook')
      : !source || source === 'manual'
        ? t('run.trigger.manual')
        : source
    return by ? `${base} · ${by}` : base
  }

  // Keep the running stage open; when the run fails, open the failed stage.
  useEffect(() => {
    const keys: string[] = []
    if (currentStage) keys.push(stageKey(currentStage.index))
    if (isTerminal && failedStage) keys.push(stageKey(failedStage.index))
    if (keys.length === 0) return
    setOpenStages((previous) => {
      const missing = keys.filter((key) => !previous.includes(key))
      return missing.length === 0 ? previous : [...previous, ...missing]
    })
  }, [currentStage, failedStage, isTerminal])

  // Follow the tail only while the user is at the bottom.
  useLayoutEffect(() => {
    const el = logContainerRef.current
    if (!el || !followRef.current) return
    el.scrollTop = el.scrollHeight
  }, [visibleLogs.length, logsExpanded, logsOpen])

  // Deployment URL printed by a successful Deployment stage.
  const lastDomainRef = useRef<string | null>(null)
  useEffect(() => {
    if (!job?.repoName || stages[7]?.status !== 'success') return
    const lines = logsByStage.get(7) ?? []
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const found = lines[i].raw.match(/(https?:\/\/[^\s<>"'`)]+)/i)?.[1]?.replace(/[.,;]+$/, '')
      if (!found) continue
      if (lastDomainRef.current === found) return
      lastDomainRef.current = found
      setDeployUrl(deployUrl ?? found)
      setRepoDomainUrl(cacheKey, job.repoName, found)
      return
    }
  }, [job?.repoName, stages, logsByStage, deployUrl, setDeployUrl, cacheKey])

  // Feed the repository detail page's source card.
  useEffect(() => {
    if (!job?.repoName) return
    setRepoPipelineInfo(cacheKey, job.repoName, {
      branch: job.branch || undefined,
      triggeredBy: job.triggeredBy || user?.login || undefined,
      triggeredAt: job.createdAt ?? job.startedAt ?? undefined,
      lastStatus: job.status,
      ...(commitSha ? { commitSha } : {}),
      ...(cloneCommit?.message ? { commitMessage: cloneCommit.message } : {}),
    })
  }, [
    job?.repoName,
    job?.branch,
    job?.triggeredBy,
    job?.createdAt,
    job?.startedAt,
    job?.status,
    commitSha,
    cloneCommit?.message,
    user?.login,
    cacheKey,
  ])

  async function handleCancel() {
    if (isCancelling) return
    setIsCancelling(true)
    setCancelError(null)
    try {
      await cancel()
      setIsCancelDialogOpen(false)
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsCancelling(false)
    }
  }

  const showStageLogs = (index: number) => {
    setLogFilter((previous) => ({ ...previous, stage: index }))
    setLogsOpen('all-logs')
    setOpenStages((previous) =>
      previous.includes(stageKey(index)) ? previous : [...previous, stageKey(index)],
    )
    window.requestAnimationFrame(() =>
      document.getElementById(`stage-card-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  const jumpToLatest = () => {
    const el = logContainerRef.current
    if (!el) return
    followRef.current = true
    setFollowing(true)
    el.scrollTop = el.scrollHeight
  }

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(formatLogsForCopy(visibleLogs, labels.stageName, labels.level))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (copyError) {
      console.error('[pipeline] copy logs failed:', copyError)
    }
  }

  const toggleLevel = (level: LogLevel) => {
    setLogFilter((previous) => {
      const levels = new Set(previous.levels)
      if (levels.has(level)) levels.delete(level)
      else levels.add(level)
      return { ...previous, levels }
    })
  }

  // ── Deployment approval on this page ───────────────────────────────────
  // The server decides whether this run can be approved
  // (result.approval_eligible): only a run stopped at the gate pending
  // approval, never one that was already deployed. This page offers it right
  // where the run stopped. The gate step text / counts only explain why.
  const gateSummary =
    failedStage && failedStage.key === 'gate' ? parseGateMessage(failedStage.errorMessage) : null
  const gateCounts: Record<SecuritySeverity, number> | null = gateSummary?.counts ?? null
  const reportedGateVerdict: VerdictKind | null = (() => {
    const v = gateSummary?.verdict ?? ''
    if (v.includes('pending') || v.includes('approval')) return 'block_pending_approval'
    if (v === 'block' || v === 'blocked') return 'block'
    if (v === 'warn' || v === 'warning') return 'warn'
    if (v === 'pass' || v === 'passed') return 'pass'
    return null
  })()

  // Scan result of the finished run (cached; prefetched when the run ended).
  const runResult = useJobResultQuery(token, isTerminal ? jobId : '')
  const runVd = runResult.data?.verdictDetail ?? null
  const resultCounts: Record<SecuritySeverity, number> | null = useMemo(() => {
    const data = runResult.data
    if (!data) return null
    const sum = (c: Record<SecuritySeverity, number>) => c.critical + c.high + c.medium + c.low
    if (data.verdictDetail?.counts && sum(data.verdictDetail.counts) > 0) return data.verdictDetail.counts
    return data.findings
      .filter((f) => f.inScope)
      .reduce<Record<SecuritySeverity, number>>(
        (acc, f) => {
          acc[f.severity] += 1
          return acc
        },
        { critical: 0, high: 0, medium: 0, low: 0 },
      )
  }, [runResult.data])
  const alreadyApproved = (runVd?.acknowledgedCwes.length ?? 0) > 0
  const pendingVerdict =
    runVd?.verdict === 'block_pending_approval' || reportedGateVerdict === 'block_pending_approval'
  const awaitingApproval =
    isTerminal && !alreadyApproved && pendingVerdict && runResult.data?.approvalEligible === true
  // Shown when the server says this run cannot be approved (e.g. already deployed).
  const approvalBlockedReason =
    isTerminal && pendingVerdict && runResult.data && runResult.data.approvalEligible !== true
      ? runResult.data.approvalReason
      : null

  const [approvalOpen, setApprovalOpen] = useState(false)
  // Open the approval dialog right here, once, when this run needs approval —
  // this page is where approval belongs, not the result page.
  const [approvalAutoOpened, setApprovalAutoOpened] = useState(false)
  if (awaitingApproval && !approvalAutoOpened) {
    setApprovalAutoOpened(true)
    setApprovalOpen(true)
  }
  const approvalFindings = runResult.data?.findings ?? []
  const approvalCounts: Record<SecuritySeverity, number> =
    gateCounts ?? resultCounts ?? { critical: 0, high: 0, medium: 0, low: 0 }
  const approvalReasons = gateSummary?.reasons.length ? gateSummary.reasons : runVd?.blockReasons ?? []

  if (!jobId) {
    return (
      <MainLayout>
        <Card className="p-6 text-center text-[#FCA5A5]">{t('run.noJobId')}</Card>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => navigate('/pipeline/new')}>{t('run.newPipeline')}</Button>
        </div>
      </MainLayout>
    )
  }

  const connectionStyle = CONNECTION_STYLE[connection]
  const deployStage = stages[7]

  const headlineLabel = t(`run.headline.${tone}.label`)
  // A successful run that skipped stages (e.g. no tests) must not claim that
  // every check passed: "파이프라인 완료 · 건너뜀 N개".
  const skippedOnSuccess = jobStatus === 'success' ? progress.skipped : 0
  const headlineMessage =
    skippedOnSuccess > 0
      ? t('run.summary.successWithSkipped', { count: skippedOnSuccess })
      : t(`run.headline.${tone}.message`)

  return (
    <MainLayout pipelineElapsed={totalElapsed === null ? undefined : labels.duration(totalElapsed)}>
      <section className="w-full space-y-4">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-[26px] font-bold text-white">
              <CodeXml className="h-7 w-7 shrink-0 text-[#34D399]" />
              <span className="truncate">{repoName || jobId}</span>
            </div>
            <div
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border px-3 py-1.5"
              style={{ borderColor: toneColor }}
              role="status"
              aria-live="polite"
            >
              {tone === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: toneColor }} />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: toneColor }} />
              )}
              <span className="text-[13px] font-bold tracking-wide" style={{ color: toneColor }}>
                {headlineLabel}
              </span>
              <span className="text-[13px] text-[#D1D5DB]">{headlineMessage}</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <MetaItem icon={GitBranch} label={t('run.meta.branch')}>{branch || '—'}</MetaItem>
            <MetaItem icon={GitCommitHorizontal} label={t('run.meta.commit')}>
              {commitSha ? (
                commitLink ? (
                  <a
                    href={commitLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#93C5FD] hover:underline"
                    title={commitSha}
                  >
                    {shortSha(commitSha)}
                  </a>
                ) : (
                  <span className="font-mono" title={commitSha}>{shortSha(commitSha)}</span>
                )
              ) : (
                '—'
              )}
            </MetaItem>
            <MetaItem icon={Hash} label={t('run.meta.executionId')}>
              <span className="font-mono" title={jobId}>{jobId.slice(0, 8)}</span>
            </MetaItem>
            <MetaItem icon={User} label={t('run.meta.triggeredBy')}>
              {job ? triggerLabel(job.triggerSource, job.triggeredBy) : '—'}
            </MetaItem>
            <MetaItem icon={CalendarClock} label={t('run.meta.started')}>
              {formatDateTime(job?.startedAt)}
            </MetaItem>
            <MetaItem icon={Timer} label={t('run.meta.duration')}>
              {labels.duration(totalElapsed)}
            </MetaItem>
            <MetaItem icon={Timer} label={t('run.meta.wallDuration')}>
              {labels.duration(timing.total)}
            </MetaItem>
          </div>
        </Card>

        {error !== null ? (
          <Card
            className="border-[#7F1D1D] bg-[#450A0A]/40 p-3 text-center text-sm text-[#FCA5A5]"
            title={error || undefined}
          >
            {t('run.loadFailed')}
          </Card>
        ) : null}

        {/* ── Completion summary ─────────────────────────────────────── */}
        {isTerminal ? (
          <Card className="border-[#404040] bg-[#262626] p-4" style={{ borderColor: toneColor }}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[20px] font-bold" style={{ color: toneColor }}>
                  {jobStatus === 'success'
                    ? (skippedOnSuccess > 0
                      ? t('run.summary.successWithSkipped', { count: skippedOnSuccess })
                      : t('run.summary.success'))
                    : awaitingApproval
                      ? t('run.summary.awaitingApproval')
                      : jobStatus === 'failed'
                        ? t('run.summary.failed')
                        : t('run.summary.cancelled')}
                </p>
                <p className="mt-1 text-[13px] text-[#A1A1A1]">
                  {t('run.stagesCompleted', { completed: progress.completed, total: progress.total })}
                  {' · '}
                  {labels.duration(totalElapsed)}
                  {repoName ? ` · ${repoName}` : ''}
                  {commitSha ? ` @ ${shortSha(commitSha)}` : ''}
                </p>
                {timing.total !== null ? (
                  <p className="mt-1 text-[13px] text-[#A1A1A1]">
                    {t('run.timing.breakdown', { total: labels.duration(timing.total), stages: labels.duration(timing.stages), waiting: labels.duration(timing.waiting) })}
                  </p>
                ) : null}
                {failedStage ? (
                  <p className="mt-2 text-[13px] text-[#FCA5A5]">
                    {t('run.failedAt', {
                      number: failedStage.number,
                      name: labels.stageName(failedStage.index),
                    })}
                    {failedStage.errorMessage ? ` — ${failedStage.errorMessage}` : ''}
                  </p>
                ) : null}
                {approvalBlockedReason ? (
                  <p className="mt-2 text-[12px] text-[#FDBA74]">
                    {t('run.approval.notEligible', { reason: approvalBlockedReason })}
                  </p>
                ) : null}
                {awaitingApproval ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EA580C] bg-[#7C2D12]/30 p-3">
                    <div>
                      <p className="flex items-center gap-2 text-[14px] font-semibold text-[#FDBA74]">
                        <ShieldAlert className="h-4 w-4" />{' '}
                        {t('run.approval.title')}
                      </p>
                      <p className="mt-1 text-[12px] text-[#FED7AA]">
                        {t('run.approval.description', {
                          items: (['high', 'medium'] as const)
                            .filter((sev) => approvalCounts[sev] > 0)
                            .map((sev) => `${sev === 'high' ? 'High' : 'Medium'} ${approvalCounts[sev]}`)
                            .join(', ') || '-',
                        })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setApprovalOpen(true)}
                      className="h-9 shrink-0 bg-[#EA580C] px-4 text-[13px] font-semibold text-white shadow-none hover:bg-[#C2410C]"
                    >
                      <ShieldCheck className="mr-1.5 h-4 w-4" /> {t('run.approval.request')}
                    </Button>
                  </div>
                ) : null}
                <p className="mt-2 text-[13px] text-[#A1A1A1]">
                  {t('run.deployment')}:{' '}
                  {deployUrl ? (
                    <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="text-[#93C5FD] hover:underline">
                      {deployUrl}
                    </a>
                  ) : awaitingApproval ? (
                    t('run.approval.deployWaiting')
                  ) : (
                    labels.status(deployStage.status)
                  )}
                </p>
              </div>
              {failedStage ? (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 shadow-none"
                  onClick={() => showStageLogs(failedStage.index)}
                >
                  <ScrollText className="mr-1.5 h-4 w-4" /> {t('run.viewErrorLogs')}
                </Button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {stages.map((stage) => (
                <span
                  key={stage.index}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#404040] bg-[#1E1E1E] px-2 py-1 text-[12px] text-[#D1D5DB]"
                >
                  <StageStatusIcon status={stage.status} animate={false} className="h-3.5 w-3.5" />
                  {labels.stageName(stage.index)}
                  <span className="text-[#808080]">{labels.duration(stageDuration(stage))}</span>
                </span>
              ))}
            </div>
          </Card>
        ) : null}

        {/* ── Progress overview ─────────────────────────────────────── */}
        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[22px] font-bold text-white">{t('run.progressTitle')}</p>
            <p className="text-[14px] text-[#A1A1A1]">
              <span className="font-semibold text-white">
                {t('run.stagesCompleted', { completed: progress.completed, total: progress.total })}
              </span>
              {progress.failed > 0 ? t('run.failedCount', { count: progress.failed }) : ''}
              {progress.skipped > 0 ? t('run.skippedCount', { count: progress.skipped }) : ''}
            </p>
          </div>

          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-[#404040]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
            aria-label={t('run.completedStagesAria')}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progress.percent}%`, backgroundColor: toneColor }}
            />
          </div>

          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {stages.map((stage) => {
              const color = STATUS_COLOR[stage.status]
              const active = stage.index === progress.currentIndex
              return (
                <button
                  key={stage.index}
                  type="button"
                  onClick={() => showStageLogs(stage.index)}
                  title={`${stage.number}. ${labels.stageName(stage.index)} · ${labels.status(stage.status)}`}
                  className="group flex min-w-0 flex-col items-center gap-1 rounded-md py-1 hover:bg-[#2E2E2E]"
                >
                  <span
                    className={`h-1.5 w-full rounded-full transition-colors duration-300 ${active ? 'animate-pulse' : ''}`}
                    style={{
                      backgroundColor: stage.status === 'pending' ? 'transparent' : color,
                      boxShadow: stage.status === 'pending' ? 'inset 0 0 0 1px #6B7280' : undefined,
                    }}
                  />
                  <span className="text-[11px] font-semibold" style={{ color }}>
                    {String(stage.number).padStart(2, '0')}
                  </span>
                  <span className="hidden w-full truncate text-center text-[10px] text-[#808080] lg:block">
                    {labels.stageName(stage.index)}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-3 rounded-xl border border-[#404040] bg-[#1E1E1E] p-3">
            {currentStage ? (
              (() => {
                const Icon = STAGE_ICONS[currentStage.index]
                const latest = (logsByStage.get(currentStage.index) ?? []).at(-1)
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-[#60A5FA]" />
                      <Icon className="h-5 w-5 text-[#60A5FA]" />
                      <p className="text-[15px] font-semibold text-white">
                        {t('run.now')}: {String(currentStage.number).padStart(2, '0')}{' '}
                        {labels.stageName(currentStage.index)}
                      </p>
                      <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#93C5FD]">
                        <Clock3 className="h-3.5 w-3.5" />
                        {labels.duration(stageDuration(currentStage))}
                      </span>
                    </div>
                    <p className="mt-2 truncate font-mono text-[12px] text-[#9CA3AF]">
                      {latest ? latest.message : t('run.waitingFirstLog')}
                    </p>
                  </>
                )
              })()
            ) : (
              <div className="flex items-center gap-2 text-[14px] text-[#D1D5DB]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: toneColor }} />
                {jobStatus === 'queued'
                  ? t('run.queuedHint')
                  : jobStatus === 'running'
                    ? t('run.awaitingStage')
                    : t('run.finishedTotal', {
                        message: headlineMessage,
                        duration: labels.duration(totalElapsed),
                      })}
              </div>
            )}
          </div>
        </Card>

        {/* ── Stage cards ───────────────────────────────────────────── */}
        <Accordion type="multiple" value={openStages} onValueChange={setOpenStages} className="space-y-3">
          {stages.map((stage) => (
            <StageCard
              key={stage.index}
              stage={stage}
              isCurrent={stage.index === progress.currentIndex}
              duration={stageDuration(stage)}
              logs={logsByStage.get(stage.index) ?? []}
              labels={labels}
              onShowInFullLog={() => showStageLogs(stage.index)}
              action={
                // The security gate stopped here pending approval: review it in place.
                stage.key === 'gate' && awaitingApproval ? (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#EA580C] bg-[#7C2D12]/30 p-2.5">
                    <p className="text-[12px] text-[#FED7AA]">{t('run.approval.stageHint')}</p>
                    <Button
                      type="button"
                      onClick={() => setApprovalOpen(true)}
                      className="h-8 shrink-0 bg-[#EA580C] px-3 text-[12px] font-semibold text-white shadow-none hover:bg-[#C2410C]"
                    >
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> {t('run.approval.review')}
                    </Button>
                  </div>
                ) : null
              }
            />
          ))}
        </Accordion>

        {/* ── Real-time overall logs ────────────────────────────────── */}
        <Accordion type="single" collapsible value={logsOpen} onValueChange={setLogsOpen}>
          <AccordionItem value="all-logs" className="rounded-2xl border border-[#404040] bg-[#262626] p-4">
            <AccordionTrigger className="py-0 hover:no-underline">
              <div className="flex w-full flex-wrap items-center justify-between gap-2 pr-3">
                <p className="text-[16px] font-semibold text-white">{t('run.logs.title')}</p>
                <div className="flex items-center gap-3 text-[12px]">
                  <span className="inline-flex items-center gap-1.5" style={{ color: connectionStyle.color }}>
                    <span
                      className={`h-2 w-2 rounded-full ${connectionStyle.pulse ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: connectionStyle.color }}
                    />
                    {t(`run.connection.${connection}`)}
                  </span>
                  <span className="text-[#6B7280]">
                    {visibleLogs.length === logs.length
                      ? t('run.logs.lines', { count: logs.length })
                      : t('run.logs.linesFiltered', { shown: visibleLogs.length, total: logs.length })}
                  </span>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              {/* Liveness: lets the user tell a quiet step from a stalled engine. */}
              {!isTerminal ? (
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#9CA3AF]" role="status">
                  <span>
                    {t('run.activity.lastLog')}:{' '}
                    {activity.lastLogAt === null
                      ? t('run.activity.none')
                      : t('run.activity.secondsAgo', { secs: Math.max(0, Math.floor((localNow - activity.lastLogAt) / 1000)) })}
                  </span>
                  <span>
                    {t('run.activity.engine')}:{' '}
                    {activity.lastEngineAt === null
                      ? t('run.activity.checking')
                      : t('run.activity.secondsAgo', { secs: Math.max(0, Math.floor((localNow - activity.lastEngineAt) / 1000)) })}
                    {activity.lastEngineAt !== null && localNow - activity.lastEngineAt > 30_000 ? (
                      <span className="text-[#FBBF24]"> · {t('run.activity.delayed')}</span>
                    ) : null}
                  </span>
                  {activity.lastEngineAt !== null &&
                  localNow - activity.lastEngineAt <= 30_000 &&
                  (activity.lastLogAt === null || localNow - activity.lastLogAt > 10_000) ? (
                    <span>{t('run.activity.waitingOutput')}</span>
                  ) : null}
                </div>
              ) : null}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={String(logFilter.stage)}
                  onChange={(event) => {
                    const value = event.target.value
                    setLogFilter((previous) => ({
                      ...previous,
                      stage: value === 'all' || value === 'general' ? value : Number(value),
                    }))
                  }}
                  className="h-8 rounded-lg border border-[#404040] bg-[#1E1E1E] px-2 text-[12px] text-[#E5E7EB]"
                  aria-label={t('run.logs.filterStage')}
                >
                  <option value="all">{t('run.logs.allStages')}</option>
                  {PIPELINE_STAGES.map((def, index) => (
                    <option key={def.number} value={index}>
                      {def.number}. {labels.stageName(index)}
                    </option>
                  ))}
                  <option value="general">{t('run.logs.general')}</option>
                </select>
                <div className="flex flex-wrap gap-1" role="group" aria-label={t('run.logs.filterLevel')}>
                  {LOG_LEVELS.map((level) => {
                    const active = logFilter.levels.has(level)
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleLevel(level)}
                        className={`h-8 rounded-lg border px-2 text-[11px] font-semibold ${
                          active
                            ? `border-[#5B5B5B] bg-[#2E2E2E] ${LEVEL_CLASS[level]}`
                            : 'border-[#404040] bg-transparent text-[#6B7280] line-through'
                        }`}
                      >
                        {labels.level(level)}
                      </button>
                    )
                  })}
                </div>
                <div className="ml-auto flex gap-1">
                  {!following ? (
                    <Button type="button" variant="outline" className="h-8 px-2 text-[12px] shadow-none" onClick={jumpToLatest}>
                      <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> {t('run.logs.jumpLatest')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-2 text-[12px] shadow-none"
                    onClick={() => void copyLogs()}
                    disabled={visibleLogs.length === 0}
                  >
                    {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                    {copied ? t('run.logs.copied') : t('run.logs.copy')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-2 shadow-none"
                    onClick={() => setLogsExpanded((value) => !value)}
                    aria-label={logsExpanded ? t('run.logs.collapse') : t('run.logs.expand')}
                    title={logsExpanded ? t('run.logs.collapse') : t('run.logs.expand')}
                  >
                    {logsExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
              <div
                ref={logContainerRef}
                onScroll={(event) => {
                  const el = event.currentTarget
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
                  followRef.current = atBottom
                  if (atBottom !== following) setFollowing(atBottom)
                }}
                className={`${logsExpanded ? 'max-h-[70vh]' : 'max-h-96'} overflow-y-auto rounded-md border border-[#404040] bg-[#0F0F0F] p-3`}
              >
                <LogLines
                  entries={visibleLogs}
                  showStage={logFilter.stage === 'all'}
                  labels={labels}
                  emptyText={
                    logs.length > 0
                      ? t('run.logs.noMatch')
                      : isTerminal
                        ? t('run.logs.none')
                        : t('run.logs.waiting')
                  }
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {cancelError !== null && !isCancelDialogOpen ? (
          <p className="text-right text-[13px] text-[#FCA5A5]" title={cancelError || undefined}>
            {t('run.cancelFailed')}
          </p>
        ) : null}

        {startTiming ? (
          // Start latency for runs launched from this device (click → API →
          // screen → first stage), so it can be measured in the installed app.
          <p className="text-right text-[11px] text-[#6B7280]" data-testid="start-timing">
            {t('run.timing.label')}: {t('run.timing.api')} {formatMs(startTiming.apiResponse)} · {t('run.timing.screen')}{' '}
            {formatMs(startTiming.screenShown)} · {t('run.timing.firstStage')} {formatMs(startTiming.firstStage)}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {deployUrl ? (
            <Button asChild variant="outline" className="shadow-none">
              <a href={deployUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" />
                {t('run.openDeployment')}
              </a>
            </Button>
          ) : null}
          {!isTerminal ? (
            <Button
              onClick={() => setIsCancelDialogOpen(true)}
              disabled={isCancelling}
              className="border border-[#7F1D1D] bg-transparent text-[#FCA5A5] shadow-none hover:bg-[#450A0A]/40"
            >
              {isCancelling ? t('run.cancelling') : t('run.cancel')}
            </Button>
          ) : null}
          <Button
            onClick={() => navigate('/pipeline/result', { state: { jobId, repoName, branch } })}
            disabled={!isTerminal}
            className="shadow-none"
          >
            {t('run.securityResult')}
          </Button>
        </div>
      </section>

      <Dialog open={isCancelDialogOpen} onOpenChange={(open) => !isCancelling && setIsCancelDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('run.cancelDialog.title')}</DialogTitle>
            <DialogDescription>{t('run.cancelDialog.description')}</DialogDescription>
            {cancelError !== null ? (
              <p className="mt-2 text-sm text-[#FCA5A5]" title={cancelError || undefined}>
                {t('run.cancelFailed')}
              </p>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCancelDialogOpen(false)}
              disabled={isCancelling}
            >
              {t('run.cancelDialog.keep')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCancel()}
              disabled={isCancelling}
              className="bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  {t('run.cancelling')}
                </>
              ) : (
                t('run.cancel')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {awaitingApproval ? (
        <DeployApprovalDialog
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
          jobId={jobId}
          repoName={repoName}
          branch={branch}
          counts={approvalCounts}
          findings={approvalFindings}
          reasons={approvalReasons}
        />
      ) : null}
    </MainLayout>
  )
}

function StageCard({ stage, isCurrent, duration, logs, labels, onShowInFullLog, action }: {
  stage: StageView
  isCurrent: boolean
  duration: number | null
  logs: ResolvedLogEntry[]
  labels: Labels
  onShowInFullLog: () => void
  /** Shown right under the error details (e.g. the gate's approval button). */
  action?: ReactNode
}) {
  const { t } = labels
  const Icon = STAGE_ICONS[stage.index]
  const color = STATUS_COLOR[stage.status]
  const canOpen = stage.status !== 'pending' || logs.length > 0 || Boolean(stage.errorMessage)
  const borderColor =
    stage.status === 'success' || stage.status === 'failed' || stage.status === 'running'
      ? color
      : undefined
  const startedAt = formatClock(toMs(stage.startedAt))
  const endedAt = formatClock(toMs(stage.endedAt))

  return (
    <AccordionItem
      id={`stage-card-${stage.index}`}
      value={stageKey(stage.index)}
      className={`scroll-mt-4 rounded-2xl border border-[#404040] bg-[#262626] p-4 transition-[border-color,opacity] duration-300 ${
        stage.status === 'pending' && !isCurrent ? 'opacity-60' : ''
      }`}
      style={borderColor ? { borderColor } : undefined}
    >
      <AccordionTrigger
        disabled={!canOpen}
        className={`py-0 hover:no-underline disabled:cursor-default disabled:opacity-100 ${canOpen ? '' : '[&>svg]:hidden'}`}
      >
        <div className="flex w-full min-w-0 flex-col gap-2 pr-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <StageStatusIcon status={stage.status} animate={isCurrent} className="h-7 w-7 shrink-0" />
            <span className="font-mono text-[13px] text-[#808080]">
              {String(stage.number).padStart(2, '0')}
            </span>
            <Icon className="h-5 w-5 shrink-0 text-[#6B7280]" />
            <span className="truncate text-left text-[18px] font-semibold text-white">
              {labels.stageName(stage.index)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 pl-10 text-[12px] text-[#9CA3AF] sm:pl-0">
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{ color, borderColor: color }}
            >
              {labels.status(stage.status)}
            </span>
            <span className="inline-flex items-center gap-1" title={t('run.stageCard.duration')}>
              <Clock3 className="h-3.5 w-3.5" />
              <span style={stage.status === 'running' ? { color } : undefined}>
                {labels.duration(duration)}
              </span>
            </span>
            <span className="hidden md:inline" title={`${t('run.stageCard.start')} → ${t('run.stageCard.end')}`}>
              {startedAt} → {endedAt}
            </span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-3">
        <div className="mb-2 grid grid-cols-3 gap-2 text-[12px] text-[#9CA3AF] md:hidden">
          <span>{t('run.stageCard.start')} {startedAt}</span>
          <span>{t('run.stageCard.end')} {endedAt}</span>
          <span>{t('run.stageCard.duration')} {labels.duration(duration)}</span>
        </div>
        {stage.status === 'failed' || stage.errorMessage ? (
          <div className="mb-2 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-[12px] text-[#FCA5A5]">
            <p className="font-semibold">{t('run.stageCard.errorDetails')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words">
              {stage.errorMessage || t('run.stageCard.noErrorReason')}
            </p>
          </div>
        ) : null}
        {action}
        <div className="max-h-72 overflow-y-auto rounded-md border border-[#404040] bg-[#1E1E1E] p-3">
          <LogLines
            entries={logs}
            showStage={false}
            labels={labels}
            emptyText={
              stage.status === 'running'
                ? t('run.stageCard.runningEmpty')
                : stage.status === 'pending'
                  ? t('run.stageCard.pendingEmpty')
                  : stage.status === 'skipped'
                    ? t('run.stageCard.skippedEmpty')
                    : t('run.stageCard.noLogs')
            }
          />
        </div>
        {logs.length > 0 ? (
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={onShowInFullLog} className="text-[12px] text-[#93C5FD] hover:underline">
              {t('run.stageCard.showInFullLog')}
            </button>
          </div>
        ) : null}
      </AccordionContent>
    </AccordionItem>
  )
}
