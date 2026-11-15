import type { JobDetail } from './api'
import { buildStageViews, isTerminalJobStatus, stageDurationSecs } from './pipelineExecution'

export function timestampMs(value: string | null | undefined): number | null {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : null
}

/** Never let an older REST response restart a terminal execution. */
export function preserveTerminal(previous: JobDetail | null, incoming: JobDetail): JobDetail {
  if (!previous) return incoming
  if (!isTerminalJobStatus(previous.status)) {
    const oldStart = timestampMs(previous.startedAt)
    const newStart = timestampMs(incoming.startedAt)
    return oldStart !== null && newStart !== null && oldStart > newStart
      ? { ...incoming, startedAt: previous.startedAt } : incoming
  }
  if (!isTerminalJobStatus(incoming.status)) return previous
  return { ...incoming, status: previous.status,
    completedAt: previous.completedAt ?? incoming.completedAt }
}

export function applyJobEvent(job: JobDetail, message: Record<string, unknown>): JobDetail {
  const type = String(message.type ?? '')
  const statuses: Record<string, JobDetail['status']> = { pipeline_started: 'running', pipeline_failed: 'failed',
    pipeline_cancelled: 'cancelled', pipeline_canceled: 'cancelled', pipeline_completed: 'success' }
  const implied = statuses[type]
  const raw = message.status ?? implied
  const status = ['queued','running','success','failed','cancelled'].includes(String(raw))
    ? raw as JobDetail['status'] : job.status
  const next = { ...job, status }
  if (typeof message.started_at === 'string') next.startedAt = message.started_at
  const end = message.completed_at ?? message.ended_at
  if (typeof end === 'string') next.completedAt = end
  if (typeof message.duration_secs === 'number') next.durationSecs = message.duration_secs
  return preserveTerminal(job, next)
}

export function executionTiming(job: JobDetail | null, serverNow: number | null) {
  if (!job) return { total: null, stages: null, waiting: null, ticking: false }
  const stages = buildStageViews(job.steps, job.status, job.completedAt)
  const terminal = isTerminalJobStatus(job.status)
  const stopped = terminal || stages.every(s => ['success','failed','skipped','cancelled'].includes(s.status)) ||
    (stages.some(s => s.status === 'failed' || s.status === 'cancelled') && !stages.some(s => s.status === 'running'))
  const ends = stages.map(s => timestampMs(s.endedAt)).filter((v): v is number => v !== null)
  const end = timestampMs(job.completedAt) ?? (stopped ? (ends.length ? Math.max(...ends) : null) : serverNow)
  const start = timestampMs(job.startedAt)
  const total = start !== null && end !== null ? Math.max(0, Math.floor((end-start)/1000))
    : terminal && job.durationSecs > 0 ? Math.floor(job.durationSecs) : null
  const durations = stages.map(s => s.status === 'running' && serverNow === null ? null : stageDurationSecs(s, end ?? 0))
  const sum = durations.reduce<number>((n, secs) => n + (secs ?? 0), 0)
  return { total, stages: total === null ? null : sum,
    waiting: total === null ? null : Math.max(0, total-sum), ticking: !stopped }
}

/** Monotonic clock: changing the PC wall clock cannot change elapsed time. */
export class ServerClock {
  private anchor: { server: number; monotonic: number } | null = null
  sample(serverTime: string, sent: number, received: number) {
    const server = timestampMs(serverTime)
    if (server === null || received < sent) return
    this.anchor = { server: server + (received-sent)/2, monotonic: received }
  }
  now(monotonic: number): number | null {
    return this.anchor ? this.anchor.server + Math.max(0, monotonic-this.anchor.monotonic) : null
  }
}
