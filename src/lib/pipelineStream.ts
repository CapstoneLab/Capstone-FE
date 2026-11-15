export type StreamMessage = {
  type?: string
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
