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
import { useAuth } from '@/contexts/AuthContext'
import {
  cancelPipeline,
  fetchJobDetail,
  fetchPipelineLogs,
  setRepoDomainUrl,
  type JobDetail,
  type JobStep,
} from '@/lib/api'

type LocationState = {
  jobId?: string
  repoName?: string
  branch?: string
}

const POLL_INTERVAL_MS = 1500
// After a job reaches a terminal status (success/failed/cancelled) the
// runner may still flush trailing log lines for a beat. Keep polling for
// a short grace window so the user actually sees the final logs instead
// of "수집된 로그가 없습니다".
const TERMINAL_GRACE_POLLS = 3
const TERMINAL_JOB_STATUSES = new Set(['success', 'failed', 'cancelled'])

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
  const { token } = useAuth()
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
  // Last live-computed duration per step. Lets a step keep showing its real
  // elapsed (e.g. 12s) right when status flips running→success, before the
  // backend has filled durationSecs/endedAt. Without this the cell snaps to
  // "0s" for a poll cycle or two and looks wrong.
  const lastLiveStepDurationRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!jobId || !token) {
      setIsInitialLoading(false)
      return
    }

    let cancelled = false
    let timer: number | null = null

    async function tick() {
      let isTerminal = false
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
          setJob(nextJob)
          isTerminal = TERMINAL_JOB_STATUSES.has(nextJob.status)
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
        const jobStartMs = startedAtMsRef.current
        if (jobStartMs !== null) {
          const elapsed = Math.max(0, Math.round((Date.now() - jobStartMs) / 1000))
          setLogTimestamps((prev) => {
            if (nextLogs.length <= prev.length) return prev.slice(0, nextLogs.length)
            const additions = nextLogs.length - prev.length
            return [...prev, ...new Array<number>(additions).fill(elapsed)]
          })
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
    allLogEntries.forEach((entry) => {
      const match = entry.line.match(/^\[([^.\]]+)(?:\.log)?\]/)
      const key = match ? match[1].toLowerCase() : '__general__'
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
    //    when the backend doesn't tag logs per step. We recorded the
    //    global log array index at the moment this step transitioned to
    //    running, and again when it terminated; anything in between
    //    belongs to this step. Works for completed steps too: the user's
    //    complaint of "completed but no logs shown" is exactly this case.
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

  async function handleCancel() {
    if (!token || !jobId || isCancelling) return
    const ok = window.confirm('실행 중인 파이프라인을 취소할까요? 진행 중인 작업은 즉시 종료됩니다.')
    if (!ok) return
    setIsCancelling(true)
    try {
      await cancelPipeline(token, jobId)
      const refreshed = await fetchJobDetail(token, jobId)
      if (refreshed) setJob(refreshed)
      setError(null)
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
  const successCount = steps.filter((step) => step.status === 'success').length

  // Currently running step — surfaced to the top "execution status" panel
  // and to the auto-open accordion logic so the user always sees what's
  // happening RIGHT NOW without having to click into a step.
  const currentStep = steps.find((step) => step.status === 'running') ?? null

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

  // Auto-open accordion entries for any step that's currently running so its
  // streaming logs are visible without a manual click. We append-only — once
  // the user opens or auto-opens a step it stays open.
  useEffect(() => {
    if (!currentStep) return
    const idx = steps.indexOf(currentStep)
    const key = currentStep.stepId || `${currentStep.stepName}-${idx}`
    setOpenSteps((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [currentStep, steps])

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
    <MainLayout>
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
            {steps.map((step) => (
              <div key={step.stepId || step.stepName} className="h-2 rounded-full bg-[#404040]">
                <div
                  className="h-full w-full rounded-full"
                  style={{ backgroundColor: statusColor(step.status) }}
                />
              </div>
            ))}
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
            // Render key (for React reconciliation) vs lifecycle key (for
            // state lookup). The lifecycle key MUST be index-based so the
            // entry survives the placeholder→API transition where step.stepId
            // changes — see lifecycleKeyFor.
            const key = step.stepId || `${step.stepName}-${idx}`
            const lKey = lifecycleKeyFor(idx)
            const borderColor =
              step.status === 'success'
                ? 'border-[#3ECF8E]'
                : step.status === 'failed'
                  ? 'border-[#EF4444]'
                  : step.status === 'running'
                    ? 'border-[#F59E0B]'
                    : 'border-[#404040]'
            const matchedLogs = findLogsForStep(step, lKey)
            // Duration resolution. Frontend-observed lifecycle FIRST
            // because the backend sometimes sends durationSecs=1 even
            // when the step visibly took longer. Lifecycle uses backend
            // startedAt/endedAt when available (more accurate than our
            // poll-time observation) and falls back to wall clock.
            //
            //   1. lifecycle (observedEnd - observedStart) when meaningful
            //   2. running → live elapsed from lifecycle start
            //   3. backend-supplied durationSecs (only if > 0)
            //   4. computed (endedAt - startedAt) from backend timestamps
            //   5. last-known live ref value (transition-window safety net)
            const life = stepLifecycle[lKey]
            const lifecycleDuration =
              life && life.observedEndMs !== null
                ? Math.max(
                    0,
                    Math.round((life.observedEndMs - life.observedStartMs) / 1000),
                  )
                : 0
            let duration = 0
            if (lifecycleDuration > 0) {
              duration = lifecycleDuration
            } else if (step.status === 'running') {
              const fromBackend = step.startedAt ? Date.parse(step.startedAt) : Number.NaN
              const startMs = !Number.isNaN(fromBackend)
                ? fromBackend
                : life?.observedStartMs ?? Number.NaN
              if (!Number.isNaN(startMs)) {
                duration = Math.max(0, Math.round((Date.now() - startMs) / 1000))
              } else {
                duration = elapsedSec
              }
            } else if ((step.durationSecs ?? 0) > 0) {
              duration = step.durationSecs ?? 0
            } else if (step.startedAt && step.endedAt) {
              const startMs = Date.parse(step.startedAt)
              const endMs = Date.parse(step.endedAt)
              if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
                duration = Math.max(0, Math.round((endMs - startMs) / 1000))
              }
            }
            if (duration <= 0 && lastLiveStepDurationRef.current[lKey]) {
              duration = lastLiveStepDurationRef.current[lKey]
            }

            return (
              <AccordionItem
                key={key}
                value={key}
                className={`rounded-2xl border bg-[#262626] p-4 ${borderColor}`}
              >
                <AccordionTrigger className="py-0 hover:no-underline">
                  <div className="flex items-center gap-3">
                    <StepStatusIcon status={step.status} />
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
                          <span style={{ color: statusColor(step.status) }}>
                            {statusLabel(step.status)}
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
                  <div className="rounded-md border border-[#404040] bg-[#1E1E1E] p-3 text-xs text-[#A1A1A1]">
                    {matchedLogs.length === 0 ? (
                      <p className="font-mono text-[#6B7280]">
                        {step.status === 'running'
                          ? '명령 실행 대기 중... (로그 수집 중)'
                          : step.status === 'pending'
                            ? '이전 단계 완료 후 시작됩니다'
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
              onClick={handleCancel}
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
    </MainLayout>
  )
}
