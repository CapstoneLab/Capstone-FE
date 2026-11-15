import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getCachedExecution, jobKeys, mergeJobWithSteps, saveExecution } from '@/hooks/useJobQueries'
import { markStartPhase } from '@/lib/startTiming'
import {
  cancelPipeline,
  fetchJobDetail,
  fetchPipelineDeployment,
  fetchPipelineLogs,
  fetchPipelineSteps,
  type JobDetail,
  type JobStep,
  type PipelineStepsResponse,
} from '@/lib/api'
import { applyJobEvent, preserveTerminal } from '@/lib/executionTiming'
import { WS_API_BASE_URL } from '@/lib/config'
import {
  appendLogEvents,
  foldClockSample,
  isTerminalJobStatus,
  mergeLogSnapshot,
  stageIndexForStep,
  type LogEntry,
  type StreamLogEvent,
} from '@/lib/pipelineExecution'

export type ConnectionState =
  /** Opening the real-time channel for the first time. */
  | 'connecting'
  /** Real-time channel open and authenticated. */
  | 'live'
  /** Channel dropped; retrying while REST polling keeps the view current. */
  | 'reconnecting'
  /** Execution finished; nothing left to stream. */
  | 'closed'

// REST polling is the safety net. While the socket is live it only
// re-synchronises occasionally; otherwise it carries the updates itself.
const POLL_FALLBACK_MS = 2500
const POLL_WHILE_LIVE_MS = 10000
const POLL_HIDDEN_MS = 10000
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 15000
const STEP_REFRESH_DEBOUNCE_MS = 250

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function str(record: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

function num(record: UnknownRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/** Step patch carried by a stage_* / step_* event, when it carries one. */
function stepPatchFromEvent(message: UnknownRecord): Partial<JobStep> | null {
  const source = asRecord(message.step) ?? asRecord(message.stage) ?? message
  const patch: Partial<JobStep> = {}
  const stepId = str(source, 'step_id', 'stepId', 'id')
  const stepType = str(source, 'step_type', 'stepType', 'stage_type')
  const stepName = str(source, 'step_name', 'stepName', 'stage_name', 'name')
  const status = str(source, 'status')
  if (stepId) patch.stepId = stepId
  if (stepType) patch.stepType = stepType
  if (stepName) patch.stepName = stepName
  if (status) patch.status = status as JobStep['status']
  const startedAt = str(source, 'started_at', 'startedAt')
  const endedAt = str(source, 'ended_at', 'endedAt', 'finished_at', 'finishedAt')
  const errorMessage = str(source, 'error_message', 'errorMessage', 'error')
  const durationSecs = num(source, 'duration_secs', 'durationSecs', 'duration')
  if (startedAt) patch.startedAt = startedAt
  if (endedAt) patch.endedAt = endedAt
  if (errorMessage) patch.errorMessage = errorMessage
  if (durationSecs !== undefined) patch.durationSecs = durationSecs
  if (!patch.stepId && !patch.stepType && !patch.stepName) return null
  return patch
}

/** Status implied by the event type when the payload does not state one. */
const EVENT_STEP_STATUS: Record<string, JobStep['status']> = {
  stage_started: 'running',
  step_started: 'running',
  stage_completed: 'success',
  step_completed: 'success',
  stage_failed: 'failed',
  step_failed: 'failed',
  stage_skipped: 'skipped',
  step_skipped: 'skipped',
  stage_cancelled: 'cancelled',
  step_cancelled: 'cancelled',
}

const EVENT_JOB_STATUS: Record<string, JobDetail['status']> = {
  pipeline_started: 'running',
  pipeline_resumed: 'running',
  pipeline_failed: 'failed',
  pipeline_cancelled: 'cancelled',
  pipeline_canceled: 'cancelled',
}

export function applyStepPatch(steps: JobStep[], patch: Partial<JobStep>): JobStep[] {
  const patchStage = stageIndexForStep({
    stepType: patch.stepType ?? '',
    stepName: patch.stepName ?? '',
  })
  const index = steps.findIndex(
    (step) =>
      (patch.stepId && step.stepId === patch.stepId) ||
      (patchStage !== null && stageIndexForStep(step) === patchStage),
  )
  if (index >= 0) {
    const current = steps[index]
    // A replayed "started" event must not reopen a finished stage.
    const regresses =
      TERMINAL_STEP.has(current.status) && !!patch.status && !TERMINAL_STEP.has(patch.status)
    const next = steps.slice()
    next[index] = regresses ? { ...current, ...patch, status: current.status } : { ...current, ...patch }
    return next
  }
  return [
    ...steps,
    {
      stepId: patch.stepId ?? '',
      stepName: patch.stepName ?? '',
      stepType: patch.stepType ?? '',
      status: patch.status ?? 'pending',
      errorMessage: patch.errorMessage ?? null,
      startedAt: patch.startedAt ?? null,
      endedAt: patch.endedAt ?? null,
      durationSecs: patch.durationSecs ?? null,
    },
  ]
}

function streamEventsFrom(message: UnknownRecord): StreamLogEvent[] {
  const raw = Array.isArray(message.events) ? message.events : [message.event ?? message]
  return raw
    .map(asRecord)
    .filter((event): event is UnknownRecord => !!event && typeof event.message === 'string')
    .map((event) => ({
      message: event.message as string,
      stageName: str(event, 'step_name', 'stepName', 'stage_name', 'stage') ?? null,
      level: str(event, 'level', 'severity') ?? null,
      timestamp: str(event, 'timestamp', 'ts', 'created_at') ?? num(event, 'timestamp', 'ts') ?? null,
    }))
}

const TERMINAL_STEP = new Set<JobStep['status']>(['success', 'failed', 'skipped', 'cancelled'])

/** A finished run never goes back to running: late polls, replayed events
 *  and reconnect snapshots can all carry an older, non-terminal status. */
export function keepTerminal(previous: JobDetail | null, next: JobDetail): JobDetail {
  if (!previous || !isTerminalJobStatus(previous.status) || isTerminalJobStatus(next.status)) return next
  return { ...next, status: previous.status, completedAt: next.completedAt ?? previous.completedAt }
}

/** Job state right after approval resumed it: running again, and every stage
 *  after the security gate back to pending. */
export function reopenAfterGate(job: JobDetail): JobDetail {
  const gateIndex = 5
  return {
    ...job,
    status: 'running',
    completedAt: null,
    steps: job.steps.map((step) => {
      const index = stageIndexForStep(step)
      return index !== null && index > gateIndex
        ? { ...step, status: 'pending', startedAt: null, endedAt: null, durationSecs: null, errorMessage: null }
        : step
    }),
  }
}

/** A stage event that carries the complete persisted step needs no REST refresh. */
function isCompleteStep(patch: Partial<JobStep> | null): boolean {
  return !!patch?.stepId && !!patch.stepName && !!patch.stepType && !!patch.status
}

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string' || !value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Sequence number of a streamed event, used to drop replays. */
function eventSeq(message: UnknownRecord): number | null {
  return num(message, 'seq', 'sequence', 'event_id', 'offset') ?? null
}

/** Liveness signals for a running execution (this PC's epoch ms, null = not seen yet). */
export type ExecutionActivity = {
  /** When the last log line arrived. */
  lastLogAt: number | null
  /** When the engine last reported a heartbeat. */
  lastEngineAt: number | null
}

export type PipelineExecution = {
  job: JobDetail | null
  logs: LogEntry[]
  activity: ExecutionActivity
  /** Estimated serverClock − thisPC'sClock in ms (0 until estimated). Add it
   *  to Date.now() before comparing against server timestamps. */
  clockOffsetMs: number
  connection: ConnectionState
  /** Non-null when the status could not be loaded; raw detail for diagnostics. */
  error: string | null
  deployUrl: string | null
  setDeployUrl: (url: string | null) => void
  /** Requests a real cancellation and resolves once the backend confirmed it. */
  cancel: () => Promise<void>
  /** Re-fetches job, steps and logs from the REST API. */
  resync: () => Promise<void>
  /** Re-open the job as live after the backend resumed it (approval). */
  resume: () => void
}

export function usePipelineExecution(jobId: string, token: string | null): PipelineExecution {
  const queryClient = useQueryClient()
  // A finished run that was already viewed (or prefetched from the history
  // list) renders straight from the query cache — no REST round trips, no
  // WebSocket. Read once: the hook is mounted under key={jobId}.
  const [cached, setCached] = useState(() => (jobId ? getCachedExecution(queryClient, jobId) : null))
  // Bumped by resume(): restarts REST polling and the real-time channel for a
  // job the backend continues after approval.
  const [generation, setGeneration] = useState(0)

  const [job, setJob] = useState<JobDetail | null>(cached?.job ?? null)
  const [logs, setLogs] = useState<LogEntry[]>(cached?.logs ?? [])
  const [connection, setConnection] = useState<ConnectionState>(cached ? 'closed' : 'connecting')
  const [error, setError] = useState<string | null>(null)
  const [deployUrl, setDeployUrl] = useState<string | null>(cached?.deployUrl ?? null)
  const [activity, setActivity] = useState<ExecutionActivity>({ lastLogAt: null, lastEngineAt: null })

  // Server clock estimate (see foldClockSample). Only re-render on a change
  // that is visible on a seconds display.
  const clockOffsetRef = useRef<number | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const noteServerClock = useCallback((serverMs: number | null, receivedMs = Date.now()) => {
    const next = foldClockSample(clockOffsetRef.current, serverMs, receivedMs)
    if (next === null || next === clockOffsetRef.current) return
    clockOffsetRef.current = next
    setClockOffsetMs((previous) => (Math.abs(previous - next) >= 250 ? next : previous))
  }, [])
  /** Server timestamp → this PC's clock (never in the future). */
  const toLocal = useCallback(
    (serverMs: number | null) =>
      serverMs === null ? null : Math.min(Date.now(), serverMs - (clockOffsetRef.current ?? 0)),
    [],
  )

  // Live log lines carry the server's own timestamps — the main clock source.
  const sampledLogsRef = useRef(0)
  useEffect(() => {
    if (logs.length < sampledLogsRef.current) sampledLogsRef.current = 0
    for (let i = sampledLogsRef.current; i < logs.length; i += 1) {
      const entry = logs[i]
      if (entry.live) noteServerClock(entry.timestampMs, entry.receivedAtMs)
    }
    sampledLogsRef.current = logs.length
  }, [logs, noteServerClock])

  // Timestamps only move forward (replays and REST snapshots can be older).
  const noteActivity = useCallback((kind: keyof ExecutionActivity, at: number | null) => {
    if (at === null) return
    setActivity((previous) =>
      previous[kind] !== null && previous[kind]! >= at ? previous : { ...previous, [kind]: at },
    )
  }, [])

  const logsRef = useRef<LogEntry[]>(cached?.logs ?? [])
  const liveRef = useRef(false)
  const terminalRef = useRef(!!cached)
  const terminalEventRef = useRef<UnknownRecord | null>(null)
  const resyncRef = useRef<() => Promise<void>>(async () => undefined)
  // Closes the real-time channel once REST learns the run has finished.
  const closeStreamRef = useRef<() => void>(() => undefined)

  const commitLogs = useCallback((next: LogEntry[]) => {
    if (next === logsRef.current) return
    logsRef.current = next
    setLogs(next)
  }, [])

  // ── REST synchronisation + polling ──────────────────────────────────────
  // State is per execution: callers mount this hook under `key={jobId}`, so
  // a different execution always starts from a fresh hook instance.
  useEffect(() => {
    if (!jobId || !token) return
    if (cached) return // finished run served from cache
    void generation // restart after resume()

    let disposed = false
    let timer: number | null = null
    // Lines from the first snapshot are history: their receive time says
    // nothing about when they were emitted. Later new lines of a live run
    // arrive within one poll of being written.
    let observedLive = false
    let syncCount = 0

    const refreshDeployment = async () => {
      try {
        const deployment = await fetchPipelineDeployment(token, jobId)
        if (!disposed && deployment.url) setDeployUrl(deployment.url)
      } catch (deployError) {
        console.error('[pipeline] deployment refresh failed:', deployError)
      }
    }

    const sync = async () => {
      // The three requests are applied as each one lands rather than after
      // all of them: the first paint only needs the job detail, and a slow
      // log endpoint must not hold the whole screen back.
      let detailJob: JobDetail | null = null
      let stepsResponse: PipelineStepsResponse | null = null
      const firstSync = syncCount === 0
      const applyJob = () => {
        if (disposed) return
        // A terminal job detail wins over a lagging "running" steps summary.
        const status =
          detailJob && isTerminalJobStatus(detailJob.status)
            ? detailJob.status
            : stepsResponse?.job?.status || detailJob?.status
        if (status && !isTerminalJobStatus(status)) observedLive = true
        setJob((previous) => {
          const base = detailJob ?? previous
          if (!base) return previous
          // Keeps known steps when the steps endpoint is momentarily empty
          // while the backend is still persisting a callback.
          const merged = mergeJobWithSteps(base, stepsResponse)
          return preserveTerminal(
            previous,
            terminalEventRef.current ? applyJobEvent(merged, terminalEventRef.current) : merged,
          )
        })
      }

      const detailRequest = fetchJobDetail(token, jobId).then((value) => {
        detailJob = value
        noteActivity('lastEngineAt', toLocal(parseTime(value?.engineHeartbeatAt)))
        applyJob()
        return value
      })
      const stepsRequest = fetchPipelineSteps(token, jobId).then((value) => {
        stepsResponse = value
        applyJob()
        return value
      })
      const linesRequest = fetchPipelineLogs(token, jobId).then((value) => {
        if (disposed) return value
        const live = observedLive && !firstSync
        // New lines of a live run arrived since the previous poll.
        if (live && value.length > logsRef.current.length) noteActivity('lastLogAt', Date.now())
        commitLogs(mergeLogSnapshot(logsRef.current, value, Date.now(), live, liveRef.current))
        return value
      })

      const [detail, steps, lines] = await Promise.allSettled([detailRequest, stepsRequest, linesRequest])
      if (disposed) return
      const detailStatus = detail.status === 'fulfilled' ? detail.value?.status : undefined
      const status =
        detailStatus && isTerminalJobStatus(detailStatus)
          ? detailStatus
          : (steps.status === 'fulfilled' ? steps.value?.job?.status : undefined) || detailStatus
      syncCount += 1

      if (detail.status === 'rejected' && lines.status === 'rejected') {
        // The page shows a translated message; this raw detail is diagnostic.
        const reason = detail.reason
        setError(reason instanceof Error ? reason.message : String(reason))
      } else {
        setError(null)
      }

      if (status && isTerminalJobStatus(status) && !terminalRef.current) {
        terminalRef.current = true
        liveRef.current = false
        setConnection('closed')
        closeStreamRef.current()
        void refreshDeployment()
      }
    }

    const schedule = () => {
      if (disposed || terminalRef.current) return
      const delay = document.hidden
        ? POLL_HIDDEN_MS
        : liveRef.current
          ? POLL_WHILE_LIVE_MS
          : POLL_FALLBACK_MS
      timer = window.setTimeout(async () => {
        await sync()
        schedule()
      }, delay)
    }

    resyncRef.current = sync
    void refreshDeployment()
    void sync().then(schedule)

    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
      resyncRef.current = async () => undefined
    }
  }, [jobId, token, commitLogs, cached, noteActivity, toLocal, generation])

  // Start-latency phases (only recorded for runs started from this device).
  const hasJob = !!job
  const firstStageStarted = !!job?.steps.some((step) => step.status !== 'pending')
  useEffect(() => {
    if (hasJob && jobId) markStartPhase(jobId, 'screenShown')
  }, [hasJob, jobId])
  useEffect(() => {
    if (firstStageStarted && jobId) markStartPhase(jobId, 'firstStage')
  }, [firstStageStarted, jobId])

  // Show the service URL as soon as the deploy stage succeeds, instead of
  // waiting for the backend to finalize the whole job (results, status).
  const DEPLOY_STAGE = 7
  const deployStageDone = !!job?.steps.some(
    (step) => stageIndexForStep(step) === DEPLOY_STAGE && step.status === 'success',
  )
  const hasDeployUrl = !!deployUrl
  useEffect(() => {
    if (!deployStageDone || hasDeployUrl || !token || !jobId) return
    let cancelled = false
    fetchPipelineDeployment(token, jobId)
      .then((deployment) => {
        if (!cancelled && deployment.url) setDeployUrl(deployment.url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [deployStageDone, hasDeployUrl, token, jobId])

  // Once the run is finished and the stream is closed, snapshot what the page
  // shows so reopening it (from history or the result page) is instant. Logs
  // can still trickle in from the final resync, so this re-saves on change.
  useEffect(() => {
    if (!job || connection !== 'closed' || !isTerminalJobStatus(job.status)) return
    saveExecution(queryClient, { job, logs, deployUrl })
  }, [queryClient, job, logs, deployUrl, connection])

  // ── Real-time channel ───────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId || !token) return
    if (cached) return // finished run — nothing to stream
    void generation // restart after resume()

    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let stepRefreshTimer: number | null = null
    let attempts = 0
    let lastSeq: number | null = null
    // Health check: ping every 10s, and treat 30s of silence as a dead socket
    // (onclose then reconnects and resumes after the last seen seq).
    let healthTimer: number | null = null
    let lastMessageAt = Date.now()
    const stopHealth = () => {
      if (healthTimer !== null) window.clearInterval(healthTimer)
      healthTimer = null
    }

    const scheduleStepRefresh = () => {
      if (stepRefreshTimer !== null) window.clearTimeout(stepRefreshTimer)
      stepRefreshTimer = window.setTimeout(() => {
        stepRefreshTimer = null
        void resyncRef.current()
      }, STEP_REFRESH_DEBOUNCE_MS)
    }

    const finish = () => {
      terminalRef.current = true
      liveRef.current = false
      setConnection('closed')
      void resyncRef.current()
      socket?.close()
    }

    const handleMessage = (message: UnknownRecord) => {
      const type = typeof message.type === 'string' ? message.type : ''
      lastMessageAt = Date.now()
      if (type === 'pong' || type === 'sync_complete') return

      const seq = eventSeq(message)
      // A snapshot restates the whole log, so it is never a replay to drop.
      if (seq !== null && type !== 'log_snapshot') {
        if (lastSeq !== null && seq <= lastSeq) return // replayed after reconnect
        lastSeq = seq
      } else if (seq !== null) {
        lastSeq = Math.max(lastSeq ?? seq, seq)
      }

      if (type === 'engine_heartbeat') {
        noteServerClock(parseTime(message.timestamp))
        noteActivity('lastEngineAt', Date.now())
        return
      }

      if (type === 'log_snapshot') {
        noteActivity('lastEngineAt', toLocal(parseTime(message.engine_heartbeat_at)))
        noteActivity('lastLogAt', toLocal(parseTime(message.last_log_at)))
        if (typeof message.job_status === 'string') {
          const snapshot = { ...message, status: message.job_status }
          if (isTerminalJobStatus(message.job_status)) terminalEventRef.current = snapshot
          setJob(previous => previous ? applyJobEvent(previous, snapshot) : previous)
          if (isTerminalJobStatus(message.job_status)) finish()
        }
      }

      if (type === 'log_snapshot' && Array.isArray(message.lines)) {
        const lines = message.lines.filter((line): line is string => typeof line === 'string')
        // A snapshot sent on (re)connect is history unless it extends lines
        // we already hold.
        const live = logsRef.current.length > 0
        commitLogs(mergeLogSnapshot(logsRef.current, lines, Date.now(), live))
        return
      }

      if (type === 'log_batch' || type === 'log' || type === 'log_entry') {
        const events = streamEventsFrom(message)
        const receivedAt = Date.now()
        for (const event of events) noteServerClock(parseTime(event.timestamp), receivedAt)
        noteActivity('lastLogAt', receivedAt)
        commitLogs(appendLogEvents(logsRef.current, streamEventsFrom(message), Date.now()))
        return
      }

      if (Object.hasOwn(EVENT_STEP_STATUS, type) || type === 'step_complete' || type === 'stage_progress') {
        const patch = stepPatchFromEvent(message)
        if (patch) {
          // Stage events are pushed the moment the server stamps them, so
          // their started_at/ended_at anchor this client to the server clock.
          const receivedAt = Date.now()
          noteServerClock(parseTime(patch.startedAt), receivedAt)
          noteServerClock(parseTime(patch.endedAt), receivedAt)
          if (!patch.status && EVENT_STEP_STATUS[type]) patch.status = EVENT_STEP_STATUS[type]
          setJob((previous) =>
            previous ? preserveTerminal(previous, { ...previous, status: patch.status === 'running' ? 'running' : previous.status, startedAt: str(message, 'pipeline_started_at') ?? previous.startedAt, steps: applyStepPatch(previous.steps, patch) }) : previous,
          )
        }
        // A partial event is only a hint — fetch the persisted step state.
        // A complete persisted step is applied as-is, without a REST round trip.
        if (!isCompleteStep(patch)) scheduleStepRefresh()
        return
      }

      if (Object.hasOwn(EVENT_JOB_STATUS, type) || type === 'pipeline_complete' || type === 'pipeline_completed') {
        const status = typeof message.status === 'string' ? message.status : EVENT_JOB_STATUS[type] ?? (type === 'pipeline_completed' ? 'success' : '')
        if (isTerminalJobStatus(status)) terminalEventRef.current = { ...message, status }
        setJob((previous) => previous ? applyJobEvent(previous, { ...message, status }) : previous)
        if (isTerminalJobStatus(status)) finish()
        else scheduleStepRefresh()
      }

    }

    const connect = () => {
      if (disposed || terminalRef.current) return
      const url = `${WS_API_BASE_URL}/api/pipelines/${encodeURIComponent(jobId)}/logs/ws`
      const ws = new WebSocket(url)
      socket = ws

      ws.onopen = () => {
        if (terminalRef.current) {
          ws.close()
          return
        }
        // Resume after the last event we applied instead of replaying everything.
        ws.send(JSON.stringify({ type: 'authenticate', token, ...(lastSeq !== null ? { after_seq: lastSeq } : {}) }))
        lastMessageAt = Date.now()
        stopHealth()
        healthTimer = window.setInterval(() => {
          if (Date.now() - lastMessageAt > 30_000) {
            ws.close()
            return
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
        }, 10_000)
        const reconnected = attempts > 0
        attempts = 0
        liveRef.current = true
        setConnection('live')
        // Anything that happened while disconnected is fetched once.
        if (reconnected) void resyncRef.current()
      }

      ws.onmessage = (event) => {
        try {
          const parsed = asRecord(JSON.parse(String(event.data)))
          if (parsed) handleMessage(parsed)
        } catch (parseError) {
          console.error('[pipeline-ws] invalid message:', parseError)
        }
      }

      ws.onerror = () => {
        // onclose owns reconnect scheduling.
        ws.close()
      }

      ws.onclose = () => {
        stopHealth()
        if (socket === ws) socket = null
        liveRef.current = false
        if (disposed || terminalRef.current) return
        attempts += 1
        setConnection('reconnecting')
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (attempts - 1))
        reconnectTimer = window.setTimeout(connect, delay)
      }
    }

    closeStreamRef.current = () => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
    connect()

    return () => {
      disposed = true
      liveRef.current = false
      closeStreamRef.current = () => undefined
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      if (stepRefreshTimer !== null) window.clearTimeout(stepRefreshTimer)
      stopHealth()
      socket?.close()
    }
  }, [jobId, token, commitLogs, cached, noteActivity, noteServerClock, toLocal, generation])

  const cancel = useCallback(async () => {
    if (!token || !jobId) return
    const result = await cancelPipeline(token, jobId)
    if (result.status === 'cancelled') {
      terminalRef.current = true
      liveRef.current = false
      setConnection('closed')
      const event = { type: 'pipeline_cancelled', status: 'cancelled',
        completed_at: result.completedAt, started_at: result.startedAt, duration_secs: result.durationSecs }
      terminalEventRef.current = event
      setJob(previous => previous ? applyJobEvent(previous, event) : previous)
      closeStreamRef.current()
    }
    // Fetch final steps; a delayed running snapshot cannot undo cancellation.
    await resyncRef.current()
  }, [jobId, token])

  const resync = useCallback(() => resyncRef.current(), [])

  // Approval continued THIS job from where the gate stopped it: reopen it as a
  // live run. The stages after the gate go back to pending (they were only
  // "skipped" because of the stop), the terminal guards are lifted, the cached
  // finished snapshot is dropped, and polling + the WebSocket start again.
  const resume = useCallback(() => {
    terminalRef.current = false
    terminalEventRef.current = null
    liveRef.current = false
    queryClient.removeQueries({ queryKey: jobKeys.execution(jobId) })
    setCached(null)
    setJob((previous) => (previous ? reopenAfterGate(previous) : previous))
    setConnection('connecting')
    setGeneration((value) => value + 1)
  }, [queryClient, jobId])

  return { job, logs, activity, clockOffsetMs, connection, error, deployUrl, setDeployUrl, cancel, resync, resume }
}
