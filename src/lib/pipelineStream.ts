import type { JobStep } from './api'

export type StreamMessage = {
  type?: string
  step?: Record<string, unknown>
  seq?: number
  job_status?: string
  engine_heartbeat_at?: string
  last_log_at?: string
  timestamp?: string
  lines?: unknown
  events?: { message?: string; line?: string; step_name?: string; timestamp?: string }[]
}

export type StreamLogs = { cursor: number | null; lines: string[]; times: (number | null)[] }

/** Cursor deduplication preserves legitimate identical consecutive log lines. */
export function reduceStreamLogs(state: StreamLogs, message: StreamMessage): StreamLogs {
  const seq = typeof message.seq === 'number' && Number.isSafeInteger(message.seq) ? message.seq : null
  if (message.type !== 'log_snapshot' && seq !== null && state.cursor !== null && seq <= state.cursor) return state
  if (message.type === 'log_snapshot' && Array.isArray(message.lines)) {
    const lines = message.lines.filter((line): line is string => typeof line === 'string')
    return { cursor: seq, lines, times: lines.map(() => null) }
  }
  const lines: string[] = []
  const times: (number | null)[] = []
  if (message.type === 'log_batch') {
    for (const event of message.events ?? []) {
      if (typeof event.message !== 'string') continue
      const tag = (event.step_name || 'pipeline').replace(/^security_gate$/, 'security-gate')
      const incoming = typeof event.line === 'string' ? [event.line] : event.message.split(/\r?\n/).map((line) => `[${tag}.log] ${line}`)
      const parsed = Date.parse(event.timestamp ?? message.timestamp ?? '')
      lines.push(...incoming)
      times.push(...incoming.map(() => Number.isFinite(parsed) ? parsed : null))
    }
  }
  return { cursor: seq ?? state.cursor, lines: [...state.lines, ...lines], times: [...state.times, ...times] }
}


/** Use the persisted stage event immediately; REST is only a recovery path. */
export function stepFromStream(message: StreamMessage): JobStep | null {
  if (!message.type?.startsWith('stage_') && !['step_started', 'step_complete'].includes(message.type ?? '')) return null
  const step = message.step
  if (!step || typeof step.step_id !== 'string' || typeof step.step_name !== 'string'
    || typeof step.step_type !== 'string' || !['pending', 'running', 'success', 'failed', 'skipped', 'cancelled'].includes(String(step.status))) return null
  return {
    stepId: step.step_id, stepName: step.step_name, stepType: step.step_type,
    status: step.status as JobStep['status'],
    errorMessage: typeof step.error_message === 'string' ? step.error_message : null,
    startedAt: typeof step.started_at === 'string' ? step.started_at : null,
    endedAt: typeof step.ended_at === 'string' ? step.ended_at : null,
    durationSecs: typeof step.duration_secs === 'number' ? step.duration_secs : null,
  }
}

export function mergeStreamStep(steps: JobStep[], incoming: JobStep): JobStep[] {
  const index = steps.findIndex((step) => step.stepId === incoming.stepId || step.stepName === incoming.stepName)
  if (index < 0) return [...steps, incoming]
  const current = steps[index]
  // A replayed start cannot undo a completed stage.
  if (['success', 'failed', 'skipped', 'cancelled'].includes(current.status) && incoming.status !== current.status) return steps
  return steps.map((step, i) => i === index ? { ...incoming,
    startedAt: incoming.startedAt ?? step.startedAt,
    endedAt: incoming.endedAt ?? step.endedAt,
    durationSecs: incoming.durationSecs ?? step.durationSecs,
  } : step)
}
