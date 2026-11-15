import { describe, expect, it } from 'vitest'
import { runDurationSecs } from './api'
import {
  estimateClockOffset,
  finishedElapsedSecs,
  runStoppedAtMs,
  timeBreakdown,
  foldClockSample,
  type LogEntry,
} from './pipelineExecution'

function entry(timestampMs: number | null, receivedAtMs: number, live = true): LogEntry {
  return { seq: 0, raw: '', message: '', stageIndex: null, level: 'INFO', timestampMs, receivedAtMs, live }
}

describe('server clock offset', () => {
  it('takes the largest server − received sample (server 5s ahead)', () => {
    const offset = estimateClockOffset([
      entry(100_000, 96_000), // arrived 1s late → 4s
      entry(110_000, 105_000), // arrived immediately → 5s
      entry(120_000, 117_000), // arrived 2s late → 3s
    ])
    expect(offset).toBe(5_000)
  })

  it('handles a server clock that is behind', () => {
    expect(estimateClockOffset([entry(100_000, 103_000)])).toBe(-3_000)
  })

  it('ignores history lines and absurd samples', () => {
    expect(estimateClockOffset([entry(100_000, 50_000, false)])).toBeNull()
    expect(foldClockSample(null, 100_000 + 2 * 24 * 3600_000, 100_000)).toBeNull()
  })
})

describe('finishedElapsedSecs', () => {
  const job = { startedAt: '2026-11-15T14:39:12Z', completedAt: '2026-11-15T14:41:24Z', durationSecs: 999 }

  it('uses completed_at − started_at, ignoring a growing duration_secs', () => {
    expect(finishedElapsedSecs(job, [], true)).toBe(132)
  })

  it('freezes at the last stage end when all stages are done but the job is not marked finished', () => {
    const live = { ...job, completedAt: null }
    const stages = [
      { status: 'success' as const, endedAt: '2026-11-15T14:40:00Z' },
      { status: 'skipped' as const, endedAt: null },
      { status: 'success' as const, endedAt: '2026-11-15T14:40:44Z' },
    ]
    expect(finishedElapsedSecs(live, stages, false)).toBe(92)
  })

  it('returns null while a stage is still running', () => {
    const live = { ...job, completedAt: null }
    expect(finishedElapsedSecs(live, [{ status: 'running', endedAt: null }], false)).toBeNull()
  })
})

describe('runDurationSecs', () => {
  it('fixes a finished run to its timestamps', () => {
    expect(runDurationSecs('success', '2026-11-15T14:39:12Z', '2026-11-15T14:41:24Z', 5000)).toBe(132)
  })

  it('uses the reported value for a live run', () => {
    expect(runDurationSecs('running', '2026-11-15T14:39:12Z', null, 40)).toBe(40)
  })
})

describe('runStoppedAtMs (one stop point on the server timeline)', () => {
  const base = { startedAt: '2026-11-15T14:39:12Z', completedAt: null, durationSecs: 0 }
  const at = (iso: string) => Date.parse(iso)

  it('is null while a stage is running', () => {
    expect(runStoppedAtMs(base, [{ status: 'running', endedAt: null }], false)).toBeNull()
  })

  it('stops at the failed stage when the job status has not caught up', () => {
    const stages = [
      { status: 'success' as const, endedAt: '2026-11-15T14:39:40Z' },
      { status: 'failed' as const, endedAt: '2026-11-15T14:40:05Z' },
      { status: 'pending' as const, endedAt: null },
    ]
    expect(runStoppedAtMs(base, stages, false)).toBe(at('2026-11-15T14:40:05Z'))
  })

  it('stops at a cancelled stage', () => {
    const stages = [{ status: 'cancelled' as const, endedAt: '2026-11-15T14:39:30Z' }]
    expect(runStoppedAtMs(base, stages, false)).toBe(at('2026-11-15T14:39:30Z'))
  })

  it('prefers completed_at', () => {
    const job = { ...base, completedAt: '2026-11-15T14:41:24Z' }
    expect(runStoppedAtMs(job, [{ status: 'running', endedAt: null }], true)).toBe(at('2026-11-15T14:41:24Z'))
  })
})

describe('timeBreakdown', () => {
  it('total = stages + waiting', () => {
    expect(timeBreakdown(132, [9, 11, 5, 4, 9, 4, 6, 9])).toEqual({ total: 132, stages: 57, waiting: 75 })
  })

  it('ignores stages without a duration and never goes negative', () => {
    expect(timeBreakdown(10, [6, null, 7])).toEqual({ total: 10, stages: 13, waiting: 0 })
    expect(timeBreakdown(null, [1])).toBeNull()
  })
})
