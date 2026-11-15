// Pure view-model helpers for the pipeline execution screen.
//
// Everything here derives from data the backend actually reported (job
// status, per-step status/timestamps/errors, log lines). Nothing simulates
// progress: an unknown duration stays unknown (`null`), a stage the backend
// has not touched stays `pending`, and log severity/stage are read from the
// line itself or from the structured event that carried it.

import type { JobStatus, JobStep } from '@/lib/api'

export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export const LOG_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR', 'DEBUG']

export type StageKey =
  | 'clone'
  | 'install'
  | 'vulnScan'
  | 'test'
  | 'deepScan'
  | 'gate'
  | 'build'
  | 'deploy'

export type StageDefinition = {
  number: number
  /** Translation key suffix: the UI shows t(`run.stage.${key}`). */
  key: StageKey
  /** Canonical English name (used by tests and as a stable identifier). */
  name: string
  /** Canonical log tag used when re-tagging streamed log events. */
  logTag: string
}

// Fixed order of the existing 8-stage pipeline. Do not reorder.
export const PIPELINE_STAGES: readonly StageDefinition[] = [
  { number: 1, key: 'clone', name: 'Repository Clone', logTag: 'clone' },
  { number: 2, key: 'install', name: 'Dependency Installation', logTag: 'install' },
  { number: 3, key: 'vulnScan', name: 'Vulnerability Scan', logTag: 'lightweight-security' },
  { number: 4, key: 'test', name: 'Testing', logTag: 'test' },
  { number: 5, key: 'deepScan', name: 'Deep Security Scan', logTag: 'deep-security' },
  { number: 6, key: 'gate', name: 'Security Gate', logTag: 'security-gate' },
  { number: 7, key: 'build', name: 'Build', logTag: 'build' },
  { number: 8, key: 'deploy', name: 'Deployment', logTag: 'deploy' },
]

export const TOTAL_STAGES = PIPELINE_STAGES.length

const TERMINAL_JOB = new Set<string>(['success', 'failed', 'cancelled'])
const TERMINAL_STAGE = new Set<StageStatus>(['success', 'failed', 'skipped', 'cancelled'])

export function isTerminalJobStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_JOB.has(status)
}

export function isTerminalStageStatus(status: StageStatus): boolean {
  return TERMINAL_STAGE.has(status)
}

/**
 * Maps a backend step identifier (step_type, step_name or a `[tag.log]` log
 * prefix) onto the 0-based stage index. Order matters: the light scan and
 * gate patterns must win over the generic `security` / `test` words.
 */
export function stageIndexForTag(value: string | null | undefined): number | null {
  if (!value) return null
  const key = value
    .toLowerCase()
    .replace(/\.log$/i, '')
    .replace(/[_\s]+/g, '-')
    .trim()
  if (!key) return null
  if (/clone|checkout|repository|레포|클론/.test(key)) return 0
  if (/install|deps|dependenc|의존성|설치/.test(key)) return 1
  if (/lightweight-security|light-security|security-light|scan-light|gitleaks|vulnerab|경량/.test(key)) return 2
  if (/deep-security|security-deep|scan-deep|sast-deep|semgrep|deep|심화/.test(key)) return 4
  if (/security-gate|gate|verdict|threshold|게이트/.test(key)) return 5
  if (/test|jest|lint|coverage|테스트/.test(key)) return 3
  if (/build|compile|bundle|빌드/.test(key)) return 6
  if (/deploy|release|publish|배포/.test(key)) return 7
  return null
}

export function stageIndexForStep(step: Pick<JobStep, 'stepType' | 'stepName'>): number | null {
  return stageIndexForTag(step.stepType) ?? stageIndexForTag(step.stepName)
}

/** Normalises the many spellings a backend may use into a StageStatus. */
export function normalizeStageStatus(raw: string | null | undefined): StageStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'running':
    case 'in_progress':
    case 'in-progress':
    case 'started':
      return 'running'
    case 'success':
    case 'succeeded':
    case 'passed':
    case 'completed':
    case 'done':
      return 'success'
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return 'pending'
  }
}

export type StageView = {
  index: number
  number: number
  key: StageKey
  name: string
  /** Status shown in the UI (backend status reconciled with job state). */
  status: StageStatus
  /** Raw status the backend reported for the step, or null if no step yet. */
  backendStatus: StageStatus | null
  stepId: string | null
  startedAt: string | null
  endedAt: string | null
  durationSecs: number | null
  errorMessage: string | null
}

/**
 * Places the backend steps into the fixed 8 stage slots.
 *
 * Reconciliation with the overall job state (the only adjustment made):
 * once the job itself is terminal, a stage can no longer be pending or
 * running, so
 *   - pending → skipped (it never executed),
 *   - running → cancelled when the job was cancelled, failed when the job
 *     failed and no other stage carries the failure, success when the job
 *     succeeded.
 * While the job is live, the backend's per-step status is shown verbatim.
 */
export function buildStageViews(steps: JobStep[], jobStatus: JobStatus | string, completedAt?: string | null): StageView[] {
  const slots: (JobStep | null)[] = PIPELINE_STAGES.map(() => null)
  const unmatched: { step: JobStep; position: number }[] = []

  steps.forEach((step, position) => {
    const idx = stageIndexForStep(step)
    if (idx !== null && !slots[idx]) slots[idx] = step
    else unmatched.push({ step, position })
  })
  // A backend that reports exactly the 8 steps in order but with names we do
  // not recognise still lines up by position.
  if (steps.length === TOTAL_STAGES) {
    for (const { step, position } of unmatched) {
      if (!slots[position]) slots[position] = step
    }
  }

  const terminal = isTerminalJobStatus(jobStatus)
  const anyFailed = slots.some((step) => step && normalizeStageStatus(step.status) === 'failed')

  return PIPELINE_STAGES.map((def, index) => {
    const step = slots[index]
    const backendStatus = step ? normalizeStageStatus(step.status) : null
    let status: StageStatus = backendStatus ?? 'pending'

    if (terminal) {
      if (status === 'pending') status = 'skipped'
      else if (status === 'running') {
        if (jobStatus === 'cancelled') status = 'cancelled'
        else if (jobStatus === 'failed') status = anyFailed ? 'cancelled' : 'failed'
        else status = 'success'
      }
    }

    return {
      index,
      number: def.number,
      key: def.key,
      name: def.name,
      status,
      backendStatus,
      stepId: step?.stepId || null,
      startedAt: step?.startedAt ?? null,
      endedAt: step?.endedAt ?? (terminal && backendStatus === 'running' ? completedAt ?? null : null),
      durationSecs: step?.durationSecs ?? null,
      errorMessage: step?.errorMessage ?? null,
    }
  })
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Real execution duration of a stage in seconds, or null when the backend
 * has not reported enough to know it. A running stage ticks from its
 * backend `started_at`, using the synchronized server clock.
 */
export function stageDurationSecs(
  stage: Pick<StageView, 'status' | 'startedAt' | 'endedAt' | 'durationSecs'>,
  nowMs: number,
): number | null {
  const start = parseTime(stage.startedAt)
  if (stage.status === 'running') {
    const from = start
    return from === null ? null : Math.max(0, Math.floor((nowMs - from) / 1000))
  }
  if (stage.status === 'pending') return null
  const end = parseTime(stage.endedAt)
  if (start !== null && end !== null && end >= start) {
    return Math.floor((end - start) / 1000)
  }
  if (typeof stage.durationSecs === 'number' && stage.durationSecs > 0) {
    return Math.floor(stage.durationSecs)
  }
  if (stage.durationSecs === 0 && (stage.status === 'success' || stage.status === 'failed')) {
    return 0
  }
  return null
}

export type ExecutionProgress = {
  total: number
  /** Stages that are done without a problem: succeeded, or explicitly skipped
   *  by the pipeline (backend status "skipped", e.g. a repo with no tests), so
   *  a run where every stage passed or was skipped reads 8/8 · 100%. Stages
   *  never reached after a failure/cancel (shown as skipped) do not count. */
  completed: number
  /** Stages that actually ran and succeeded. */
  succeeded: number
  failed: number
  skipped: number
  cancelled: number
  /** Index of the stage currently executing, or -1. */
  currentIndex: number
  /** completed / total, as an integer percentage. */
  percent: number
}

export function summarizeProgress(stages: StageView[]): ExecutionProgress {
  const count = (status: StageStatus) => stages.filter((stage) => stage.status === status).length
  const succeeded = count('success')
  const completed =
    succeeded +
    stages.filter((stage) => stage.status === 'skipped' && stage.backendStatus === 'skipped').length
  const total = stages.length || TOTAL_STAGES
  return {
    total,
    completed,
    succeeded,
    failed: count('failed'),
    skipped: count('skipped'),
    cancelled: count('cancelled'),
    currentIndex: stages.findIndex((stage) => stage.status === 'running'),
    percent: Math.round((completed / total) * 100),
  }
}

/** Overall execution tone; the UI translates it via `run.headline.<tone>.*`. */
export type ExecutionTone = 'success' | 'running' | 'failed' | 'queued' | 'cancelled'

export function executionTone(status: JobStatus | string): ExecutionTone {
  switch (status) {
    case 'success':
    case 'running':
    case 'failed':
    case 'cancelled':
      return status
    default:
      return 'queued'
  }
}

export type DurationLocale = 'ko' | 'en'

export function formatDurationSecs(
  totalSeconds: number | null | undefined,
  locale: DurationLocale = 'en',
): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return '—'
  }
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (locale === 'ko') {
    if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`
    if (minutes > 0) return `${minutes}분 ${seconds}초`
    return `${seconds}초`
  }
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  const date = new Date(ms)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export function formatDateTime(value: string | null | undefined): string {
  const ms = parseTime(value)
  if (ms === null) return '—'
  const date = new Date(ms)
  const ymd = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, idx) => (idx === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-')
  return `${ymd} ${formatClock(ms)}`
}

// ─── Logs ────────────────────────────────────────────────────────────────

export type LogEntry = {
  /** Position in the execution's log stream (0-based). Stable React key. */
  seq: number
  raw: string
  /** Line without its leading stage tag. */
  message: string
  stageIndex: number | null
  level: LogLevel
  /** Timestamp the line itself (or its event) carried, if any. */
  timestampMs: number | null
  /** When this client received the line. */
  receivedAtMs: number
  /** True when received while the run was live (receivedAt ≈ emit time). */
  live: boolean
}

export type LogHints = {
  stageName?: string | null
  level?: string | null
  timestamp?: string | number | null
}

const TIMESTAMP_PATTERN =
  /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/
const BRACKET_PATTERN = /\[([^\]\r\n]{1,80}?)\]/g

export function normalizeLogLevel(raw: string | null | undefined): LogLevel | null {
  switch ((raw ?? '').toUpperCase()) {
    case 'ERROR':
    case 'ERR':
    case 'FATAL':
    case 'CRITICAL':
      return 'ERROR'
    case 'WARN':
    case 'WARNING':
      return 'WARN'
    case 'DEBUG':
    case 'TRACE':
      return 'DEBUG'
    case 'INFO':
    case 'NOTICE':
      return 'INFO'
    default:
      return null
  }
}

/** Severity written in the line itself; INFO when the line states none. */
export function detectLogLevel(line: string): LogLevel {
  // Upper-case level tokens are matched case-sensitively so ordinary prose
  // ("error handling test passed") is not promoted to ERROR.
  if (
    /\b(ERROR|FATAL|CRITICAL)\b|npm ERR!|Traceback \(most recent call last\)/.test(line) ||
    /(^|[\s[])error[:\]]/i.test(line)
  ) {
    return 'ERROR'
  }
  if (/\b(WARN|WARNING)\b/.test(line) || /(^|[\s[])warn(?:ing)?[:\]]/i.test(line)) return 'WARN'
  if (/\b(DEBUG|TRACE)\b/.test(line) || /(^|[\s[])debug[:\]]/i.test(line)) return 'DEBUG'
  return 'INFO'
}

function parseTimestampHint(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    // Accept both epoch seconds and epoch milliseconds.
    return value < 1e12 ? value * 1000 : value
  }
  return parseTime(value.replace(',', '.'))
}

export function parseLogLine(
  raw: string,
  seq: number,
  receivedAtMs: number,
  live: boolean,
  hints: LogHints = {},
): LogEntry {
  let stageIndex = hints.stageName ? stageIndexForTag(hints.stageName) : null
  let message = raw

  // Find the first bracketed token that names a stage ([build.log], [test]),
  // skipping level/time brackets such as [INFO] or [12:00:01].
  for (const match of raw.matchAll(BRACKET_PATTERN)) {
    const token = match[1].trim()
    if (normalizeLogLevel(token) || /^\d/.test(token)) continue
    const idx = stageIndexForTag(token)
    if (idx === null) continue
    if (stageIndex === null) stageIndex = idx
    message = (raw.slice(0, match.index) + raw.slice((match.index ?? 0) + match[0].length))
      .replace(/^\s+/, '')
    break
  }

  const timestampMs =
    parseTimestampHint(hints.timestamp) ??
    (() => {
      const found = raw.match(TIMESTAMP_PATTERN)?.[1]
      return found ? parseTime(found.replace(' ', 'T').replace(',', '.')) : null
    })()

  return {
    seq,
    raw,
    message,
    stageIndex,
    level: normalizeLogLevel(hints.level) ?? detectLogLevel(raw),
    timestampMs,
    receivedAtMs,
    live,
  }
}

/**
 * Merges a full REST log snapshot into the entries already shown.
 *
 * The REST endpoint returns the whole log so far, so lines that match the
 * current prefix keep their entry (and receive time); only genuinely new
 * lines are appended. A snapshot that is shorter than what the live stream
 * already delivered is ignored while `keepLongerCurrent` is set, so a lagging
 * poll never makes streamed lines disappear or reappear twice.
 */
export function mergeLogSnapshot(
  current: LogEntry[],
  lines: string[],
  nowMs: number,
  live: boolean,
  keepLongerCurrent = false,
): LogEntry[] {
  if (lines.length === 0) return current
  let prefix = 0
  while (prefix < current.length && prefix < lines.length && current[prefix].raw === lines[prefix]) {
    prefix += 1
  }
  if (prefix === lines.length && lines.length <= current.length) return current
  if (prefix < current.length && keepLongerCurrent && lines.length < current.length) return current

  const next = current.slice(0, prefix)
  for (let i = prefix; i < lines.length; i += 1) {
    next.push(parseLogLine(lines[i], i, nowMs, live))
  }
  return next
}

export type StreamLogEvent = {
  message: string
  stageName?: string | null
  level?: string | null
  timestamp?: string | number | null
}

/** Appends streamed log events (one event may hold several lines). */
export function appendLogEvents(
  current: LogEntry[],
  events: StreamLogEvent[],
  nowMs: number,
): LogEntry[] {
  const additions: LogEntry[] = []
  let seq = current.length
  for (const event of events) {
    if (typeof event.message !== 'string') continue
    const stageIdx = stageIndexForTag(event.stageName)
    const tag = stageIdx !== null ? PIPELINE_STAGES[stageIdx].logTag : event.stageName || 'pipeline'
    for (const line of event.message.split(/\r?\n/)) {
      // Same `[tag.log] line` shape the REST endpoint returns, so a later
      // snapshot recognises these lines as already shown.
      additions.push(
        parseLogLine(`[${tag}.log] ${line}`, seq, nowMs, true, {
          stageName: event.stageName,
          level: event.level,
          timestamp: event.timestamp,
        }),
      )
      seq += 1
    }
  }
  return additions.length === 0 ? current : [...current, ...additions]
}

/**
 * Stage for an untagged line, from real timestamps only: the line's own
 * timestamp, or its receive time when it streamed in live. Lines loaded
 * from history without a timestamp stay unassigned ("General").
 */
export function resolveLogStage(entry: LogEntry, stages: StageView[], nowMs: number): number | null {
  if (entry.stageIndex !== null) return entry.stageIndex
  const at = entry.timestampMs ?? (entry.live ? entry.receivedAtMs : null)
  if (at === null) return null
  for (const stage of stages) {
    const start = parseTime(stage.startedAt)
    if (start === null || at < start) continue
    const end = parseTime(stage.endedAt) ?? (stage.status === 'running' ? nowMs : null)
    if (end !== null && at <= end) return stage.index
  }
  return null
}

export type LogFilter = {
  /** 'all', 'general' (no stage) or a stage index. */
  stage: 'all' | 'general' | number
  levels: ReadonlySet<LogLevel>
  query?: string
}

export function filterLogEntries<T extends LogEntry & { resolvedStage: number | null }>(
  entries: T[],
  filter: LogFilter,
): T[] {
  const query = filter.query?.trim().toLowerCase() ?? ''
  return entries.filter((entry) => {
    if (filter.stage === 'general' && entry.resolvedStage !== null) return false
    if (typeof filter.stage === 'number' && entry.resolvedStage !== filter.stage) return false
    if (!filter.levels.has(entry.level)) return false
    if (query && !entry.raw.toLowerCase().includes(query)) return false
    return true
  })
}

/**
 * Plain-text export of log lines. Labels come from the caller so the copy
 * matches the language the user is viewing.
 */
export function formatLogsForCopy(
  entries: (LogEntry & { resolvedStage: number | null })[],
  stageLabel: (stageIndex: number | null) => string,
  levelLabel: (level: LogLevel) => string,
): string {
  return entries
    .map((entry) => {
      const at = entry.timestampMs ?? (entry.live ? entry.receivedAtMs : null)
      return `${at !== null ? formatClock(at) : '--:--:--'} ${levelLabel(entry.level)} [${stageLabel(entry.resolvedStage)}] ${entry.message}`
    })
    .join('\n')
}

// ── Server clock ───────────────────────────────────────────────────────────
// Stage/job timestamps come from the server, but elapsed timers tick on this
// PC's clock, so any skew between the two shows up as wrong durations. A line
// stamped by the server at T and received here at R gives T − R ≤ offset (it
// cannot arrive before it was written); the largest such sample is the best
// estimate of serverClock − localClock.

/** Samples further apart than this are a parsing/timezone problem, not skew. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

/** Folds one (serverMs, receivedMs) observation into the running estimate. */
export function foldClockSample(current: number | null, serverMs: number | null, receivedMs: number): number | null {
  if (serverMs === null || !Number.isFinite(serverMs)) return current
  const sample = serverMs - receivedMs
  if (Math.abs(sample) > MAX_CLOCK_SKEW_MS) return current
  return current === null || sample > current ? sample : current
}

/** Estimate from log lines received live (history lines carry no timing). */
export function estimateClockOffset(entries: LogEntry[], initial: number | null = null): number | null {
  let offset = initial
  for (const entry of entries) {
    if (entry.live) offset = foldClockSample(offset, entry.timestampMs, entry.receivedAtMs)
  }
  return offset
}

/**
 * Server time (ms) at which the run stopped, or null while it is still live.
 * Every timer on the page stops here, on the server's own timeline:
 *   1. completed_at, when the backend reported it;
 *   2. otherwise, once no stage is running and the run cannot continue —
 *      job terminal, every stage done, or a stage failed/was cancelled while
 *      the job status has not caught up yet — the last stage's ended_at;
 *   3. a terminal job without any timestamps: started_at + duration_secs.
 */
export function runStoppedAtMs(
  job: { startedAt: string | null; completedAt: string | null; durationSecs: number },
  stages: Pick<StageView, 'status' | 'endedAt'>[],
  terminal: boolean,
): number | null {
  const start = parseTime(job.startedAt)
  const end = parseTime(job.completedAt)
  if (end !== null && (start === null || end >= start)) return end
  const anyRunning = stages.some((stage) => stage.status === 'running')
  const allDone = stages.length > 0 && stages.every((stage) => stage.status !== 'pending' && stage.status !== 'running')
  const halted = stages.some((stage) => stage.status === 'failed' || stage.status === 'cancelled')
  if (!terminal && (anyRunning || !(allDone || halted))) return null
  const lastEnd = stages.reduce<number | null>((latest, stage) => {
    const ended = parseTime(stage.endedAt)
    return ended !== null && (latest === null || ended > latest) ? ended : latest
  }, null)
  if (lastEnd !== null && (start === null || lastEnd >= start)) return lastEnd
  if (terminal && start !== null && job.durationSecs > 0) return start + job.durationSecs * 1000
  return null
}

/**
 * Total run time in seconds once the run has stopped (see runStoppedAtMs),
 * or null while it is live. Measured from the server's started_at, never
 * from this PC's clock, so it does not keep growing after the end.
 */
export function finishedElapsedSecs(
  job: { startedAt: string | null; completedAt: string | null; durationSecs: number },
  stages: Pick<StageView, 'status' | 'endedAt'>[],
  terminal: boolean,
): number | null {
  const start = parseTime(job.startedAt)
  const stoppedAt = runStoppedAtMs(job, stages, terminal)
  if (stoppedAt !== null && start !== null) return Math.max(0, Math.round((stoppedAt - start) / 1000))
  if (terminal) return job.durationSecs > 0 ? job.durationSecs : null
  return null
}

/**
 * Splits the total into time spent inside stages and time between/around
 * them (queueing, container start-up, hand-over), so the stage chips add up
 * to the total shown: total = stages + waiting.
 */
export function timeBreakdown(totalSecs: number | null, stageSecs: (number | null)[]) {
  if (totalSecs === null) return null
  const stages = stageSecs.reduce<number>((sum, secs) => sum + (secs ?? 0), 0)
  return { total: totalSecs, stages, waiting: Math.max(0, totalSecs - stages) }
}
