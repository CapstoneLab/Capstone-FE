import { describe, expect, it } from 'vitest'
import type { JobStep } from '@/lib/api'
import {
  LOG_LEVELS,
  PIPELINE_STAGES,
  appendLogEvents,
  buildStageViews,
  detectLogLevel,
  filterLogEntries,
  mergeLogSnapshot,
  parseLogLine,
  resolveLogStage,
  stageDurationSecs,
  stageIndexForTag,
  summarizeProgress,
} from '@/lib/pipelineExecution'

const BACKEND_TYPES = [
  'clone',
  'install',
  'security-light',
  'test',
  'security-deep',
  'security-gate',
  'build',
  'deploy',
]

function step(index: number, status: JobStep['status'], extra: Partial<JobStep> = {}): JobStep {
  return {
    stepId: `s${index}`,
    stepName: BACKEND_TYPES[index],
    stepType: BACKEND_TYPES[index],
    status,
    errorMessage: null,
    startedAt: null,
    endedAt: null,
    durationSecs: null,
    ...extra,
  }
}

describe('stage mapping', () => {
  it('keeps the 8 stages in the fixed order with English names', () => {
    expect(PIPELINE_STAGES.map((stage) => stage.name)).toEqual([
      'Repository Clone',
      'Dependency Installation',
      'Vulnerability Scan',
      'Testing',
      'Deep Security Scan',
      'Security Gate',
      'Build',
      'Deployment',
    ])
  })

  it('recognises backend types, Korean names, English names and log tags', () => {
    const cases: [string, number][] = [
      ['clone', 0], ['레포지토리 클론', 0], ['Repository Clone', 0],
      ['install', 1], ['Dependency Installation', 1],
      ['security-light', 2], ['lightweight-security.log', 2], ['Vulnerability Scan', 2], ['경량 보안 검사', 2],
      ['test', 3], ['Testing', 3],
      ['security-deep', 4], ['Deep Security Scan', 4], ['심화 보안 검사', 4],
      ['security-gate', 5], ['Security Gate', 5], ['보안 게이트', 5],
      ['build', 6], ['Deployment', 7], ['deploy.log', 7],
    ]
    for (const [value, index] of cases) expect([value, stageIndexForTag(value)]).toEqual([value, index])
  })

  it('shows the backend step status verbatim while the run is live', () => {
    const stages = buildStageViews(
      [step(0, 'success'), step(1, 'success'), step(2, 'running')],
      'running',
    )
    expect(stages.map((stage) => stage.status)).toEqual([
      'success', 'success', 'running', 'pending', 'pending', 'pending', 'pending', 'pending',
    ])
  })

  it('falls back to position when 8 unrecognised steps arrive in order', () => {
    const steps = Array.from({ length: 8 }, (_, i) => ({ ...step(i, 'success'), stepType: `x${i}`, stepName: `x${i}` }))
    expect(buildStageViews(steps, 'success').map((stage) => stage.stepId)).toEqual(
      steps.map((s) => s.stepId),
    )
  })

  it.each(PIPELINE_STAGES.map((stage, index) => [stage.name, index] as const))(
    'failure in %s: earlier stages succeed, that stage fails, later stages are skipped',
    (_name, failedIndex) => {
      const steps = PIPELINE_STAGES.slice(0, failedIndex + 1).map((_, i) =>
        step(i, i === failedIndex ? 'failed' : 'success', i === failedIndex ? { errorMessage: 'boom' } : {}),
      )
      const stages = buildStageViews(steps, 'failed')
      stages.forEach((stage, i) => {
        expect(stage.status).toBe(i < failedIndex ? 'success' : i === failedIndex ? 'failed' : 'skipped')
      })
      expect(stages[failedIndex].errorMessage).toBe('boom')
      const progress = summarizeProgress(stages)
      expect(progress.completed).toBe(8)
      expect(progress.failed).toBe(1)
      expect(progress.currentIndex).toBe(-1)
    },
  )

  it('cancellation mid-run marks the running stage cancelled and the rest skipped', () => {
    const stages = buildStageViews([step(0, 'success'), step(1, 'running')], 'cancelled')
    expect(stages.slice(0, 3).map((stage) => stage.status)).toEqual(['success', 'cancelled', 'skipped'])
    expect(summarizeProgress(stages).completed).toBe(8)
  })

  it('accepts a backend that reports cancelled steps itself', () => {
    const stages = buildStageViews([step(0, 'success'), step(1, 'cancelled')], 'cancelled')
    expect(stages[1].status).toBe('cancelled')
  })

  it('all 8 stages succeed → 8/8, 100%', () => {
    const stages = buildStageViews(PIPELINE_STAGES.map((_, i) => step(i, 'success')), 'success')
    expect(summarizeProgress(stages)).toMatchObject({ completed: 8, total: 8, percent: 100 })
  })

  it('counts skipped as complete but leaves pending incomplete', () => {
    const stages = buildStageViews([step(0, 'success'), step(1, 'skipped')], 'running')
    expect(summarizeProgress(stages)).toMatchObject({ completed: 2, skipped: 1, percent: 25 })
  })
})

describe('stage duration', () => {
  const now = Date.parse('2026-11-14T10:00:30Z')

  it('ticks a running stage from its backend start time', () => {
    expect(
      stageDurationSecs({ status: 'running', startedAt: '2026-11-14T10:00:00Z', endedAt: null, durationSecs: null }, now),
    ).toBe(30)
  })

  it('uses real timestamps for finished stages', () => {
    expect(
      stageDurationSecs(
        { status: 'success', startedAt: '2026-11-14T10:00:00Z', endedAt: '2026-11-14T10:00:12Z', durationSecs: null },
        now,
      ),
    ).toBe(12)
  })

  it('reports unknown instead of inventing a duration', () => {
    expect(stageDurationSecs({ status: 'success', startedAt: null, endedAt: null, durationSecs: null }, now)).toBeNull()
    expect(stageDurationSecs({ status: 'running', startedAt: null, endedAt: null, durationSecs: null }, now)).toBeNull()
    expect(stageDurationSecs({ status: 'pending', startedAt: null, endedAt: null, durationSecs: 5 }, now)).toBeNull()
  })
})

describe('log parsing', () => {
  it('reads stage, level and timestamp from the line', () => {
    const entry = parseLogLine('[build.log] 2026-11-14T10:00:05Z ERROR tsc failed', 0, 1, false)
    expect(entry.stageIndex).toBe(6)
    expect(entry.level).toBe('ERROR')
    expect(entry.timestampMs).toBe(Date.parse('2026-11-14T10:00:05Z'))
    expect(entry.message).toBe('2026-11-14T10:00:05Z ERROR tsc failed')
  })

  it('does not promote ordinary prose to ERROR/WARN', () => {
    expect(detectLogLevel('✓ error handling test passed')).toBe('INFO')
    expect(detectLogLevel('found 0 errors, 0 warnings')).toBe('INFO')
    expect(detectLogLevel('npm WARN deprecated foo')).toBe('WARN')
    expect(detectLogLevel('error: cannot find module')).toBe('ERROR')
    expect(detectLogLevel('[DEBUG] cache hit')).toBe('DEBUG')
  })

  it('prefers structured level/stage hints from the event', () => {
    const entry = parseLogLine('hello', 0, 1, true, { stageName: 'deploy', level: 'warning' })
    expect(entry.stageIndex).toBe(7)
    expect(entry.level).toBe('WARN')
  })
})

describe('log merging (refresh, reconnect, duplicates)', () => {
  it('appends only new lines from a growing snapshot and keeps old entries', () => {
    const first = mergeLogSnapshot([], ['a', 'b'], 1, false)
    const second = mergeLogSnapshot(first, ['a', 'b', 'c'], 2, true)
    expect(second.map((e) => e.raw)).toEqual(['a', 'b', 'c'])
    expect(second[0]).toBe(first[0])
    expect(second[2].live).toBe(true)
  })

  it('ignores a stale (shorter) snapshot', () => {
    const current = mergeLogSnapshot([], ['a', 'b', 'c'], 1, false)
    expect(mergeLogSnapshot(current, ['a', 'b'], 2, false)).toBe(current)
  })

  it('streamed lines are not duplicated when the REST snapshot catches up', () => {
    const streamed = appendLogEvents([], [{ message: 'one\ntwo', stageName: 'build' }], 1)
    expect(streamed.map((e) => e.raw)).toEqual(['[build.log] one', '[build.log] two'])
    const merged = mergeLogSnapshot(streamed, ['[build.log] one', '[build.log] two'], 2, true)
    expect(merged).toBe(streamed)
    const grown = mergeLogSnapshot(streamed, ['[build.log] one', '[build.log] two', '[build.log] three'], 3, true)
    expect(grown.map((e) => e.raw)).toEqual(['[build.log] one', '[build.log] two', '[build.log] three'])
  })

  it('while streaming, a lagging differently-shaped snapshot does not drop streamed lines', () => {
    const streamed = appendLogEvents([], [{ message: 'x' }, { message: 'y' }], 1)
    expect(mergeLogSnapshot(streamed, ['other'], 2, true, true)).toBe(streamed)
  })
})

describe('log stage resolution and filtering', () => {
  const stages = buildStageViews(
    [
      step(0, 'success', { startedAt: '2026-11-14T10:00:00Z', endedAt: '2026-11-14T10:00:10Z' }),
      step(1, 'running', { startedAt: '2026-11-14T10:00:10Z' }),
    ],
    'running',
  )
  const now = Date.parse('2026-11-14T10:00:20Z')

  it('assigns untagged lines only by real timestamps', () => {
    const live = parseLogLine('downloading', 0, Date.parse('2026-11-14T10:00:15Z'), true)
    const history = parseLogLine('downloading', 1, now, false)
    const stamped = parseLogLine('2026-11-14T10:00:05Z cloning', 2, now, false)
    expect(resolveLogStage(live, stages, now)).toBe(1)
    expect(resolveLogStage(history, stages, now)).toBeNull()
    expect(resolveLogStage(stamped, stages, now)).toBe(0)
  })

  it('filters by stage, level and text', () => {
    const entries = [
      { ...parseLogLine('[clone.log] ok', 0, 1, false), resolvedStage: 0 },
      { ...parseLogLine('[build.log] ERROR bad', 1, 1, false), resolvedStage: 6 },
      { ...parseLogLine('plain', 2, 1, false), resolvedStage: null },
    ]
    const all = new Set(LOG_LEVELS)
    expect(filterLogEntries(entries, { stage: 6, levels: all })).toHaveLength(1)
    expect(filterLogEntries(entries, { stage: 'general', levels: all })[0].raw).toBe('plain')
    expect(filterLogEntries(entries, { stage: 'all', levels: new Set(['ERROR'] as const) })).toHaveLength(1)
    expect(filterLogEntries(entries, { stage: 'all', levels: all, query: 'OK' })).toHaveLength(1)
  })
})


it('seven successful stages plus a skipped test finish at 8/8', () => {
  const stages = buildStageViews(PIPELINE_STAGES.map((_, i) => step(i, i === 3 ? 'skipped' : 'success')), 'success')
  expect(summarizeProgress(stages)).toMatchObject({completed: 8, total: 8, skipped: 1, failed: 0, percent: 100})
})
