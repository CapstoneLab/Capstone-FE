import { describe, expect, it, vi } from 'vitest'
import type { JobDetail, JobStep } from './api'
import { applyJobEvent, executionTiming, preserveTerminal, ServerClock } from './executionTiming'
import { mergeJobWithSteps } from '@/hooks/useJobQueries'
const start = '2026-11-15T15:00:00Z'
const at = (seconds: number) => new Date(Date.parse(start)+seconds*1000).toISOString()
const stage = (name: string, from: number, to: number | null, status: JobStep['status']): JobStep => ({
  stepId: name, stepName: name, stepType: name, status, startedAt: at(from), endedAt: to === null ? null : at(to), durationSecs: null, errorMessage: null,
})
const job = (extra: Partial<JobDetail> = {}): JobDetail => ({ jobId:'run', status:'running', startedAt:start,
  completedAt:null, durationSecs:0, steps:[stage('clone',0,null,'running')], ...extra } as JobDetail)

describe('server execution timing', () => {
  it('uses a monotonic server clock despite a wrong or changing PC clock', () => {
    const clock = new ServerClock()
    expect(clock.now(0)).toBeNull()
    clock.sample(at(10), 100, 300)
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at(3600)))
    expect(executionTiming(job(), clock.now(1300)).total).toBe(11)
    spy.mockReturnValue(Date.parse(at(-3600)))
    expect(executionTiming(job(), clock.now(2300)).total).toBe(12)
    spy.mockRestore()
  })
  it('does not invent a PC-based start before clock synchronization', () => {
    expect(executionTiming(job(), null).total).toBeNull()
  })
  it('freezes cancelled/failed runs even without a final REST response', () => {
    for (const status of ['cancelled','failed'] as const) {
      const stopped = applyJobEvent(job(), { type:`pipeline_${status}`, status, ended_at:at(20) })
      expect(executionTiming(stopped, Date.parse(at(500)))).toMatchObject({ total:20, stages:20, waiting:0 })
      expect(executionTiming(stopped, Date.parse(at(900))).ticking).toBe(false)
      expect(preserveTerminal(stopped, job())).toEqual(stopped)
    }
  })
  it('does not let an old running steps response override terminal detail', () => {
    const stopped = job({ status:'cancelled',completedAt:at(20) })
    expect(mergeJobWithSteps(stopped,{ steps:[],job:{status:'running',repoUrl:'',branch:'main',startedAt:start,completedAt:null,durationSecs:null} }).status).toBe('cancelled')
  })
  it('freezes after a failed stage while the final job callback is pending', () => {
    const stopped = job({steps:[stage('clone',0,12,'failed')]})
    expect(executionTiming(stopped, Date.parse(at(500)))).toMatchObject({ total:12,ticking:false })
  })
  it('accounts for transition time instead of pretending stage sum equals total', () => {
    const stopped = job({ status:'success',completedAt:at(30),steps:[stage('clone',0,10,'success'),stage('install',15,25,'success')] })
    expect(executionTiming(stopped, null)).toMatchObject({total:30,stages:20,waiting:10,ticking:false})
  })
  it('accepts zero-second completion and never resumes its timer', () => {
    const stopped = job({status:'cancelled',completedAt:start})
    expect(executionTiming(stopped,Date.parse(at(90))).total).toBe(0)
  })
  it('retains actual engine start when an earlier claim snapshot arrives late', () => {
    const current = job({startedAt:at(3)})
    expect(preserveTerminal(current,job()).startedAt).toBe(at(3))
  })
})

it('does not revert a running clone to a stale queued response', () => {
  const running = job()
  expect(preserveTerminal(running, job({status:'queued', startedAt:null, steps:[]}))).toBe(running)
})
