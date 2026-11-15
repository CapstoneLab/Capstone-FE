import { describe, expect, it } from 'vitest'
import { reduceStreamLogs, type StreamLogs } from './pipelineStream'

const empty: StreamLogs = { cursor: null, lines: [], times: [] }
describe('durable pipeline stream', () => {
  it('resumes after the snapshot cursor without duplicating replayed batches', () => {
    const snapshot = reduceStreamLogs(empty, { type: 'log_snapshot', seq: 10, lines: ['[test.log] old'] })
    const batch = { type: 'log_batch', seq: 12, events: [{ step_name: 'test', message: 'new', timestamp: '2026-11-15T00:00:00Z' }] }
    const current = reduceStreamLogs(snapshot, batch)
    expect(current.lines).toEqual(['[test.log] old', '[test.log] new'])
    expect(current.times[1]).toBe(Date.parse('2026-11-15T00:00:00Z'))
    expect(reduceStreamLogs(current, batch)).toBe(current)
    expect(reduceStreamLogs(current, { ...batch, seq: 9 })).toBe(current)
  })
  it('preserves repeated log messages and uses canonical stage tags', () => {
    const current = reduceStreamLogs(empty, { type: 'log_batch', seq: 4, events: [
      { step_name: 'security_gate', message: 'checking' },
      { step_name: 'security_gate', message: 'checking' },
    ] })
    expect(current.lines).toEqual(['[security-gate.log] checking', '[security-gate.log] checking'])
  })
  it('advances on lifecycle and heartbeat events without inventing log output', () => {
    const started = reduceStreamLogs(empty, { type: 'stage_started', seq: 3 })
    const heartbeat = reduceStreamLogs(started, { type: 'engine_heartbeat', seq: 4 })
    expect(heartbeat).toEqual({ cursor: 4, lines: [], times: [] })
  })
  it('reconciles lost batches with the completed-step snapshot', () => {
    const partial = reduceStreamLogs(empty, { type: 'log_batch', seq: 4, events: [{ message: 'first', step_name: 'test' }] })
    const reconciled = reduceStreamLogs(partial, { type: 'log_snapshot', seq: 9, lines: ['[test.log] first', '[test.log] missing', '[test.log] done'] })
    expect(reconciled.lines).toHaveLength(3)
    expect(reduceStreamLogs(reconciled, { type: 'log_batch', seq: 8, events: [{ message: 'missing' }] })).toBe(reconciled)
  })
})
