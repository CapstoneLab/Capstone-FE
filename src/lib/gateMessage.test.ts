import { describe, expect, it } from 'vitest'
import { parseGateMessage } from '@/lib/gateMessage'

describe('parseGateMessage', () => {
  it('parses the backend gate summary line', () => {
    const parsed = parseGateMessage(
      'verdict=BLOCK 6.0/100 (전체 검사 기준) env=production critical=4 high=2 medium=8 low=0 risk=P0 policy=1.3.1 | blocked: Gitleaks Secret 탐지 — P0 보안 보류',
    )
    expect(parsed).toEqual({
      verdict: 'block',
      score: 6,
      scoreLabel: '6.0/100 (전체 검사 기준)',
      env: 'production',
      risk: 'P0',
      policy: '1.3.1',
      counts: { critical: 4, high: 2, medium: 8, low: 0 },
      reasons: ['Gitleaks Secret 탐지 — P0 보안 보류'],
    })
  })

  it('drops the runner log tail from reasons', () => {
    const parsed = parseGateMessage(
      'verdict=BLOCK 6.0/100 critical=4 | blocked: Gitleaks Secret 탐지 — P0 보안 보류 exit code: 1 [security_gate.log] [2026-11-15 19:07:31] [step_exit_code] 1',
    )
    expect(parsed?.reasons).toEqual(['Gitleaks Secret 탐지 — P0 보안 보류'])
  })

  it('splits multiple reasons and ignores other text', () => {
    expect(parseGateMessage('verdict=WARN 70/100 | blocked: A; B')?.reasons).toEqual(['A', 'B'])
    expect(parseGateMessage('npm test exited with code 1')).toBeNull()
  })
})
