import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CodeXml,
  Copy,
  Download,
  FileClock,
  FileText,
  GitCommitHorizontal,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartOptions } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import {
  computeSecurityScore,
  fetchJobDetail,
  fetchJobResult,
  type JobDetail,
  type JobResult,
  type JobVerdict,
  type JobVerdictDetail,
  type SecurityFinding,
  type SecuritySeverity,
  type VerdictKind,
} from '@/lib/api'
import { securityCheckCatalog } from '@/data/securityCatalog'

ChartJS.register(ArcElement, Tooltip, Legend)

type LocationState = {
  jobId?: string
  repoName?: string
  branch?: string
}

type SeverityLabel = 'Critical' | 'High' | 'Medium' | 'Low'

const severityOrder: { key: SecuritySeverity; label: SeverityLabel }[] = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
]

const severityColors: Record<SeverityLabel, string> = {
  Critical: '#EF4444',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#22C55E',
}

// Fixed severity badge colors (PART 3 절대 원칙):
// Critical 🔴 / High 🟠 / Medium 🟡 / Low 🟢. Kept in lockstep with
// severityColors so the dot, doughnut and pill never disagree.
const severityBadgeClassMap: Record<SecuritySeverity, string> = {
  critical: 'border-[#EF4444] bg-[#EF4444] text-white',
  high: 'border-[#F97316] bg-[#F97316] text-white',
  medium: 'border-[#CA8A04] bg-[#CA8A04] text-white',
  low: 'border-[#16A34A] bg-[#16A34A] text-white',
}

// B-1: the 4-state verdict presentation. icon/label/message are fixed per
// verdict; the accent color prefers the backend's gauge_color (B-0 — use
// directly) and only falls back to these when absent.
const VERDICT_CONFIG: Record<
  VerdictKind,
  { label: string; message: string; color: string; tone: 'pass' | 'warn' | 'approve' | 'block'; icon: typeof CheckCircle2 }
> = {
  pass: { label: '통과', message: '배포 가능', color: '#22C55E', tone: 'pass', icon: CheckCircle2 },
  warn: { label: '경고', message: '경고 — 배포는 가능', color: '#EAB308', tone: 'warn', icon: AlertTriangle },
  block_pending_approval: {
    label: '승인 필요',
    message: '차단 — 승인 시 배포 가능',
    color: '#F97316',
    tone: 'approve',
    icon: ShieldAlert,
  },
  block: { label: '차단', message: '배포 차단 — 코드 수정 필요', color: '#EF4444', tone: 'block', icon: Ban },
}

// B-2: the deployment gate hierarchy. Each row maps to a verdict so we can
// highlight the row the current verdict landed on ("← 현재 여기").
const GATE_ROWS: { color: string; label: string; action: string; match: VerdictKind }[] = [
  { color: '#EF4444', label: 'Critical ≥ 1', action: '즉시 차단', match: 'block' },
  { color: '#F97316', label: 'High ≥ 1', action: '승인 필요', match: 'block_pending_approval' },
  { color: '#EAB308', label: 'Medium ≥ 1', action: '경고(통과)', match: 'warn' },
  { color: '#22C55E', label: 'Low / 없음', action: '통과', match: 'pass' },
]

const toneBannerClass: Record<'pass' | 'warn' | 'approve' | 'block', string> = {
  pass: 'border-[#3ECF8E] bg-[#065F46]/30',
  warn: 'border-[#D97706] bg-[#78350F]/30',
  approve: 'border-[#EA580C] bg-[#7C2D12]/30',
  block: 'border-[#DC2626] bg-[#7F1D1D]/30',
}
const toneTitleClass: Record<'pass' | 'warn' | 'approve' | 'block', string> = {
  pass: 'text-[#A7F3D0]',
  warn: 'text-[#FCD34D]',
  approve: 'text-[#FDBA74]',
  block: 'text-[#FCA5A5]',
}
const toneMsgClass: Record<'pass' | 'warn' | 'approve' | 'block', string> = {
  pass: 'text-[#D1FAE5]',
  warn: 'text-[#FDE68A]',
  approve: 'text-[#FED7AA]',
  block: 'text-[#FECACA]',
}

// Light-mode counterparts. The dark tone classes use a translucent dark tint
// (`bg-...#.../30`) + pale text — over a light card that tint reads as a faint
// pastel and the pale text washes out (unreadable). In light mode we instead
// use solid pastel-100 backgrounds with saturated 700/800 text for contrast.
const toneBannerClassLight: Record<'pass' | 'warn' | 'approve' | 'block', string> = {
  pass: 'border-[#86EFAC] bg-[#DCFCE7]',
  warn: 'border-[#FCD34D] bg-[#FEF9C3]',
  approve: 'border-[#FDBA74] bg-[#FFEDD5]',
  block: 'border-[#FCA5A5] bg-[#FEE2E2]',
}
const toneTitleClassLight: Record<'pass' | 'warn' | 'approve' | 'block', string> = {
  pass: 'text-[#166534]',
  warn: 'text-[#854D0E]',
  approve: 'text-[#9A3412]',
  block: 'text-[#991B1B]',
}
const toneMsgClassLight: Record<'pass' | 'warn' | 'approve' | 'block', string> = {
  pass: 'text-[#15803D]',
  warn: 'text-[#A16207]',
  approve: 'text-[#C2410C]',
  block: 'text-[#B91C1C]',
}

const scoreChartOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  rotation: 270,
  circumference: 180,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
}

const severityChartOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '0%',
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: true,
      backgroundColor: '#111111',
      borderColor: '#404040',
      borderWidth: 1,
      padding: 10,
      bodyColor: '#F3F4F6',
      titleColor: '#F3F4F6',
    },
  },
}

// Legacy 3-state verdict → 4-state verdict, so the new gate UI still renders
// when the backend only returns the old summary (passed/warning/failed).
function legacyToVerdictKind(v: JobVerdict | null, jobStatus: JobDetail['status'] | null): VerdictKind | null {
  if (v === 'passed') return 'pass'
  if (v === 'warning') return 'warn'
  if (v === 'failed') return 'block'
  if (jobStatus === 'success') return 'pass'
  if (jobStatus === 'failed') return 'block'
  return null
}

// Copy helper that works both on the web (secure context → navigator.clipboard)
// and in the packaged Electron app, which serves over `file:` where
// navigator.clipboard is unavailable — there we fall back to the legacy
// execCommand('copy') via a throwaway textarea.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// selected_items 매칭용 정규화. 백엔드가 catalog key("sql-injection"),
// 표시명("SQL Injection"), CWE id("CWE-89"), 숫자("89") 등 어떤 형식으로 echo해도
// 매칭되도록 영숫자만 남겨 비교한다.
function normToken(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}
// CWE 통일 키: 어떤 형식이든 숫자만 뽑아 "cwe89" 형태로.
function cweKey(s: string): string {
  const m = String(s ?? '').match(/(\d{1,6})/)
  return m ? `cwe${m[1]}` : ''
}

// Title = a short one-line summary; the full text lives in the 설명 block. Many
// scanner messages pack the summary into the first sentence, so take that and
// cap the length.
function shortSummary(text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return ''
  const firstSentence = trimmed.match(/^.*?[.!?](?:\s|$)/)
  let s = (firstSentence ? firstSentence[0] : trimmed).trim()
  if (s.length > 80) s = `${s.slice(0, 77).trimEnd()}…`
  return s
}

export function PipelineProgressPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { resolvedTheme } = useTheme()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState
  const jobId = locationState.jobId ?? ''

  const [result, setResult] = useState<JobResult | null>(null)
  const [detail, setDetail] = useState<JobDetail | null>(null)
  // Lazy-init so we don't synchronously toggle loading inside the effect when
  // there's nothing to fetch (jobId/token are stable for this page's life).
  const [isLoading, setIsLoading] = useState(() => !!(jobId && token))
  const [error, setError] = useState<string | null>(null)
  // Which copy affordance most recently succeeded — keyed by `${id}:code|ai`,
  // shown as "복사됨" briefly.
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function handleCopy(key: string, text: string) {
    const ok = await copyToClipboard(text)
    if (!ok) return
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500)
  }

  useEffect(() => {
    if (!jobId || !token) return
    let cancelled = false

    Promise.allSettled([
      fetchJobDetail(token, jobId),
      fetchJobResult(token, jobId),
    ]).then(([detailRes, resultRes]) => {
      if (cancelled) return

      if (detailRes.status === 'fulfilled') setDetail(detailRes.value)
      else console.error('[result] job detail failed:', detailRes.reason)

      if (resultRes.status === 'fulfilled') setResult(resultRes.value)
      else console.error('[result] job result failed:', resultRes.reason)

      if (
        detailRes.status === 'rejected' &&
        (resultRes.status === 'rejected' || resultRes.value === null)
      ) {
        setError(
          detailRes.reason instanceof Error
            ? detailRes.reason.message
            : '분석 결과를 불러오지 못했습니다.',
        )
      }
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [jobId, token])

  const repoName = result?.repoName || detail?.repoName || locationState.repoName || ''
  const branch = result?.branch || detail?.branch || locationState.branch || ''
  const repoUrl = result?.repoUrl || detail?.repoUrl || ''
  const jobStatus = detail?.status ?? null

  // The rich gate verdict (new model). null => legacy/summary-only payload.
  const vd: JobVerdictDetail | null = result?.verdictDetail ?? null

  // Backend score (B-0: prefer as-is). gauge_color too. The final `score` is
  // reconciled against the in-scope findings just below — a perfect 100 while
  // findings exist means the backend score is empty-derived (same root cause as
  // the all-zero counts), so we recompute the deduction there.
  const rawScore = vd?.score ?? result?.securityScore ?? detail?.securityScore ?? null
  const gaugeColor = vd?.gaugeColor || '#F97316'

  // B-0 counts (in-scope). The backend's verdict counts are authoritative, but
  // `vd.counts` is sometimes present-yet-all-zero (field-name mismatch or not
  // populated) even when findings exist — a plain `??` would keep those zeros
  // and the chart would read 0 despite detected vulnerabilities. So: trust
  // vd.counts only when it has a non-zero total, else derive from the in-scope
  // findings themselves ("검사 범위 기준" ground truth), then fall back to the
  // aggregate summaries.
  const counts: Record<SecuritySeverity, number> = useMemo(() => {
    const sumOf = (c: Record<SecuritySeverity, number>) =>
      c.critical + c.high + c.medium + c.low
    if (vd?.counts && sumOf(vd.counts) > 0) return vd.counts
    const inScope = (result?.findings ?? []).filter((f) => f.inScope)
    if (inScope.length > 0) {
      return inScope.reduce<Record<SecuritySeverity, number>>(
        (acc, f) => {
          acc[f.severity] += 1
          return acc
        },
        { critical: 0, high: 0, medium: 0, low: 0 },
      )
    }
    return (
      vd?.counts ??
      result?.severitySummary ??
      detail?.severityCounts ?? { critical: 0, high: 0, medium: 0, low: 0 }
    )
  }, [vd, result, detail])
  const totalCount = useMemo(
    () => severityOrder.reduce((sum, { key }) => sum + (counts[key] ?? 0), 0),
    [counts],
  )

  // Reconcile the score with the in-scope findings. A backend score that is
  // null, or a suspiciously perfect 100 while in-scope findings exist (empty-
  // derived — the same defect that zeroed the counts), is recomputed from the
  // same counts the chart shows so the gauge actually reflects the deduction.
  const score =
    (rawScore == null || rawScore === 100) && totalCount > 0
      ? computeSecurityScore(counts)
      : rawScore
  const scoreLabel = vd?.scoreLabel || (score != null ? `${score}/100` : null)

  // Effective verdict — prefer the rich model, else map the legacy verdict.
  const effectiveVerdict: VerdictKind | null =
    vd?.verdict ?? legacyToVerdictKind(result?.verdict ?? detail?.verdict ?? null, jobStatus)
  const verdictCfg = effectiveVerdict ? VERDICT_CONFIG[effectiveVerdict] : null
  // Theme-aware gate-banner classes: the dark tints/pale text wash out on the
  // light card, so swap to the light palette when the resolved theme is light.
  const isLight = resolvedTheme === 'light'
  const bannerBgClass = verdictCfg
    ? (isLight ? toneBannerClassLight : toneBannerClass)[verdictCfg.tone]
    : ''
  const bannerTitleClass = verdictCfg
    ? (isLight ? toneTitleClassLight : toneTitleClass)[verdictCfg.tone]
    : ''
  const bannerMsgClass = verdictCfg
    ? (isLight ? toneMsgClassLight : toneMsgClass)[verdictCfg.tone]
    : ''
  // Banner accent: use gauge_color directly when present (B-0).
  const accent = vd?.gaugeColor || verdictCfg?.color || '#F97316'

  const allFindings: SecurityFinding[] = useMemo(() => result?.findings ?? [], [result])
  const inScopeFindings = useMemo(() => allFindings.filter((f) => f.inScope), [allFindings])
  const outOfScopeFindings = useMemo(() => allFindings.filter((f) => !f.inScope), [allFindings])
  // out_of_scope_count: prefer the backend value, else count locally.
  const outOfScopeCount = vd?.outOfScopeCount ?? outOfScopeFindings.length

  const scoreChartData = useMemo(
    () => ({
      labels: ['보안 점수', '남은 점수'],
      datasets: [
        {
          data: [score ?? 0, 100 - (score ?? 0)],
          backgroundColor: [gaugeColor, '#404040'],
          borderWidth: 0,
          hoverOffset: 0,
        },
      ],
    }),
    [score, gaugeColor],
  )

  const severityChartData = useMemo(
    () => ({
      labels: severityOrder.map((s) => s.label),
      datasets: [
        {
          data: severityOrder.map((s) => counts[s.key] ?? 0),
          backgroundColor: severityOrder.map((s) => severityColors[s.label]),
          borderColor: '#1E1E1E',
          borderWidth: 2,
        },
      ],
    }),
    [counts],
  )

  // 검사 범위 밖(정책 미선택) findings를 등급별로 집계 — 두 번째 도넛용.
  const outScopeCounts = useMemo(
    () =>
      outOfScopeFindings.reduce<Record<SecuritySeverity, number>>(
        (acc, f) => {
          acc[f.severity] += 1
          return acc
        },
        { critical: 0, high: 0, medium: 0, low: 0 },
      ),
    [outOfScopeFindings],
  )
  const outScopeTotal = useMemo(
    () => severityOrder.reduce((sum, { key }) => sum + (outScopeCounts[key] ?? 0), 0),
    [outScopeCounts],
  )
  const outScopeChartData = useMemo(
    () => ({
      labels: severityOrder.map((s) => s.label),
      datasets: [
        {
          data: severityOrder.map((s) => outScopeCounts[s.key] ?? 0),
          backgroundColor: severityOrder.map((s) => severityColors[s.label]),
          borderColor: '#1E1E1E',
          borderWidth: 2,
        },
      ],
    }),
    [outScopeCounts],
  )

  // selected_items → mark each of the 16 catalog items as 검사/미검사.
  // selected_items가 catalog key("sql-injection")로 올 수도, 백엔드가 변환한
  // CWE id("CWE-89")로 올 수도 있어 둘 다 소문자로 정규화해 담는다.
  const selectedTokens = useMemo(() => {
    const set = new Set<string>()
    for (const raw of vd?.selectedItems ?? []) {
      const n = normToken(raw)
      if (n) set.add(n)
      const c = cweKey(raw)
      if (c) set.add(c)
    }
    return set
  }, [vd])
  const isItemSelected = (item: { id: string; cwe: string; title: string }) =>
    [normToken(item.id), normToken(item.cwe), cweKey(item.cwe), normToken(item.title)].some(
      (t) => t && selectedTokens.has(t),
    )
  const selectedCatalogCount = securityCheckCatalog.filter(isItemSelected).length

  function scrollToOutOfScope() {
    document.getElementById('out-of-scope-section')?.scrollIntoView({ behavior: 'smooth' })
  }

  function githubLineUrl(f: SecurityFinding): string | null {
    if (!repoUrl || !f.filePath) return null
    const ref = vd?.scannedCommitSha || branch || 'HEAD'
    const base = repoUrl.replace(/\.git$/, '').replace(/\/$/, '')
    return `${base}/blob/${ref}/${f.filePath}${f.lineNumber ? `#L${f.lineNumber}` : ''}`
  }

  // One severity breakdown row (도넛 + 범례 + total). Reused by the in-scope and
  // out-of-scope halves of the 등급별 취약점 card.
  function renderSeverityBreakdown(
    chartData: typeof severityChartData,
    breakdownCounts: Record<SecuritySeverity, number>,
    total: number,
    emptyText: string,
  ) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-6">
        {total > 0 ? (
          <div className="flex h-36 w-36 items-center justify-center">
            <Doughnut data={chartData} options={severityChartOptions} />
          </div>
        ) : (
          <div className="flex h-36 w-36 items-center justify-center text-center text-[12px] text-[#6B7280]">
            {emptyText}
          </div>
        )}
        <div className="flex-1 self-center space-y-2">
          {severityOrder.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between text-[12px] text-[#D1D5DB]">
              <p className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: severityColors[label] }} />
                {label}
              </p>
              <span>{breakdownCounts[key] ?? 0}</span>
            </div>
          ))}
          <div className="pt-1 text-[12px] text-[#A3A3A3]">total {total.toLocaleString()}</div>
        </div>
      </div>
    )
  }

  if (!jobId) {
    return (
      <MainLayout>
        <Card className="p-6 text-center text-[#FCA5A5]">
          job_id가 전달되지 않았습니다. 파이프라인을 다시 실행해 주세요.
        </Card>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => navigate('/pipeline/new')}>새 파이프라인</Button>
        </div>
      </MainLayout>
    )
  }

  if (isLoading) {
    return (
      <MainLayout>
        <Card className="flex items-center justify-center gap-3 p-10 text-[#9CA3AF]">
          <Loader2 className="h-5 w-5 animate-spin text-[#34D399]" />
          분석 결과를 불러오는 중...
        </Card>
      </MainLayout>
    )
  }

  if (error && !detail && !result) {
    return (
      <MainLayout>
        <Card className="border-[#7F1D1D] bg-[#450A0A]/40 p-6 text-center text-[#FCA5A5]">
          {error}
        </Card>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/pipeline/progress', { state: { jobId, repoName, branch } })}
          >
            파이프라인 보기
          </Button>
          <Button onClick={() => navigate('/dashboard')}>대시보드로</Button>
        </div>
      </MainLayout>
    )
  }

  // The gate row the verdict landed on (for the "← 현재 여기" highlight).
  const activeRowVerdict: VerdictKind =
    effectiveVerdict ??
    (counts.critical > 0 ? 'block' : counts.high > 0 ? 'block_pending_approval' : counts.medium > 0 ? 'warn' : 'pass')

  const reasons =
    effectiveVerdict === 'warn'
      ? vd?.warnReasons ?? []
      : effectiveVerdict === 'block' || effectiveVerdict === 'block_pending_approval'
        ? vd?.blockReasons ?? []
        : []

  const renderFinding = (item: SecurityFinding) => {
    const cwe = item.cwe || item.cve
    const location = item.filePath
      ? `${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ''}${
          item.columnNumber ? `:${item.columnNumber}` : ''
        }`
      : null
    const url = githubLineUrl(item)
    const cvssText =
      item.cvssScore != null ? `CVSS ${item.cvssScore}` : item.cvss ? `CVSS ${item.cvss}` : null
    // 제목/설명 분리: 설명(긴 본문)은 description, 없으면 title을 사용하고,
    // 제목은 그 본문을 한 줄로 요약. 백엔드가 별도의 짧은 title을 주면 그대로.
    const fullText = item.description || item.title || ''
    const hasDistinctTitle =
      !!item.title && item.title !== item.description && item.title.length <= 80
    const titleText = hasDistinctTitle ? item.title : shortSummary(fullText)
    const codeCopyKey = `${item.id}:code`
    const aiCopyKey = `${item.id}:ai`
    return (
      <div
        key={item.id}
        className={`rounded-xl border border-[#404040] bg-[#1E1E1E] p-4 ${item.inScope ? '' : 'opacity-70'}`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold uppercase ${severityBadgeClassMap[item.severity]}`}
          >
            {item.severity}
          </span>
          {/* 항목명 + CWE 태그. policy_item == null 이면 "16항목 외" */}
          <span className="text-[14px] font-semibold text-white">
            {item.policyItem || '16항목 외'}
          </span>
          {cwe ? (
            <span className="rounded-full border border-[#404040] px-2 py-0.5 text-[11px] text-[#9CA3AF]">
              {cwe}
            </span>
          ) : null}
          {!item.inScope ? (
            <span className="rounded-full border border-[#6B7280] px-2 py-0.5 text-[11px] text-[#9CA3AF]">
              미검사
            </span>
          ) : null}
        </div>

        <p className="text-[20px] font-bold text-white">{titleText}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {location ? (
            url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#34D399] underline-offset-2 hover:underline"
              >
                {location}
              </a>
            ) : (
              <span className="text-[12px] text-[#34D399]">{location}</span>
            )
          ) : null}
          {cvssText ? <span className="text-[12px] text-[#808080]">{cvssText}</span> : null}
        </div>

        {item.codeSnippet ? (
          <div className="relative mt-3">
            <button
              type="button"
              onClick={() => handleCopy(codeCopyKey, item.codeSnippet ?? '')}
              title="코드 복사"
              className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-[#404040] bg-[#1E1E1E] px-2 py-0.5 text-[11px] text-[#9CA3AF] transition-colors hover:text-white"
            >
              {copiedKey === codeCopyKey ? (
                <>
                  <Check className="h-3 w-3" /> 복사됨
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> 복사
                </>
              )}
            </button>
            <pre className="overflow-x-auto rounded-md border border-[#404040] bg-[#0F0F0F] p-3 pr-20 text-[12px] text-[#D1D5DB]">
              <code className="font-mono">{item.codeSnippet}</code>
            </pre>
          </div>
        ) : null}

        {fullText ? (
          <div className="mt-3">
            <p className="text-[12px] font-semibold text-[#D1D5DB]">설명</p>
            <p className="mt-1 text-[12px] text-[#A3A3A3]">{fullText}</p>
          </div>
        ) : null}

        {item.aiSuggestion ? (
          <details className="mt-3 rounded-lg border border-[#3ECF8E] bg-[#065F46] p-3">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-[14px] font-semibold text-[#D1FAE5]">
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" /> AI 수정 제안
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault()
                  handleCopy(aiCopyKey, item.aiSuggestion)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleCopy(aiCopyKey, item.aiSuggestion)
                  }
                }}
                title="제안 복사"
                className="inline-flex items-center gap-1 rounded-md border border-[#3ECF8E]/60 px-2 py-0.5 text-[11px] font-normal text-[#A7F3D0] transition-colors hover:bg-[#047857] hover:text-white"
              >
                {copiedKey === aiCopyKey ? (
                  <>
                    <Check className="h-3 w-3" /> 복사됨
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> 복사
                  </>
                )}
              </span>
            </summary>
            <p className="mt-2 text-[14px] text-[#D1FAE5]">{item.aiSuggestion}</p>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[18px] font-bold text-white">보안 분석 결과</p>
            <p className="mt-2 flex items-center gap-2 text-[28px] font-bold leading-none text-white">
              <CodeXml className="h-7 w-7 text-[#34D399]" /> {repoName || jobId}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-[#6B7280]">
              <span>브랜치 {branch || '-'}</span>
              {vd?.scannedCommitSha ? (
                <span className="inline-flex items-center gap-1">
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                  스캔 커밋: {vd.scannedCommitSha.slice(0, 12)}
                </span>
              ) : null}
              <span>| ID: {jobId}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/approvals')}
              className="h-9 border-[#404040] bg-transparent px-3 text-xs text-[#D1D5DB] hover:bg-[#262626]"
            >
              <FileClock className="mr-1.5 h-3.5 w-3.5" />
              감사 로그
            </Button>
            <Button
              type="button"
              className="h-9 border border-[#34D399] bg-[#34D399] px-3 text-xs font-semibold text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              결과 다운로드
            </Button>
          </div>
        </div>

        {/* B-4: commit mismatch warning */}
        {vd?.commitMismatch ? (
          <div className="rounded-xl border border-[#D97706] bg-[#78350F]/30 p-3">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-[#FCD34D]">
              <AlertTriangle className="h-4 w-4" /> 스캔 커밋 불일치
            </p>
            <p className="mt-1 text-[12px] text-[#FDE68A]">
              요청 커밋을 가져오지 못해 브랜치 HEAD를 스캔했습니다 (force-push/rebase 추정).
              {vd.requestedCommitSha ? ` 요청: ${vd.requestedCommitSha.slice(0, 12)}` : ''}
            </p>
          </div>
        ) : null}

        {/* B-2: deployment gate card (priority over score) */}
        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[16px] font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-[#34D399]" /> 배포 게이트
            </p>
            {verdictCfg ? (
              <span className="inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: accent }}>
                현재 판정:
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
                  {verdictCfg.label}
                </span>
              </span>
            ) : null}
          </div>

          {/* B-1: verdict main message + reasons + approval CTA */}
          {verdictCfg ? (
            <div className={`mt-3 rounded-xl border p-3 ${bannerBgClass}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`flex items-center gap-2 text-[15px] font-semibold ${bannerTitleClass}`}>
                    <verdictCfg.icon className="h-4.5 w-4.5" />
                    {verdictCfg.message}
                  </p>
                  {reasons.length > 0 ? (
                    <ul className={`mt-2 list-disc space-y-1 pl-5 text-[12px] ${bannerMsgClass}`}>
                      {reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                  {effectiveVerdict === 'block' ? (
                    <p className={`mt-2 text-[12px] ${bannerMsgClass}`}>
                      하드 차단입니다. 승인으로 통과할 수 없으니 코드를 수정한 뒤 다시 실행하세요.
                    </p>
                  ) : null}
                </div>
                {/* Approval path exists only for block_pending_approval. block hides it. */}
                {vd?.requiresApproval && effectiveVerdict === 'block_pending_approval' ? (
                  <Button
                    type="button"
                    onClick={() => navigate('/pipeline/approval', { state: { jobId, repoName, branch } })}
                    className="h-8 shrink-0 bg-[#EA580C] px-3 text-xs text-white shadow-none hover:bg-[#C2410C]"
                  >
                    승인 요청
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Gate hierarchy with current position highlighted */}
          <div className="mt-3 space-y-1.5">
            {GATE_ROWS.map((row) => {
              const active = row.match === activeRowVerdict
              return (
                <div
                  key={row.match}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px] ${
                    active ? 'border-[#5B5B5B] bg-[#1E1E1E]' : 'border-transparent'
                  }`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className={active ? 'font-semibold text-white' : 'text-[#9CA3AF]'}>{row.label}</span>
                  <span className="text-[#6B7280]">→</span>
                  <span className={active ? 'font-semibold text-white' : 'text-[#9CA3AF]'}>{row.action}</span>
                  {active ? <span className="ml-auto text-[12px] text-[#34D399]">← 현재 여기</span> : null}
                </div>
              )
            })}
          </div>
        </Card>

        {/* B-3: out_of_scope banner (필수 — 누락 금지) */}
        {outOfScopeCount > 0 ? (
          <div className="rounded-xl border border-[#404040] bg-[#1E1E1E] p-4">
            <p className="text-[13px] font-semibold text-[#D1D5DB]">
              검사 범위 밖에서 취약점 {outOfScopeCount}건이 추가로 발견되었습니다.
            </p>
            <p className="mt-1 text-[12px] text-[#9CA3AF]">
              배포 판정은 선택한 {vd?.selectedCount ?? selectedCatalogCount}개 항목만 기준입니다. 이{' '}
              {outOfScopeCount}건은 판정에 포함되지 않았을 뿐, "안전"을 뜻하지는 않습니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={scrollToOutOfScope}
                className="h-8 border-[#404040] bg-transparent px-3 text-xs text-[#D1D5DB] hover:bg-[#262626]"
              >
                추가 발견 항목 보기
              </Button>
              <Button
                type="button"
                onClick={() => navigate('/pipeline/new')}
                className="h-8 bg-[#34D399] px-3 text-xs text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
              >
                전체 16개로 다시 검사
              </Button>
            </div>
          </div>
        ) : null}

        {/* B-5: acknowledged_cwes badge */}
        {vd?.acknowledgedCwes && vd.acknowledgedCwes.length > 0 ? (
          <div className="rounded-xl border border-[#EA580C] bg-[#7C2D12]/30 p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-[#FDBA74]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F97316]" />
              수용된 취약점 포함: {vd.acknowledgedCwes.join(', ')}
            </p>
            <p className="mt-1 text-[12px] text-[#FED7AA]">
              이 항목은 책임자 승인 하에 게이트를 통과했습니다. 점수에는 위험이 그대로 반영되어 있습니다.
            </p>
          </div>
        ) : null}

        {/* Score gauge (보조 지표) + severity counts */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="mb-3 text-[16px] font-semibold text-white">보안 점수</p>
            <div className="relative mx-auto h-30 w-36">
              <Doughnut data={scoreChartData} options={scoreChartOptions} />
              <p
                className="pointer-events-none absolute left-1/2 top-[72%] -translate-x-1/2 -translate-y-1/2 text-[44px] font-bold leading-none"
                style={{ color: gaugeColor }}
              >
                {score ?? '-'}
              </p>
              <p className="pointer-events-none absolute left-1/2 top-[98%] -translate-x-1/2 -translate-y-1/2 text-[12px] text-[#9CA3AF]">
                {scoreLabel ?? '/ 100'}
              </p>
            </div>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">코드 품질 점수</p>
              <p className="text-[24px] font-bold leading-none text-white">
                {score ?? '-'}
                <span className="text-[24px]">/100</span>
              </p>
            </div>
            {/* score_breakdown (감점 내역 — 항상 펼침) */}
            {vd?.scoreBreakdown &&
            severityOrder.some(({ key }) => (vd.scoreBreakdown[key] ?? 0) > 0) ? (
              <div className="mt-2 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
                <p className="text-[12px] text-[#9CA3AF]">감점 내역</p>
                <div className="mt-2 space-y-1">
                  {severityOrder.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between text-[12px] text-[#D1D5DB]">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityColors[label] }} />
                        {label}
                      </span>
                      <span className="text-[#FCA5A5]">-{vd.scoreBreakdown[key] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="mb-1 text-[16px] font-semibold text-white">등급별 취약점</p>
            {/* 위: 검사 범위 기준(in-scope) / 아래: 검사 범위 밖(out-of-scope) */}
            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-[#34D399]">
              <span className="h-2 w-2 rounded-full bg-[#34D399]" /> 검사 범위 기준
            </div>
            {renderSeverityBreakdown(severityChartData, counts, totalCount, '탐지된 취약점 없음')}

            <div className="my-3 border-t border-dashed border-[#404040]" />

            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#9CA3AF]" /> 검사 범위 밖 기준
              <span className="text-[11px] text-[#6B7280]">(정책 미선택 — 게이트 영향 없음)</span>
            </div>
            {renderSeverityBreakdown(
              outScopeChartData,
              outScopeCounts,
              outScopeTotal,
              '범위 밖 취약점 없음',
            )}
          </Card>
        </div>

        {/* selected_items 목록 (검사/미검사 구분, 접기) */}
        {vd && vd.selectedItems.length >= 0 ? (
          <details className="rounded-xl border border-[#404040] bg-[#262626] p-4">
            <summary className="cursor-pointer text-[14px] font-semibold text-white">
              검사 항목 ({selectedCatalogCount}/{securityCheckCatalog.length})
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {securityCheckCatalog.map((c) => {
                const checked = isItemSelected(c)
                return (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between rounded-md border border-[#404040] px-3 py-2 text-[12px] ${
                      checked ? 'bg-[#1E1E1E] text-[#D1D5DB]' : 'bg-transparent text-[#6B7280]'
                    }`}
                  >
                    <span>
                      {c.title} <span className="text-[#6B7280]">{c.cwe}</span>
                    </span>
                    <span className={checked ? 'text-[#34D399]' : 'text-[#6B7280]'}>
                      {checked ? '검사' : '미검사'}
                    </span>
                  </div>
                )
              })}
            </div>
          </details>
        ) : null}

        {/* B-6: in-scope findings */}
        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="mb-3 flex items-center gap-2 text-[16px] font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-[#34D399]" /> 탐지된 취약점
            {inScopeFindings.length > 0 ? (
              <span className="text-[12px] font-normal text-[#6B7280]">({inScopeFindings.length})</span>
            ) : null}
          </p>

          {inScopeFindings.length === 0 ? (
            <div className="rounded-xl border border-[#404040] bg-[#1E1E1E] p-6 text-center text-[12px] text-[#6B7280]">
              {result === null
                ? '상세 취약점 데이터를 아직 불러올 수 없습니다. (백엔드 결과 준비 대기 중)'
                : '검사 범위 내에서 탐지된 취약점이 없습니다.'}
            </div>
          ) : (
            <div className="space-y-3">{inScopeFindings.map(renderFinding)}</div>
          )}
        </Card>

        {/* B-6: out-of-scope findings (별도 섹션, 게이트 영향 없음) */}
        {outOfScopeFindings.length > 0 ? (
          <Card id="out-of-scope-section" className="border-[#404040] bg-[#262626] p-4">
            <p className="mb-1 flex items-center gap-2 text-[16px] font-semibold text-white">
              <ShieldAlert className="h-4 w-4 text-[#9CA3AF]" /> 정책 범위 밖 {outOfScopeFindings.length}건
            </p>
            <p className="mb-3 text-[12px] text-[#9CA3AF]">
              선택한 검사 항목 밖에서 탐지된 항목입니다. 이번 게이트 판정에는 영향을 주지 않습니다.
            </p>
            <div className="space-y-3">{outOfScopeFindings.map(renderFinding)}</div>
          </Card>
        ) : null}
      </section>
    </MainLayout>
  )
}
