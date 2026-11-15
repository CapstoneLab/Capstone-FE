import { describe, expect, it } from 'vitest'
import type { JobDetail, JobStep } from '@/lib/api'
import { applyStepPatch, keepTerminal } from './usePipelineExecution'

function job(status: JobDetail['status'], completedAt: string | null = null): JobDetail {
  return {
    jobId: 'job-1', repoUrl: '', repoName: 'o/r', branch: 'main', triggerSource: 'manual',
    commitSha: '', triggeredBy: '', status, overallResult: null, createdAt: null, startedAt: null,
    completedAt, durationSecs: 0, steps: [], verdict: null, verdictReason: null, totalFindings: 0,
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0 }, summaries: [], securityScore: 0,
  }
}

function step(status: JobStep['status']): JobStep {
  return {
    stepId: 's1', stepName: 'build', stepType: 'build', status,
    errorMessage: null, startedAt: null, endedAt: null, durationSecs: null,
  }
}

describe('keepTerminal', () => {
  it('never moves a finished run back to running', () => {
    const next = keepTerminal(job('success', '2026-11-15T00:00:00Z'), job('running'))
    expect(next.status).toBe('success')
    expect(next.completedAt).toBe('2026-11-15T00:00:00Z')
  })

  it('lets a live run finish and a first load through', () => {
    expect(keepTerminal(job('running'), job('failed')).status).toBe('failed')
    expect(keepTerminal(null, job('running')).status).toBe('running')
  })
})

describe('applyStepPatch', () => {
  it('ignores a replayed start for a finished stage', () => {
    const [patched] = applyStepPatch([step('success')], { stepId: 's1', status: 'running' })
    expect(patched.status).toBe('success')
  })

  it('applies a normal transition', () => {
    const [patched] = applyStepPatch([step('running')], { stepId: 's1', status: 'failed' })
    expect(patched.status).toBe('failed')
  })
})
