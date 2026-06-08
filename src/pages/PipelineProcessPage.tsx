import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  CodeXml,
  FlaskConical,
  GitBranch,
  Hammer,
  Loader2,
  Package,
  Rocket,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  cancelPipeline,
  fetchJobDetail,
  fetchPipelineLogs,
  setRepoDomainUrl,
  setRepoPipelineInfo,
  type JobDetail,
  type JobStep,
} from '@/lib/api'

type LocationState = {
  jobId?: string
  repoName?: string
  branch?: string
}

// 800ms is a compromise: short enough to catch any incremental log flushes
// the backend might do mid-step, long enough to keep backend load
// reasonable. The backend currently appears to buffer logs and only flush
// them at pipeline end — see the user-facing "로그 수신 대기 중..." message
// for the resulting UX. Lowering this further wouldn't help unless the
// backend supports SSE/streaming.
const POLL_INTERVAL_MS = 800
// After a job reaches a terminal status (success/failed/cancelled) the
// runner may still flush trailing log lines for a beat. Keep polling for
// a short grace window so the user actually sees the final logs instead
// of "수집된 로그가 없습니다".
const TERMINAL_GRACE_POLLS = 3
const TERMINAL_JOB_STATUSES = new Set(['success', 'failed', 'cancelled'])
const TERMINAL_STEP_STATUSES = new Set(['success', 'failed', 'cancelled', 'skipped'])

const stepIconMap: { match: RegExp; icon: ComponentType<{ className?: string }> }[] = [
  { match: /clone|checkout|git|레포|클론/i, icon: GitBranch },
  { match: /install|deps|dependen|npm|pip|pnpm|yarn|의존성|설치/i, icon: Package },
  // Security Gate must be checked BEFORE the generic /security/ pattern,
  // otherwise the gate step would be classified as a regular scan step.
  { match: /gate|verdict|threshold|게이트/i, icon: ShieldCheck },
  { match: /deep|deep-scan|sast-deep|심화/i, icon: ShieldAlert },
  { match: /scan|secret|gitleaks|semgrep|sast|security|보안|검사/i, icon: Shield },
  { match: /test|lint|coverage|테스트/i, icon: FlaskConical },
  { match: /build|compile|bundle|빌드/i, icon: Hammer },
  { match: /deploy|release|publish|배포/i, icon: Rocket },
]

const PLACEHOLDER_STEPS: JobStep[] = [
  { stepId: 'ph-clone', stepName: '레포지토리 클론', stepType: 'clone', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-install', stepName: '의존성 설치', stepType: 'install', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-scan-light', stepName: '경량 보안 검사', stepType: 'security-light', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-test', stepName: '테스트', stepType: 'test', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-scan-deep', stepName: '심화 보안 검사', stepType: 'security-deep', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-security-gate', stepName: '보안 게이트', stepType: 'security-gate', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-build', stepName: '빌드', stepType: 'build', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-deploy', stepName: '배포', stepType: 'deploy', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
]

function iconForStep(step: JobStep): ComponentType<{ className?: string }> {
  const haystack = `${step.stepName} ${step.stepType}`
  for (const entry of stepIconMap) {
    if (entry.match.test(haystack)) return entry.icon
  }
  return ShieldAlert
}

function formatDuration(totalSeconds: number) {
  if (!totalSeconds || totalSeconds < 0) return '0s'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function buildStableLogTimestamps(count: number, totalSeconds: number) {
  if (count <= 0) return []
  const total = Math.max(0, Math.round(totalSeconds || 0))
  if (count === 1) return [total]
  return Array.from({ length: count }, (_, idx) =>
    Math.min(total, Math.round((total * idx) / (count - 1))),
  )
}

function boundedDurationSecs(value: number, capSecs: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const rounded = Math.max(1, Math.round(value))
  const cap = Math.max(0, Math.round(capSecs || 0))
  if (cap > 0 && rounded > Math.max(1, Math.ceil(cap * 1.2))) return null
  return rounded
}

function backendStepDurationSecs(step: JobStep, capSecs: number): number | null {
  const explicitDuration = boundedDurationSecs(step.durationSecs ?? 0, capSecs)
  if (explicitDuration !== null) return explicitDuration

  if (step.startedAt && step.endedAt) {
    const startMs = Date.parse(step.startedAt)
    const endMs = Date.parse(step.endedAt)
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
      return boundedDurationSecs((endMs - startMs) / 1000, capSecs)
    }
  }

  return null
}

function stepDurationStorageKey(jobId: string) {
  return `secupipeline:step-durations:${jobId}`
}

function readStepDurationCache(jobId: string): Record<string, number> {
  if (!jobId) return {}
  try {
    const raw = window.localStorage.getItem(stepDurationStorageKey(jobId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'number' && value >= 0),
    ) as Record<string, number>
  } catch {
    return {}
  }
}

function writeStepDurationCache(jobId: string, durations: Record<string, number>) {
  if (!jobId) return
  try {
    window.localStorage.setItem(stepDurationStorageKey(jobId), JSON.stringify(durations))
  } catch {
    // localStorage can be unavailable in hardened desktop/webview contexts.
  }
}

function statusColor(status: JobStep['status']): string {
  switch (status) {
    case 'success':
      return '#3ECF8E'
    case 'failed':
      return '#EF4444'
    case 'running':
      return '#F59E0B'
    case 'skipped':
      return '#6B7280'
    default:
      return '#404040'
  }
}

function statusLabel(status: JobStep['status']): string {
  switch (status) {
    case 'success':
      return '성공'
    case 'failed':
      return '실패'
    case 'running':
      return '진행 중'
    case 'skipped':
      return '건너뜀'
    default:
      return '대기'
  }
}

function StepStatusIcon({ status }: { status: JobStep['status'] }) {
  if (status === 'success') return <CheckCircle2 className="h-7 w-7 text-[#3ECF8E]" />
  if (status === 'failed') return <XCircle className="h-7 w-7 text-[#EF4444]" />
  if (status === 'running') return <Loader2 className="h-7 w-7 animate-spin text-[#F59E0B]" />
  return <CircleDashed className="h-7 w-7 text-[#6B7280]" />
}

function jobStatusBadge(status: string): { label: string; dotColor: string } {
  switch (status) {
    case 'success':
      return { label: '성공', dotColor: '#3ECF8E' }
    case 'failed':
      return { label: '실패', dotColor: '#EF4444' }
    case 'cancelled':
      return { label: '취소됨', dotColor: '#6B7280' }
    case 'running':
      return { label: '실행 중', dotColor: '#F59E0B' }
    case 'queued':
      return { label: '대기 중', dotColor: '#6B7280' }
    default:
      return { label: status || '-', dotColor: '#6B7280' }
  }
}

export function PipelineProcessPage() {
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState
  const jobId = locationState.jobId ?? ''
  // Same scheme as DashboardPage/RepositoryDetailPage: 16-char prefix
  // of the auth token. Used to scope per-user localStorage entries (e.g.
  // the auto-extracted deploy domain).
  const cacheKey = token ? token.slice(0, 16) : 'anonymous'

  const [job, setJob] = useState<JobDetail | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  // Elapsed-seconds-since-job-start for each log line, captured the first
  // time we observe it. Lets us render "+12s [build.log] ..." on the line
  // even though the backend's lines are plain strings without timestamps.
  const [logTimestamps, setLogTimestamps] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [, setIsInitialLoading] = useState(true)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const [storedStepDurations, setStoredStepDurations] = useState<Record<string, number>>(() =>
    readStepDurationCache(jobId),
  )
  // Steps the user has expanded. We auto-add the running step's key so its
  // logs are visible without a manual click, but never auto-close items.
  const [openSteps, setOpenSteps] = useState<string[]>([])

  // Frontend-observed per-step lifecycle: when we first saw the step
  // transition to running, when it terminated, and where in the global
  // log array the boundaries fell. This is our source of truth for
  // per-step duration AND for slicing logs when the backend's per-step
  // timestamps / log prefixes are missing. Without this, a step with no
  // dedicated [stepname.log] tag and no startedAt/endedAt would render
  // empty logs even though they sit in the global panel.
  type StepLifecycleEntry = {
    observedStartMs: number
    observedEndMs: number | null
    startLogIdx: number
    endLogIdx: number | null
  }
  const [stepLifecycle, setStepLifecycle] = useState<
    Record<string, StepLifecycleEntry>
  >({})

  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const lastLogCount = useRef(0)
  const startedAtMsRef = useRef<number | null>(null)
  const terminalPollCountRef = useRef(0)
  const hasObservedLiveRunRef = useRef(false)
  // Last live-computed duration per step. Lets a step keep showing its real
  // elapsed (e.g. 12s) right when status flips running→success, before the
  // backend has filled durationSecs/endedAt. Without this the cell snaps to
  // "0s" for a poll cycle or two and looks wrong.
  const lastLiveStepDurationRef = useRef<Record<string, number>>({})

  useEffect(() => {
    setStoredStepDurations(readStepDurationCache(jobId))
  }, [jobId])

  useEffect(() => {
    if (!jobId || !token) {
      setIsInitialLoading(false)
      return
    }

    let cancelled = false
    let timer: number | null = null

    async function tick() {
      let isTerminal = false
      let nextJobForTick: JobDetail | null = null
      // Fetch independently so a transient failure in one endpoint does not
      // discard the other's payload (e.g. logs must keep streaming even if
      // job detail blips, and vice versa).
      const [jobResult, logsResult] = await Promise.allSettled([
        fetchJobDetail(token!, jobId),
        fetchPipelineLogs(token!, jobId),
      ])
      if (cancelled) return

      let detailError: unknown = null
      if (jobResult.status === 'fulfilled') {
        const nextJob = jobResult.value
        if (nextJob) {
          nextJobForTick = nextJob
          setJob(nextJob)
          isTerminal = TERMINAL_JOB_STATUSES.has(nextJob.status)
          if (!isTerminal) {
            hasObservedLiveRunRef.current = true
          }
        }
      } else {
        detailError = jobResult.reason
        console.error('[pipeline-poll] job detail failed:', detailError)
      }

      if (logsResult.status === 'fulfilled') {
        const nextLogs = logsResult.value
        // Don't wipe accumulated logs on an empty response. The backend
        // returns [] both for "no logs yet" and for transient errors; in
        // either case keep the lines we already have so failures still
        // show the captured output.
        setLogs((prev) => (nextLogs.length === 0 && prev.length > 0 ? prev : nextLogs))

        // Stamp each NEW line with its elapsed-since-job-start so the user
        // sees real-time "+5s [build.log] ..." in the log panel. We only
        // append for lines we haven't seen before; existing line indexes
        // keep their original timestamp.
        if (nextJobForTick && TERMINAL_JOB_STATUSES.has(nextJobForTick.status)) {
          setLogTimestamps((prev) =>
            nextLogs.length === 0
              ? prev
              : buildStableLogTimestamps(nextLogs.length, nextJobForTick.durationSecs),
          )
        } else {
          const jobStartMs = startedAtMsRef.current
          if (jobStartMs !== null) {
            const elapsed = Math.max(0, Math.round((Date.now() - jobStartMs) / 1000))
            setLogTimestamps((prev) => {
              if (nextLogs.length === 0) return prev
              if (nextLogs.length <= prev.length) return prev.slice(0, nextLogs.length)
              const additions = nextLogs.length - prev.length
              return [...prev, ...new Array<number>(additions).fill(elapsed)]
            })
          }
        }
      } else {
        console.error('[pipeline-poll] logs fetch failed:', logsResult.reason)
      }

      // Only surface an error to the UI if BOTH fetches failed — otherwise
      // the user still gets useful data and shouldn't see a red banner.
      if (detailError && logsResult.status === 'rejected') {
        setError(
          detailError instanceof Error
            ? detailError.message
            : '파이프라인 상태를 가져오지 못했습니다.',
        )
      } else {
        setError(null)
      }

      setIsInitialLoading(false)

      // Keep polling for a short grace window after terminal status so any
      // trailing logs (final failure message, last build line) actually
      // reach the UI before we stop.
      if (!isTerminal) {
        terminalPollCountRef.current = 0
        timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      } else if (terminalPollCountRef.current < TERMINAL_GRACE_POLLS) {
        terminalPollCountRef.current += 1
        timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    tick()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [jobId, token])

  useEffect(() => {
    if (!logContainerRef.current) return
    if (logs.length === lastLogCount.current) return
    lastLogCount.current = logs.length
    const el = logContainerRef.current
    el.scrollTop = el.scrollHeight
  }, [logs])

  const repoName = job?.repoName || locationState.repoName || ''
  const branch = job?.branch || locationState.branch || ''
  const apiSteps = job?.steps ?? []
  const jobStatus = job?.status ?? 'queued'
  const jobBadge = jobStatusBadge(jobStatus)
  const isTerminal = TERMINAL_JOB_STATUSES.has(jobStatus)

  const hasJobStarted = !!(
    job?.startedAt ||
    (jobStatus && jobStatus !== 'queued') ||
    apiSteps.some((s) => s.status !== 'pending') ||
    logs.length > 0
  )

  useEffect(() => {
    // Priority 1: backend's authoritative startedAt — set every time it changes
    if (job?.startedAt) {
      const ms = Date.parse(job.startedAt)
      if (!Number.isNaN(ms)) {
        startedAtMsRef.current = ms
      }
    } else if (hasJobStarted && startedAtMsRef.current === null) {
      // Priority 2: started but backend hasn't told us when → use now as fallback (once)
      startedAtMsRef.current = Date.now()
    }

    if (!hasJobStarted) {
      setElapsedSec(0)
      return
    }

    const start = startedAtMsRef.current
    if (start === null) return

    if (isTerminal) {
      if (job?.durationSecs && job.durationSecs > 0) {
        setElapsedSec(job.durationSecs)
      } else {
        setElapsedSec(Math.max(0, Math.round((Date.now() - start) / 1000)))
      }
      return
    }

    // Immediately seed once so we don't show 0 for a tick when refreshing mid-run
    setElapsedSec(Math.max(0, Math.round((Date.now() - start) / 1000)))

    const id = window.setInterval(() => {
      const s = startedAtMsRef.current
      if (s === null) return
      setElapsedSec(Math.max(0, Math.round((Date.now() - s) / 1000)))
    }, 1000)
    return () => window.clearInterval(id)
  }, [hasJobStarted, isTerminal, job?.startedAt, job?.durationSecs])

  type LogEntry = { line: string; elapsedSec: number }

  // Build a list of every log line with its elapsed-since-job-start. The
  // single flat list is the source of truth for both the bottom "실시간
  // 로그" panel and the per-step time-window fallback below.
  const allLogEntries: LogEntry[] = useMemo(
    () => logs.map((line, idx) => ({ line, elapsedSec: logTimestamps[idx] ?? 0 })),
    [logs, logTimestamps],
  )

  const stepLogsMap = useMemo(() => {
    const map = new Map<string, LogEntry[]>()
    // Try several tag patterns so we recognize the step bucket regardless
    // of which prefix style the backend chose. Order = priority:
    //   [name]            — anywhere in the line (timestamp prefixes OK)
    //   [name.log]        — same
    //   name:             — at start
    //   === name ===      — at start
    const tagPatterns: RegExp[] = [
      /\[([a-zA-Z][a-zA-Z0-9_-]{1,40})(?:\.log)?\]/,
      /^([a-zA-Z][a-zA-Z0-9_-]{1,40})\s*:\s/,
      /^={2,}\s*([a-zA-Z][a-zA-Z0-9_-]{1,40})\s*={2,}/,
    ]
    allLogEntries.forEach((entry) => {
      let key = '__general__'
      for (const pat of tagPatterns) {
        const m = entry.line.match(pat)
        if (m && m[1]) {
          key = m[1].toLowerCase()
          break
        }
      }
      const list = map.get(key) ?? []
      list.push(entry)
      map.set(key, list)
    })
    return map
  }, [allLogEntries])

  const generalLogEntries: LogEntry[] = stepLogsMap.get('__general__') ?? []

  // Compute a step's elapsed-since-job-start window so we can pull logs that
  // arrived *during* the step's lifetime even if their bracketed prefix
  // doesn't match the step name.
  const stepWindow = (step: JobStep): { start: number; end: number } | null => {
    const jobStartMs = startedAtMsRef.current
    if (jobStartMs === null || !step.startedAt) return null
    const startMs = Date.parse(step.startedAt)
    if (Number.isNaN(startMs)) return null
    const startElapsed = Math.max(0, Math.round((startMs - jobStartMs) / 1000))
    let endElapsed = Number.POSITIVE_INFINITY
    if (step.endedAt) {
      const endMs = Date.parse(step.endedAt)
      if (!Number.isNaN(endMs)) {
        endElapsed = Math.max(0, Math.round((endMs - jobStartMs) / 1000))
      }
    }
    return { start: startElapsed, end: endElapsed }
  }

  // Lifecycle keys are INDEX-based and stable across the placeholder→API
  // merge. Using stepId would break tracking because a placeholder's id
  // ('ph-clone') differs from the backend's stepId once it takes over —
  // we'd lose the running-window observation and the log slice would be
  // empty. Declared above any useMemo/effect that references it to avoid
  // TDZ when those callbacks run during the first render.
  const lifecycleKeyFor = (idx: number): string => `step-${idx}`
  const stepDurationKeyFor = (step: JobStep, idx: number): string =>
    `${idx}:${(step.stepType || step.stepName || step.stepId || 'step').toLowerCase()}`

  const lifecycleDurationFor = (idx: number, capSecs: number): number | null => {
    const lifecycle = stepLifecycle[lifecycleKeyFor(idx)]
    if (!lifecycle?.observedEndMs || lifecycle.observedEndMs <= lifecycle.observedStartMs) {
      return null
    }
    return boundedDurationSecs(
      (lifecycle.observedEndMs - lifecycle.observedStartMs) / 1000,
      capSecs,
    )
  }

  const findLogsForStep = (step: JobStep, key: string): LogEntry[] => {
    // 1. Exact / case-insensitive name match against the bracketed prefix
    const nameKey = step.stepName?.toLowerCase()
    if (nameKey && stepLogsMap.has(nameKey)) return stepLogsMap.get(nameKey)!
    const typeKey = step.stepType?.toLowerCase()
    if (typeKey && stepLogsMap.has(typeKey)) return stepLogsMap.get(typeKey)!

    // 2. Substring match — handles "[lightweight-security.log]" vs step
    //    type "security-light", etc.
    if (typeKey || nameKey) {
      for (const [logKey, lines] of stepLogsMap) {
        if (logKey === '__general__') continue
        if (
          (typeKey && (logKey.includes(typeKey) || typeKey.includes(logKey))) ||
          (nameKey && (logKey.includes(nameKey) || nameKey.includes(logKey)))
        ) {
          return lines
        }
      }
    }

    // 3. Frontend-observed lifecycle slice — the most reliable fallback
    //    when the backend doesn't tag logs per step.
    const life = stepLifecycle[key]
    if (life) {
      const start = life.startLogIdx
      const end = life.endLogIdx ?? allLogEntries.length
      if (end > start) {
        return allLogEntries.slice(start, end)
      }
    }

    // 4. Icon-class match (e.g. clone/checkout both → GitBranch icon)
    const stepIcon = iconForStep(step)
    for (const [logKey, lines] of stepLogsMap) {
      if (logKey === '__general__') continue
      const proxy: JobStep = { ...step, stepName: logKey, stepType: logKey }
      if (iconForStep(proxy) === stepIcon) return lines
    }

    // 5. Backend timestamp window fallback
    const window = stepWindow(step)
    if (window) {
      const within = allLogEntries.filter(
        (e) => e.elapsedSec >= window.start && e.elapsedSec <= window.end,
      )
      if (within.length > 0) return within
    }

    // 6. Running step with nothing matched yet → show the recent tail of
    //    unbucketed logs so the user always sees "what's happening now"
    //    instead of "로그 없음".
    if (step.status === 'running') {
      if (generalLogEntries.length > 0) return generalLogEntries.slice(-20)
      if (allLogEntries.length > 0) return allLogEntries.slice(-20)
    }

    return []
  }

  const logDurationFor = (step: JobStep, idx: number, capSecs: number): number | null => {
    const lines = findLogsForStep(step, lifecycleKeyFor(idx))
    if (lines.length < 2) return null
    const first = lines[0]?.elapsedSec
    const last = lines[lines.length - 1]?.elapsedSec
    if (typeof first !== 'number' || typeof last !== 'number' || last <= first) return null
    return boundedDurationSecs(last - first, capSecs)
  }

  async function handleCancel() {
    if (!token || !jobId || isCancelling) return
    setIsCancelling(true)
    try {
      await cancelPipeline(token, jobId)
      const refreshed = await fetchJobDetail(token, jobId)
      if (refreshed) setJob(refreshed)
      setError(null)
      setIsCancelDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '파이프라인 취소에 실패했습니다.')
    } finally {
      setIsCancelling(false)
    }
  }

  const steps: JobStep[] = useMemo(() => {
    const usedApi = new Set<number>()
    const merged: JobStep[] = PLACEHOLDER_STEPS.map((placeholder) => {
      const placeholderIcon = iconForStep(placeholder)
      const apiIdx = apiSteps.findIndex((api, i) => {
        if (usedApi.has(i)) return false
        if (api.stepType && placeholder.stepType && api.stepType === placeholder.stepType) return true
        if (api.stepName && placeholder.stepName && api.stepName === placeholder.stepName) return true
        return iconForStep(api) === placeholderIcon
      })
      if (apiIdx >= 0) {
        usedApi.add(apiIdx)
        return { ...apiSteps[apiIdx], stepName: apiSteps[apiIdx].stepName || placeholder.stepName }
      }
      // No API step yet — keep placeholder, but flip to 'running' if logs
      // already arrived for it. Use the placeholder's stable index for the
      // lifecycle key so the lookup matches what we'll use after merge.
      const placeholderIdx = PLACEHOLDER_STEPS.indexOf(placeholder)
      const matchedLogs = findLogsForStep(placeholder, lifecycleKeyFor(placeholderIdx))
      if (matchedLogs.length > 0 && placeholder.status === 'pending') {
        return { ...placeholder, status: 'running' as const }
      }
      return placeholder
    })
    // Append unmatched API steps (extras the backend reports beyond our 8-step template)
    apiSteps.forEach((api, i) => {
      if (!usedApi.has(i)) merged.push(api)
    })
    return merged
    // findLogsForStep depends on stepLogsMap which depends on logs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiSteps, stepLogsMap])

  // Sequential reveal queue. The backend often batches 3–4 step completions
  // into a single poll, so without throttling we'd see them all flip from
  // "pending → success" simultaneously with the same timestamp (which is
  // why the user was seeing "0s / 1s" timings). We instead reveal one
  // completed step at a time, ~900ms apart, so the user sees a natural
  // one-by-one progression with each step's clock visible.
  //
  // Initial value of `null` means "we haven't observed any state yet" —
  // on first observation we snap revealedCount to whatever's already
  // complete (so users navigating to a finished pipeline see everything
  // immediately, not animated from scratch).
  // Shorter than the original 900ms so the visual reveal keeps up with
  // fast pipelines — otherwise reveal lags behind the backend and the user
  // sees logs only after the queue finishes animating.
  const isHistorySnapshot = isTerminal && !hasObservedLiveRunRef.current && apiSteps.length > 0

  const REVEAL_INTERVAL_MS = 450
  const [revealedCount, setRevealedCount] = useState<number | null>(null)
  // Wall-clock time each step transitioned to "displayed complete" — used
  // to derive a believable displayed duration when the backend's data is
  // unreliable.
  const [, setStepRevealTimes] = useState<Record<number, number>>({})
  // logs.length captured at the moment each step revealed as complete.
  // Lets the accordion of step N show logs that arrived between step (N-1)
  // reveal and step N reveal as belonging to step N. Tag matching still
  // takes precedence — this is the fallback for untagged logs.
  const [stepRevealLogCounts, setStepRevealLogCounts] = useState<Record<number, number>>({})

  // First observation: snap reveal to current completed count, no animation.
  useEffect(() => {
    if (revealedCount !== null) return
    if (steps.length === 0) return
    if (isHistorySnapshot) {
      setRevealedCount(steps.length)
      setStepRevealTimes({})
      return
    }
    const completed = steps.filter((s) => TERMINAL_STEP_STATUSES.has(s.status)).length
    setRevealedCount(completed)
    // Backfill reveal times for already-completed steps using backend
    // endedAt when present so their cards show *some* timing instead of 0.
    if (completed > 0) {
      const now = Date.now()
      const backfill: Record<number, number> = {}
      for (let i = 0; i < completed; i += 1) {
        const endedAt = steps[i]?.endedAt
        const parsed = endedAt ? Date.parse(endedAt) : Number.NaN
        backfill[i] = !Number.isNaN(parsed) ? parsed : now
      }
      setStepRevealTimes(backfill)
    }
    // Intentionally only runs once we know steps — depend on steps but
    // re-check with the guard above.
  }, [steps, revealedCount, isHistorySnapshot])

  // Advance reveal toward the actual completion count, one step per tick.
  useEffect(() => {
    if (revealedCount === null) return
    if (isHistorySnapshot) return
    const actualCompleted = steps.filter((s) =>
      TERMINAL_STEP_STATUSES.has(s.status),
    ).length
    if (revealedCount >= actualCompleted) return
    const id = window.setTimeout(() => {
      setRevealedCount((prev) => {
        if (prev === null) return prev
        const next = Math.min(prev + 1, actualCompleted)
        setStepRevealTimes((map) => ({ ...map, [next - 1]: Date.now() }))
        return next
      })
    }, REVEAL_INTERVAL_MS)
    return () => window.clearTimeout(id)
  }, [revealedCount, steps, isHistorySnapshot])

  // Capture logs.length at the moment of each reveal so the per-step
  // accordion can show the logs that arrived between the previous reveal
  // and this one. This effect can re-fire on log polls but the guard
  // ensures we only WRITE once per revealedCount value (no-op otherwise).
  //
  // CRITICAL: this is a SEPARATE effect from reveal-advance so logs.length
  // never appears in the advance effect's deps — that would cancel the
  // 900ms setTimeout on every poll and freeze the reveal queue.
  useEffect(() => {
    if (revealedCount === null || revealedCount === 0) return
    const justRevealed = revealedCount - 1
    setStepRevealLogCounts((prev) =>
      prev[justRevealed] !== undefined
        ? prev
        : { ...prev, [justRevealed]: logs.length },
    )
  }, [revealedCount, logs.length])

  // Per-step displayed duration. Priority:
  //   1. revealTime[idx] - revealTime[idx-1]  (frontend-observed gap —
  //      our most reliable signal when backend timings are noisy)
  //   2. backend (endedAt - startedAt)
  //   3. backend durationSecs (only if > 0)
  //   4. 1s default — guarantees no "0초" displayed.
  const rawDisplayedDurationFor = (step: JobStep, idx: number): number => {
    if (step.status === 'skipped') return 0

    const capSecs = job?.durationSecs && job.durationSecs > 0 ? job.durationSecs : elapsedSec
    const storedDuration = boundedDurationSecs(
      storedStepDurations[stepDurationKeyFor(step, idx)] ?? -1,
      capSecs,
    )
    const backendDuration = backendStepDurationSecs(step, capSecs)
    const lifecycleDuration = lifecycleDurationFor(idx, capSecs)
    const liveDuration = boundedDurationSecs(
      lastLiveStepDurationRef.current[lifecycleKeyFor(idx)] ?? -1,
      capSecs,
    )
    const logDuration = logDurationFor(step, idx, capSecs)

    if (storedDuration !== null) return storedDuration
    if (backendDuration !== null) return backendDuration
    if (lifecycleDuration !== null) return lifecycleDuration
    if (liveDuration !== null) return liveDuration
    if (logDuration !== null) return logDuration

    return isHistorySnapshot ? 0 : 1
  }

  // Effective display status: respect the reveal queue. A step that the
  // backend has marked complete but the reveal queue hasn't reached yet
  // is shown as running (the next one up) or pending (further out).
  const displayedStatusFor = (idx: number, real: JobStep['status']): JobStep['status'] => {
    if (isHistorySnapshot) return real
    if (revealedCount === null) return real
    if (idx < revealedCount) return real
    if (!TERMINAL_STEP_STATUSES.has(real)) return real
    // Backend says done, reveal hasn't caught up — show the next-up
    // step as running, the rest as pending, so the UI feels sequential.
    return idx === revealedCount ? 'running' : 'pending'
  }

  // Currently running step — surfaced to the top "execution status" panel
  // and to the auto-open accordion logic so the user always sees what's
  // happening RIGHT NOW without having to click into a step. Picks the
  // first step whose DISPLAYED status is running.
  const currentStepIdx =
    isTerminal || isHistorySnapshot
      ? -1
      : steps.findIndex((s, idx) => displayedStatusFor(idx, s.status) === 'running')
  const currentStep = currentStepIdx >= 0 ? steps[currentStepIdx] : null

  // Count how many steps the user currently SEES as success — driven by
  // the reveal queue, not the raw backend status, so the "X/Y 단계 통과"
  // counter ticks up in sync with the visual reveal.
  const successCount = steps.filter(
    (s, idx) => displayedStatusFor(idx, s.status) === 'success',
  ).length

  const displayedStepDurations = (() => {
    const raw = steps.map((step, idx) => rawDisplayedDurationFor(step, idx))
    const totalCap = job?.durationSecs && job.durationSecs > 0 ? job.durationSecs : elapsedSec
    if (totalCap <= 0) return raw

    const cappedIndexes = steps
      .map((step, idx) => ({ idx, status: displayedStatusFor(idx, step.status), duration: raw[idx] ?? 0 }))
      .filter(({ status, duration }) => TERMINAL_STEP_STATUSES.has(status) && duration > 0)

    const sum = cappedIndexes.reduce((acc, item) => acc + item.duration, 0)
    if (sum <= totalCap) return raw

    const next = [...raw]
    const scale = totalCap / sum
    cappedIndexes.forEach(({ idx, duration }) => {
      next[idx] = Math.max(1, Math.floor(duration * scale))
    })

    let scaledSum = cappedIndexes.reduce((acc, { idx }) => acc + (next[idx] ?? 0), 0)
    while (scaledSum > totalCap) {
      const target = cappedIndexes
        .filter(({ idx }) => (next[idx] ?? 0) > 1)
        .sort((a, b) => (next[b.idx] ?? 0) - (next[a.idx] ?? 0))[0]
      if (!target) break
      next[target.idx] = (next[target.idx] ?? 1) - 1
      scaledSum -= 1
    }

    return next
  })()

  // When the deploy step finishes successfully, scan its logs for an
  // http(s) URL and persist it as this repo's deployment domain. The
  // RepositoryDetailPage reads from the same localStorage key
  // (keyed by job.repoName) and renders it in the "도메인 주소" card so
  // the user no longer needs to type it manually.
  const lastDomainExtractedRef = useRef<string | null>(null)
  useEffect(() => {
    const repoName = job?.repoName
    if (!repoName) return
    const deployIdx = steps.findIndex((s) =>
      /deploy|배포|release|publish/i.test(`${s.stepName} ${s.stepType}`),
    )
    if (deployIdx < 0) return
    const deployStep = steps[deployIdx]
    if (deployStep.status !== 'success') return
    const lines = findLogsForStep(deployStep, lifecycleKeyFor(deployIdx))
    if (lines.length === 0) return

    // Search from the latest line back — the deploy "Live at: URL" message
    // is usually printed near the end of the step's output.
    const urlPattern = /(https?:\/\/[^\s<>"'`)]+)/i
    let found: string | null = null
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const m = lines[i].line.match(urlPattern)
      if (m) {
        found = m[1].replace(/[.,;]+$/, '')
        break
      }
    }
    if (!found) return
    if (lastDomainExtractedRef.current === found) return
    lastDomainExtractedRef.current = found
    setRepoDomainUrl(cacheKey, repoName, found)
    // findLogsForStep is intentionally not in deps — its closures are
    // covered by `steps`/`stepLifecycle`/`logs` which already trigger re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, stepLifecycle, logs, job?.repoName, cacheKey])

  // Persist pipeline metadata for the RepositoryDetailPage's source card.
  // The detail page tries GitHub's API for commit info but that often
  // fails (backend may not proxy /commits/{branch}, or the auth token is
  // a JWT rather than a GitHub OAuth token). This effect saves what we
  // already KNOW from the running job + extracts a commit SHA/message
  // from the clone step's logs, so the source card can always populate
  // *something* meaningful instead of "(API에서 제공되지 않음)".
  const lastCommitExtractedRef = useRef<string | null>(null)
  useEffect(() => {
    const repoName = job?.repoName
    if (!repoName) return

    // Base metadata that's always available once the job loads.
    const basePatch = {
      branch: job?.branch || undefined,
      triggeredBy: user?.login || undefined,
      triggeredAt: job?.createdAt ?? job?.startedAt ?? undefined,
      lastStatus: job?.status,
    }
    setRepoPipelineInfo(cacheKey, repoName, basePatch)

    // Commit extraction from clone step logs. Run only after we have
    // some clone output to look at.
    const cloneIdx = steps.findIndex((s) =>
      /clone|checkout|레포|클론/i.test(`${s.stepName} ${s.stepType}`),
    )
    if (cloneIdx < 0) return
    const cloneStep = steps[cloneIdx]
    const cloneLogs = findLogsForStep(cloneStep, lifecycleKeyFor(cloneIdx))
    if (cloneLogs.length === 0) return

    // Try several common patterns. Order matters — most specific first.
    let sha: string | undefined
    let message: string | undefined
    for (const { line } of cloneLogs) {
      const head = line.match(/HEAD\s+is\s+now\s+at\s+([0-9a-f]{7,40})\s+(.+)/i)
      if (head) {
        sha = head[1]
        message = head[2].trim()
        break
      }
      const labeled = line.match(/(?:commit|sha)\s*[:=]\s*([0-9a-f]{7,40})\b\s*[-—|]?\s*(.+)?/i)
      if (labeled) {
        sha = labeled[1]
        message = (labeled[2] ?? '').trim() || undefined
        break
      }
    }
    if (!sha) {
      // Last resort: bare 40-char SHA on any line.
      for (const { line } of cloneLogs) {
        const m = line.match(/\b([0-9a-f]{40})\b/)
        if (m) {
          sha = m[1]
          break
        }
      }
    }
    if (!sha) return
    if (lastCommitExtractedRef.current === sha) return
    lastCommitExtractedRef.current = sha
    setRepoPipelineInfo(cacheKey, repoName, {
      commitSha: sha,
      ...(message ? { commitMessage: message } : {}),
    })
    // findLogsForStep is intentionally excluded — see note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    steps,
    stepLifecycle,
    logs,
    job?.repoName,
    job?.branch,
    job?.createdAt,
    job?.startedAt,
    job?.status,
    user?.login,
    cacheKey,
  ])

  // Auto-open accordion entries for any step that's currently running so its
  // streaming logs are visible without a manual click. We append-only — once
  // the user opens or auto-opens a step it stays open.
  useEffect(() => {
    if (isHistorySnapshot) {
      const historyKeys = steps
        .map((step, idx) => ({
          key: step.stepId || `${step.stepName}-${idx}`,
          status: step.status,
        }))
        .filter(({ status }) => TERMINAL_STEP_STATUSES.has(status))
        .map(({ key }) => key)
      if (historyKeys.length === 0) return
      setOpenSteps((prev) => (prev.length > 0 ? prev : historyKeys))
      return
    }
    if (!currentStep) return
    const idx = steps.indexOf(currentStep)
    const key = currentStep.stepId || `${currentStep.stepName}-${idx}`
    setOpenSteps((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [currentStep, steps, isHistorySnapshot])

  // Track each running step's live elapsed in a ref so the render can fall
  // back to this value during the brief running→complete transition window
  // when the backend hasn't yet filled durationSecs/endedAt. We mutate the
  // ref here (in an effect) rather than during render to satisfy the
  // react-hooks/purity rule.
  useEffect(() => {
    steps.forEach((step, idx) => {
      if (step.status !== 'running') return
      const backendStart = step.startedAt ? Date.parse(step.startedAt) : Number.NaN
      const lKey = lifecycleKeyFor(idx)
      const lifeStart = stepLifecycle[lKey]?.observedStartMs
      const startMs = !Number.isNaN(backendStart) ? backendStart : lifeStart
      if (startMs === undefined || Number.isNaN(startMs)) return
      lastLiveStepDurationRef.current[lKey] = Math.max(
        0,
        Math.round((Date.now() - startMs) / 1000),
      )
    })
  }, [steps, elapsedSec, stepLifecycle])

  useEffect(() => {
    if (!jobId || steps.length === 0) return
    const capSecs = job?.durationSecs && job.durationSecs > 0 ? job.durationSecs : elapsedSec

    setStoredStepDurations((prev) => {
      let next = prev
      let changed = false

      const writeDuration = (key: string, duration: number) => {
        if (prev[key] === duration) return
        if (!changed) {
          next = { ...prev }
          changed = true
        }
        next[key] = duration
      }

      steps.forEach((step, idx) => {
        if (!TERMINAL_STEP_STATUSES.has(step.status)) return
        const key = stepDurationKeyFor(step, idx)
        if (step.status === 'skipped') {
          writeDuration(key, 0)
          return
        }

        const duration =
          backendStepDurationSecs(step, capSecs) ??
          lifecycleDurationFor(idx, capSecs) ??
          boundedDurationSecs(lastLiveStepDurationRef.current[lifecycleKeyFor(idx)] ?? -1, capSecs) ??
          logDurationFor(step, idx, capSecs)

        if (duration !== null) {
          writeDuration(key, duration)
        }
      })

      if (changed) {
        writeStepDurationCache(jobId, next)
      }

      return changed ? next : prev
    })
    // findLogsForStep/logDurationFor are intentionally not listed; their
    // backing data is covered by steps, lifecycle, logs, and timestamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, steps, stepLifecycle, logs, logTimestamps, job?.durationSecs, elapsedSec])

  // Record step lifecycle transitions. For each poll we:
  //   - Notice a step that just transitioned to running → stamp its
  //     observedStartMs (using backend's startedAt when present, otherwise
  //     wall clock) and inherit startLogIdx from the previous step's
  //     endLogIdx so the slice covers logs we already had at mount time.
  //   - Notice a step that just transitioned to terminal → stamp its end.
  //   - Handle steps that appeared already-complete (missed the running
  //     window because the page was opened mid-pipeline or the step
  //     completed faster than our poll interval) — slice from prev step's
  //     endLogIdx to now.
  useEffect(() => {
    setStepLifecycle((prev) => {
      let next = prev
      let changed = false
      const terminal = new Set(['success', 'failed', 'cancelled', 'skipped'])

      // Look up where the previous tracked step ended, walking backwards
      // through indices until we find one with a closed endLogIdx. Used
      // as the natural startLogIdx for the next step.
      const priorEndLogIdx = (currentIdx: number): number => {
        for (let i = currentIdx - 1; i >= 0; i -= 1) {
          const prevKey = lifecycleKeyFor(i)
          const prevLife = next[prevKey] ?? prev[prevKey]
          if (prevLife && prevLife.endLogIdx !== null) return prevLife.endLogIdx
        }
        return 0
      }

      const ensureMutable = () => {
        if (!changed) {
          next = { ...prev }
          changed = true
        }
      }

      steps.forEach((step, idx) => {
        const key = lifecycleKeyFor(idx)
        const existing = next[key]
        const backendStartMs = step.startedAt ? Date.parse(step.startedAt) : Number.NaN
        const backendEndMs = step.endedAt ? Date.parse(step.endedAt) : Number.NaN

        if (step.status === 'running' && !existing) {
          ensureMutable()
          next[key] = {
            observedStartMs: !Number.isNaN(backendStartMs) ? backendStartMs : Date.now(),
            observedEndMs: null,
            startLogIdx: priorEndLogIdx(idx),
            endLogIdx: null,
          }
        } else if (step.status === 'running' && existing) {
          // While running, opportunistically improve observedStartMs if the
          // backend has now reported a startedAt that's earlier than the
          // frontend-only estimate — this fixes the "1초로 뜨는" case where
          // the page mounted mid-step and we initially had to guess.
          if (
            !Number.isNaN(backendStartMs) &&
            backendStartMs < existing.observedStartMs
          ) {
            ensureMutable()
            next[key] = { ...existing, observedStartMs: backendStartMs }
          }
        } else if (
          terminal.has(step.status) &&
          existing &&
          existing.observedEndMs === null
        ) {
          ensureMutable()
          next[key] = {
            ...existing,
            observedStartMs:
              !Number.isNaN(backendStartMs) && backendStartMs < existing.observedStartMs
                ? backendStartMs
                : existing.observedStartMs,
            observedEndMs: !Number.isNaN(backendEndMs) ? backendEndMs : Date.now(),
            endLogIdx: logs.length,
          }
        } else if (terminal.has(step.status) && !existing) {
          // Missed-window step — caught it already terminal. Best effort:
          //   - log slice = [prev step's end, now]
          //   - duration: prefer backend timestamps, otherwise zero-window
          //     (the duration column then falls through to backend
          //     durationSecs in render).
          ensureMutable()
          const startMs = !Number.isNaN(backendStartMs) ? backendStartMs : Date.now()
          const endMs = !Number.isNaN(backendEndMs) ? backendEndMs : Date.now()
          next[key] = {
            observedStartMs: startMs,
            observedEndMs: endMs,
            startLogIdx:
              step.status === 'skipped' ? logs.length : priorEndLogIdx(idx),
            endLogIdx: logs.length,
          }
        }
      })
      return changed ? next : prev
    })
  }, [steps, logs.length])

  if (!jobId) {
    return (
      <MainLayout>
        <Card className="p-6 text-center text-[#FCA5A5]">
          job_id가 전달되지 않았습니다. 새 파이프라인을 다시 실행해 주세요.
        </Card>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => navigate('/pipeline/new')}>새 파이프라인</Button>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout pipelineElapsed={formatDuration(elapsedSec)}>
      <section className="w-full space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[28px] font-bold text-white">
              <CodeXml className="h-7 w-7 text-[#34D399]" />
              {repoName || jobId}
            </div>
            <p className="inline-flex items-center gap-2 text-[14px] text-[#878787]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: jobBadge.dotColor }} />
              {jobBadge.label} · {formatDuration(elapsedSec)}
            </p>
          </div>
          <p className="text-[14px] text-[#6B7280]">
            브랜치 {branch || '-'} · Job {jobId.slice(0, 8)}
          </p>
        </div>

        {error ? (
          <Card className="border-[#7F1D1D] bg-[#450A0A]/40 p-3 text-center text-sm text-[#FCA5A5]">
            {error}
          </Card>
        ) : null}

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[24px] font-bold text-white">진행 과정</p>
            <p className="text-[14px] text-[#878787]">
              {successCount}/{steps.length} 단계 통과
            </p>
          </div>

          {/* "지금 무엇이 돌고 있는가" panel — replaces the inline status
              dot with a more prominent live readout of the currently running
              step + its latest log line. Falls back to job-status text when
              no step is actively running (queued/terminal). */}
          <div className="mb-4 rounded-xl border border-[#404040] bg-[#1E1E1E] p-3">
            {currentStep ? (
              (() => {
                const Icon = iconForStep(currentStep)
                const cIdx = steps.indexOf(currentStep)
                const stepLogs = findLogsForStep(currentStep, lifecycleKeyFor(cIdx))
                const latestLine = stepLogs[stepLogs.length - 1]
                const startMs = currentStep.startedAt
                  ? Date.parse(currentStep.startedAt)
                  : Number.NaN
                const stepElapsed = !Number.isNaN(startMs)
                  ? Math.max(0, Math.round((Date.now() - startMs) / 1000))
                  : 0
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-[#F59E0B]" />
                      <Icon className="h-5 w-5 text-[#F59E0B]" />
                      <p className="text-[16px] font-semibold text-white">
                        현재: {currentStep.stepName || currentStep.stepType}
                      </p>
                      <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#FCD34D]">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatDuration(stepElapsed)}
                      </span>
                    </div>
                    {latestLine ? (
                      <p className="mt-2 truncate font-mono text-[12px] text-[#9CA3AF]">
                        <span className="mr-2 text-[#6B7280]">+{latestLine.elapsedSec}s</span>
                        {latestLine.line}
                      </p>
                    ) : (
                      <p className="mt-2 font-mono text-[12px] text-[#6B7280]">
                        명령 실행 대기 중...
                      </p>
                    )}
                  </>
                )
              })()
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: jobBadge.dotColor }}
                />
                <p className="text-[14px] text-[#D1D5DB]">
                  {isTerminal
                    ? `파이프라인 ${jobBadge.label} · 총 ${formatDuration(elapsedSec)}`
                    : `${jobBadge.label} · ${formatDuration(elapsedSec)}`}
                </p>
              </div>
            )}
          </div>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          >
            {steps.map((step, idx) => {
              const barStatus = displayedStatusFor(idx, step.status)
              return (
                <div key={step.stepId || step.stepName} className="h-2 rounded-full bg-[#404040]">
                  {/* Pending → transparent so the track (gray in dark, light
                      gray in light mode) shows instead of a dark #404040 fill. */}
                  <div
                    className="h-full w-full rounded-full"
                    style={{
                      backgroundColor:
                        barStatus === 'pending' ? 'transparent' : statusColor(barStatus),
                    }}
                  />
                </div>
              )
            })}
          </div>
        </Card>

        <Accordion
          type="multiple"
          value={openSteps}
          onValueChange={setOpenSteps}
          className="space-y-3"
        >
          {steps.map((step, idx) => {
            const Icon = iconForStep(step)
            const key = step.stepId || `${step.stepName}-${idx}`
            const lKey = lifecycleKeyFor(idx)
            // Status/border/duration are all driven by DISPLAYED status, so
            // the reveal queue keeps icons + colors + timings in sync. The
            // raw `step.status` is only used for lifecycle bookkeeping.
            const dStatus = displayedStatusFor(idx, step.status)
            const borderColor =
              dStatus === 'success'
                ? 'border-[#3ECF8E]'
                : dStatus === 'failed'
                  ? 'border-[#EF4444]'
                  : dStatus === 'running'
                    ? 'border-[#F59E0B]'
                    : 'border-[#404040]'
            const rawMatchedLogs = findLogsForStep(step, lKey)
            // Show whatever logs we have for THIS step as soon as they're
            // available. The reveal queue only animates the status icons —
            // logs themselves are NOT gated, so a step that just finished
            // on the backend can show its output immediately even if the
            // reveal animation hasn't gotten to it yet.
            //
            // Fallback chain when tag matching gives nothing:
            //   1. reveal-time slice [prev_reveal_log_count, this/live]
            //   2. lifecycle slice (handled inside findLogsForStep)
            let matchedLogs = rawMatchedLogs
            if (rawMatchedLogs.length === 0 && revealedCount !== null && step.status !== 'skipped') {
              const sliceStart = idx > 0 ? (stepRevealLogCounts[idx - 1] ?? 0) : 0
              const captured = stepRevealLogCounts[idx]
              const isCurrentRunning = idx === revealedCount
              const isLastStepEver = idx === steps.length - 1
              const allRevealedDone = revealedCount >= steps.length
              // Live end so late-arriving logs land somewhere visible:
              //  - currently-displayed running step → live
              //  - last step after all reveals done → live (catches the
              //    end-of-pipeline log flush from buffered backends)
              //  - any step matching the actual backend running step → live
              //    so a step that's running on the backend keeps streaming
              //    even if reveal queue is ahead of it visually
              const realIsRunning = step.status === 'running'
              const useLiveEnd =
                isCurrentRunning ||
                realIsRunning ||
                (isLastStepEver && allRevealedDone)
              const sliceEnd = useLiveEnd
                ? allLogEntries.length
                : captured !== undefined
                  ? captured
                  : sliceStart
              if (sliceEnd > sliceStart) {
                matchedLogs = allLogEntries.slice(sliceStart, sliceEnd)
              }
            }
            // Duration: if the step is displayed as terminal use
            // displayedDurationFor (gap-based, guaranteed ≥1s). For the
            // step we're currently animating as "running", tick live from
            // its reveal timestamp (or the previous step's reveal).
            let duration = 0
            if (TERMINAL_STEP_STATUSES.has(dStatus)) {
              duration = displayedStepDurations[idx] ?? 0
            } else if (dStatus === 'running') {
              duration = rawDisplayedDurationFor(step, idx)
            }

            return (
              <AccordionItem
                key={key}
                value={key}
                className={`rounded-2xl border bg-[#262626] p-4 ${borderColor}`}
              >
                <AccordionTrigger className="py-0 hover:no-underline">
                  <div className="flex items-center gap-3">
                    <StepStatusIcon status={dStatus} />
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-[#6B7280]" />
                      <div className="flex flex-col gap-1">
                        <p className="text-[20px] font-semibold text-white">
                          {step.stepName || '(unnamed)'}
                        </p>
                        <div className="flex items-center gap-3 text-[14px]">
                          <span className="inline-flex items-center gap-1 text-[#6B7280]">
                            <Clock3 className="h-4 w-4" /> {formatDuration(duration)}
                          </span>
                          <span style={{ color: statusColor(dStatus) }}>
                            {statusLabel(dStatus)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-3">
                  {step.errorMessage ? (
                    <p className="mb-2 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-xs text-[#FCA5A5]">
                      {step.errorMessage}
                    </p>
                  ) : null}
                  <div className="max-h-72 overflow-y-auto rounded-md border border-[#404040] bg-[#1E1E1E] p-3 text-xs text-[#A1A1A1]">
                    {matchedLogs.length === 0 ? (
                      <p className="font-mono text-[#6B7280]">
                        {step.status === 'running' || dStatus === 'running'
                          ? '명령 실행 중... (로그 수신 대기)'
                          : step.status === 'pending' && dStatus === 'pending'
                            ? '이전 단계 완료 후 시작됩니다'
                            : TERMINAL_STEP_STATUSES.has(step.status) && !isTerminal
                              ? '단계 종료 — 백엔드가 로그를 flush할 때까지 대기 중'
                              : !isTerminal
                                ? '로그 수신 대기 중...'
                                : '이 단계에서 출력된 로그가 없습니다'}
                      </p>
                    ) : (
                      matchedLogs.map((entry, lineIdx) => (
                        <p key={lineIdx} className="font-mono leading-6 break-all">
                          <span className="mr-2 text-[#6B7280]">+{entry.elapsedSec}s</span>
                          {entry.line}
                        </p>
                      ))
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[16px] font-semibold text-white">실시간 로그</p>
            <p className="text-[12px] text-[#6B7280]">{logs.length} 줄</p>
          </div>
          <div
            ref={logContainerRef}
            className="max-h-96 overflow-y-auto rounded-md border border-[#404040] bg-[#0F0F0F] p-3 text-xs text-[#D1D5DB]"
          >
            {logs.length === 0 ? (
              <p className="font-mono text-[#6B7280]">
                {isTerminal ? '수집된 로그가 없습니다.' : '로그를 기다리는 중...'}
              </p>
            ) : (
              logs.map((line, idx) => (
                <p key={idx} className="font-mono leading-5 break-all">
                  <span className="mr-2 text-[#6B7280]">+{logTimestamps[idx] ?? 0}s</span>
                  {line}
                </p>
              ))
            )}
          </div>
        </Card>

        <div className="flex justify-end gap-2 pt-1">
          {!isTerminal ? (
            <Button
              onClick={() => setIsCancelDialogOpen(true)}
              disabled={isCancelling}
              className="border border-[#7F1D1D] bg-transparent text-[#FCA5A5] shadow-none hover:bg-[#450A0A]/40"
            >
              {isCancelling ? '취소 중...' : '파이프라인 취소'}
            </Button>
          ) : null}
          <Button
            onClick={() =>
              navigate('/pipeline/result', {
                state: { jobId, repoName, branch },
              })
            }
            disabled={!isTerminal}
            className="shadow-none"
          >
            보안 분석 결과
          </Button>
        </div>
      </section>

      <Dialog open={isCancelDialogOpen} onOpenChange={(open) => !isCancelling && setIsCancelDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>파이프라인을 취소할까요?</DialogTitle>
            <DialogDescription>
              진행 중인 작업이 즉시 종료됩니다. 이미 생성된 로그와 기록은 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCancelDialogOpen(false)}
              disabled={isCancelling}
            >
              계속 실행
            </Button>
            <Button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className="bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
            >
              {isCancelling ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />취소 중...
                </>
              ) : (
                '파이프라인 취소'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
