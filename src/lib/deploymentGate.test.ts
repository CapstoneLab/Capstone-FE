import { describe, expect, it } from 'vitest'
import { approvalSeverities, matchGateRule, stricterVerdict } from './deploymentGate'

const c = (critical: number, high: number, medium: number, low: number) => ({ critical, high, medium, low })

describe('matchGateRule', () => {
  it.each([
    [c(1, 0, 0, 0), 'critical', 'block'],
    [c(4, 2, 8, 0), 'critical', 'block'],
    [c(0, 2, 0, 0), 'high-many', 'block'],
    [c(0, 1, 0, 0), 'high-one', 'block_pending_approval'],
    [c(0, 1, 5, 3), 'high-one', 'block_pending_approval'],
    [c(0, 0, 2, 0), 'medium-many', 'block_pending_approval'],
    [c(0, 0, 1, 0), 'medium-one', 'warn'],
    [c(0, 0, 1, 7), 'medium-one', 'warn'],
    [c(0, 0, 0, 3), 'low', 'warn'],
    [c(0, 0, 0, 0), 'none', 'pass'],
  ] as const)('%o → %s', (counts, id, verdict) => {
    const rule = matchGateRule(counts)
    expect(rule.id).toBe(id)
    expect(rule.verdict).toBe(verdict)
  })
})

describe('stricterVerdict', () => {
  it('never loosens the backend verdict', () => {
    expect(stricterVerdict('block', 'warn')).toBe('block')
    expect(stricterVerdict('warn', 'block_pending_approval')).toBe('block_pending_approval')
    expect(stricterVerdict('block_pending_approval', 'block')).toBe('block')
    expect(stricterVerdict(null, 'pass')).toBe('pass')
  })
})

describe('approvalSeverities', () => {
  it('lists the severities that require approval', () => {
    expect(approvalSeverities(c(0, 1, 0, 0))).toEqual(['high'])
    expect(approvalSeverities(c(0, 0, 3, 0))).toEqual(['medium'])
    expect(approvalSeverities(c(0, 1, 2, 0))).toEqual(['high', 'medium'])
    expect(approvalSeverities(c(0, 0, 1, 0))).toEqual([])
  })
})
