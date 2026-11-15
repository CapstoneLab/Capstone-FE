// Parses the security-gate summary line the backend puts in the gate step's
// `error_message`, e.g.
//   verdict=BLOCK 6.0/100 (전체 검사 기준) env=production critical=4 high=2
//   medium=8 low=0 risk=P0 policy=1.3.1 | blocked: Gitleaks Secret 탐지 — P0 보안 보류
// Returns null when the text is not in that format (caller shows it raw).

export type GateSummary = {
  verdict: string | null
  score: number | null
  scoreLabel: string | null
  env: string | null
  risk: string | null
  policy: string | null
  counts: { critical: number; high: number; medium: number; low: number } | null
  reasons: string[]
}

function num(text: string, key: string): number | null {
  const match = text.match(new RegExp(`\\b${key}=(\\d+)`, 'i'))
  return match ? Number(match[1]) : null
}

function word(text: string, key: string): string | null {
  return text.match(new RegExp(`\\b${key}=([^\\s|]+)`, 'i'))?.[1] ?? null
}

// The runner appends log noise after the reason, e.g.
// "… P0 보안 보류 exit code: 1 [security_gate.log] [2026-11-15 19:07:31] [step_exit_code] 1".
function stripLogTail(reason: string): string {
  return reason
    .replace(/\s*\bexit code:?\s*\d+.*$/i, '')
    .replace(/\s*\[[^\]]*\.log\].*$/i, '')
    .replace(/\s*\[step_exit_code\].*$/i, '')
    .trim()
}

export function parseGateMessage(message: string | null | undefined): GateSummary | null {
  const text = message?.replace(/\s+/g, ' ').trim() ?? ''
  if (!/\bverdict=/i.test(text)) return null

  const [head, ...rest] = text.split('|')
  const scoreMatch = head.match(/(\d+(?:\.\d+)?)\s*\/\s*100(\s*\([^)]*\))?/)
  const critical = num(head, 'critical')
  const high = num(head, 'high')
  const medium = num(head, 'medium')
  const low = num(head, 'low')
  const hasCounts = [critical, high, medium, low].some((value) => value !== null)

  const reasonText = rest.join('|').trim()
  const reasons = reasonText
    .replace(/^(blocked|warn(?:ed|ing)?|reasons?)\s*:\s*/i, '')
    .split(/\s*[;|]\s*/)
    .map((reason) => stripLogTail(reason))
    .filter(Boolean)

  return {
    verdict: word(head, 'verdict')?.toLowerCase() ?? null,
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    scoreLabel: scoreMatch ? scoreMatch[0].trim() : null,
    env: word(head, 'env'),
    risk: word(head, 'risk'),
    policy: word(head, 'policy'),
    counts: hasCounts
      ? { critical: critical ?? 0, high: high ?? 0, medium: medium ?? 0, low: low ?? 0 }
      : null,
    reasons,
  }
}
