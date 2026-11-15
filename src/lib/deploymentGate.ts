import type { SecuritySeverity, VerdictKind } from '@/lib/api'

// Deployment gate policy (count based):
//   Critical ≥ 1 → 즉시 차단
//   High ≥ 2     → 즉시 차단
//   High = 1     → 승인 필요
//   Medium ≥ 2   → 승인 필요
//   Medium = 1   → 경고(통과)
//   Low ≥ 1      → 경고(통과)
//   없음          → 통과
// The first matching rule (top to bottom) decides the verdict.

export type GateCounts = Record<SecuritySeverity, number>

export type GateRuleId =
  | 'critical'
  | 'high-many'
  | 'high-one'
  | 'medium-many'
  | 'medium-one'
  | 'low'
  | 'none'

export type GateRule = {
  id: GateRuleId
  color: string
  label: string
  verdict: VerdictKind
  matches: (c: GateCounts) => boolean
}

export const GATE_RULES: GateRule[] = [
  { id: 'critical', color: '#EF4444', label: 'Critical ≥ 1', verdict: 'block', matches: (c) => c.critical >= 1 },
  { id: 'high-many', color: '#F97316', label: 'High ≥ 2', verdict: 'block', matches: (c) => c.high >= 2 },
  { id: 'high-one', color: '#F97316', label: 'High = 1', verdict: 'block_pending_approval', matches: (c) => c.high === 1 },
  {
    id: 'medium-many',
    color: '#EAB308',
    label: 'Medium ≥ 2',
    verdict: 'block_pending_approval',
    matches: (c) => c.medium >= 2,
  },
  { id: 'medium-one', color: '#EAB308', label: 'Medium = 1', verdict: 'warn', matches: (c) => c.medium === 1 },
  { id: 'low', color: '#22C55E', label: 'Low ≥ 1', verdict: 'warn', matches: (c) => c.low >= 1 },
  { id: 'none', color: '#9CA3AF', label: '없음', verdict: 'pass', matches: () => true },
]

export function matchGateRule(counts: GateCounts): GateRule {
  return GATE_RULES.find((rule) => rule.matches(counts)) ?? GATE_RULES[GATE_RULES.length - 1]
}

const VERDICT_RANK: Record<VerdictKind, number> = {
  pass: 0,
  warn: 1,
  block_pending_approval: 2,
  block: 3,
}

// The backend may block for reasons the counts do not show (e.g. a P0 secret),
// so the count rule can only make the verdict stricter, never looser.
export function stricterVerdict(a: VerdictKind | null, b: VerdictKind | null): VerdictKind | null {
  if (!a) return b
  if (!b) return a
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b
}

// Severities whose findings put the result into "승인 필요" — these are the
// items listed in the approval dialog.
export function approvalSeverities(counts: GateCounts): SecuritySeverity[] {
  const out: SecuritySeverity[] = []
  if (counts.high === 1) out.push('high')
  if (counts.medium >= 2) out.push('medium')
  return out
}
