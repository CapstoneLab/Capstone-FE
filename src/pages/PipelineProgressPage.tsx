import {
  AlertTriangle,
  CheckCircle2,
  CodeXml,
  Download,
  FileText,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartOptions } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchJobDetail,
  fetchJobResult,
  type JobDetail,
  type JobResult,
  type JobVerdict,
  type SecurityFinding,
  type SecuritySeverity,
} from '@/lib/api'

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
  High: '#F87171',
  Medium: '#F97316',
  Low: '#22C55E',
}

const severityBadgeClassMap: Record<SecuritySeverity, string> = {
  critical: 'border-[#EF4444] bg-[#450A0A] text-[#F87171]',
  high: 'border-[#DC2626] bg-[#3B0A0A] text-[#F87171]',
  medium: 'border-[#F97316] bg-[#3A1A05] text-[#FDBA74]',
  low: 'border-[#22C55E] bg-[#052E1B] text-[#86EFAC]',
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

// Verdict → banner appearance. `failed` keeps the original red "파이프라인
// 실패" treatment; `warning` is amber; `passed` is green. When we have no
// verdict at all we fall back to the job's execution status.
function verdictBanner(
  verdict: JobVerdict | null,
  jobStatus: JobDetail['status'] | null,
  reason: string | null,
): {
  tone: 'fail' | 'warn' | 'pass'
  title: string
  message: string
} {
  const effective: JobVerdict | 'unknown' =
    verdict ?? (jobStatus === 'failed' ? 'failed' : jobStatus === 'success' ? 'passed' : 'unknown')

  if (effective === 'failed') {
    return {
      tone: 'fail',
      title: '파이프라인 실패',
      message: reason || '보안 취약점이 발견되어 파이프라인을 종료하였습니다.',
    }
  }
  if (effective === 'warning') {
    return {
      tone: 'warn',
      title: '주의 필요',
      message: reason || '일부 보안 취약점이 발견되었습니다. 검토를 권장합니다.',
    }
  }
  if (effective === 'passed') {
    return {
      tone: 'pass',
      title: '보안 검사 통과',
      message: reason || '심각한 보안 취약점이 발견되지 않았습니다.',
    }
  }
  return {
    tone: 'warn',
    title: '분석 결과',
    message: reason || '보안 분석이 완료되었습니다.',
  }
}

export function PipelineProgressPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState
  const jobId = locationState.jobId ?? ''

  const [result, setResult] = useState<JobResult | null>(null)
  const [detail, setDetail] = useState<JobDetail | null>(null)
  // Lazy-init so we don't synchronously toggle loading inside the effect when
  // there's nothing to fetch (jobId/token are stable for this page's life).
  const [isLoading, setIsLoading] = useState(() => !!(jobId && token))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId || !token) return
    let cancelled = false

    // Fetch the summary (always available once the job exists) and the
    // detailed result (may be missing if the backend hasn't implemented
    // §3.9 yet) independently, so one failing doesn't blank the other.
    Promise.allSettled([
      fetchJobDetail(token, jobId),
      fetchJobResult(token, jobId),
    ]).then(([detailRes, resultRes]) => {
      if (cancelled) return

      if (detailRes.status === 'fulfilled') {
        setDetail(detailRes.value)
      } else {
        console.error('[result] job detail failed:', detailRes.reason)
      }

      if (resultRes.status === 'fulfilled') {
        setResult(resultRes.value)
      } else {
        console.error('[result] job result failed:', resultRes.reason)
      }

      // Only surface an error if we got nothing usable at all.
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

  // Resolved display values — prefer the detailed result, fall back to the
  // job-detail summary, then to the values passed via navigation state.
  const repoName = result?.repoName || detail?.repoName || locationState.repoName || ''
  const branch = result?.branch || detail?.branch || locationState.branch || ''
  const securityScore =
    result?.securityScore ?? detail?.securityScore ?? null
  const codeQualityScore = result?.codeQualityScore ?? null
  const verdict = result?.verdict ?? detail?.verdict ?? null
  const verdictReason = result?.verdictReason ?? detail?.verdictReason ?? null
  const jobStatus = detail?.status ?? null

  const severitySummary: Record<SecuritySeverity, number> = useMemo(
    () =>
      result?.severitySummary ??
      detail?.severityCounts ?? { critical: 0, high: 0, medium: 0, low: 0 },
    [result, detail],
  )

  const findings: SecurityFinding[] = result?.findings ?? []

  const totalVulnerabilityCount = useMemo(
    () =>
      severityOrder.reduce((sum, { key }) => sum + (severitySummary[key] ?? 0), 0),
    [severitySummary],
  )

  const banner = verdictBanner(verdict, jobStatus, verdictReason)

  const scoreChartData = useMemo(
    () => ({
      labels: ['보안 점수', '남은 점수'],
      datasets: [
        {
          data: [securityScore ?? 0, 100 - (securityScore ?? 0)],
          backgroundColor: ['#F97316', '#404040'],
          borderWidth: 0,
          hoverOffset: 0,
        },
      ],
    }),
    [securityScore],
  )

  const severityChartData = useMemo(
    () => ({
      labels: severityOrder.map((s) => s.label),
      datasets: [
        {
          data: severityOrder.map((s) => severitySummary[s.key] ?? 0),
          backgroundColor: severityOrder.map((s) => severityColors[s.label]),
          borderColor: '#1E1E1E',
          borderWidth: 2,
        },
      ],
    }),
    [severitySummary],
  )

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

  const bannerToneClass =
    banner.tone === 'fail'
      ? 'border-[#DC2626] bg-[#7F1D1D]/30'
      : banner.tone === 'warn'
        ? 'border-[#D97706] bg-[#78350F]/30'
        : 'border-[#3ECF8E] bg-[#065F46]/30'
  const bannerTitleClass =
    banner.tone === 'fail'
      ? 'text-[#FCA5A5]'
      : banner.tone === 'warn'
        ? 'text-[#FCD34D]'
        : 'text-[#A7F3D0]'
  const bannerMessageClass =
    banner.tone === 'fail'
      ? 'text-[#FECACA]'
      : banner.tone === 'warn'
        ? 'text-[#FDE68A]'
        : 'text-[#D1FAE5]'
  const BannerIcon = banner.tone === 'pass' ? CheckCircle2 : AlertTriangle

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[18px] font-bold text-white">보안 분석 결과</p>
            <p className="mt-2 flex items-center gap-2 text-[28px] font-bold leading-none text-white">
              <CodeXml className="h-7 w-7 text-[#34D399]" /> {repoName || jobId}
            </p>
            <p className="mt-1 text-[12px] text-[#6B7280]">
              브랜치 {branch || '-'} | ID: {jobId}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-9 border border-[#3ECF8E] bg-[#065F46]/30 px-3 text-xs text-[#A7F3D0] hover:bg-[#065F46]/50"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            결과 다운로드
          </Button>
        </div>

        <div className={`rounded-xl border p-4 ${bannerToneClass}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={`flex items-center gap-2 text-[16px] font-semibold ${bannerTitleClass}`}>
                <BannerIcon className="h-4.5 w-4.5" />
                {banner.title}
              </p>
              <p className={`mt-1 text-[12px] ${bannerMessageClass}`}>{banner.message}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 border-[#404040] bg-[#1E1E1E]/40 px-3 text-xs text-[#D1D5DB] hover:bg-[#1E1E1E]/70"
              onClick={() => navigate('/pipeline/progress', { state: { jobId, repoName, branch } })}
            >
              파이프라인 보기
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="mb-3 text-[16px] font-semibold text-white">보안 점수</p>
            <div className="relative mx-auto h-30 w-36">
              <Doughnut data={scoreChartData} options={scoreChartOptions} />
              <p className="pointer-events-none absolute left-1/2 top-[72%] -translate-x-1/2 -translate-y-1/2 text-[44px] font-bold leading-none text-[#F97316]">
                {securityScore ?? '-'}
              </p>
              <p className="pointer-events-none absolute left-1/2 top-[96%] -translate-x-1/2 -translate-y-1/2 text-[14px] text-[#9CA3AF]">
                / 100
              </p>
            </div>
            <div className="mt-2 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">코드 품질 점수</p>
              <p className="text-[24px] font-bold leading-none text-white">
                {codeQualityScore ?? '-'}
                <span className="text-[24px]">/100</span>
              </p>
            </div>
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="mb-3 text-[16px] font-semibold text-white">취약점 설명</p>
            <div className="flex min-h-45 items-center justify-center gap-6">
              {totalVulnerabilityCount > 0 ? (
                <div className="flex h-40 w-40 items-center justify-center">
                  <Doughnut data={severityChartData} options={severityChartOptions} />
                </div>
              ) : (
                <div className="flex h-40 w-40 items-center justify-center text-[12px] text-[#6B7280]">
                  탐지된 취약점 없음
                </div>
              )}
              <div className="flex-1 self-center space-y-2">
                {severityOrder.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between text-[12px] text-[#D1D5DB]">
                    <p className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: severityColors[label] }}
                      />
                      {label}
                    </p>
                    <span>{severitySummary[key] ?? 0}</span>
                  </div>
                ))}
                <div className="pt-1 text-[12px] text-[#A3A3A3]">
                  total {totalVulnerabilityCount.toLocaleString()}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="mb-3 flex items-center gap-2 text-[16px] font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-[#34D399]" /> 탐지된 취약점
            {findings.length > 0 ? (
              <span className="text-[12px] font-normal text-[#6B7280]">({findings.length})</span>
            ) : null}
          </p>

          {findings.length === 0 ? (
            <div className="rounded-xl border border-[#404040] bg-[#1E1E1E] p-6 text-center text-[12px] text-[#6B7280]">
              {result === null
                ? '상세 취약점 데이터를 아직 불러올 수 없습니다. (백엔드 결과 준비 대기 중)'
                : '탐지된 취약점이 없습니다.'}
            </div>
          ) : (
            <div className="space-y-3">
              {findings.map((item) => {
                const cvssText = item.cvss ? `CVSS: ${item.cvss}` : null
                const location = item.filePath
                  ? `${item.filePath}${item.lineStart ? `:${item.lineStart}` : ''}`
                  : null
                return (
                  <div key={item.id} className="rounded-xl border border-[#404040] bg-[#1E1E1E] p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold uppercase ${severityBadgeClassMap[item.severity]}`}
                      >
                        {item.severity}
                      </span>
                      {item.cve ? (
                        <span className="text-[14px] text-[#9CA3AF]">{item.cve}</span>
                      ) : null}
                      {item.scanner ? (
                        <span className="rounded-full border border-[#404040] px-2 py-0.5 text-[11px] text-[#9CA3AF]">
                          {item.scanner}
                        </span>
                      ) : null}
                    </div>

                    <p className="text-[24px] font-bold text-white">{item.title}</p>
                    {cvssText ? <p className="mt-1 text-[18px] text-[#808080]">{cvssText}</p> : null}
                    {location ? <p className="mt-1 text-[12px] text-[#34D399]">{location}</p> : null}

                    {item.codeSnippet ? (
                      <pre className="mt-3 overflow-x-auto rounded-md border border-[#404040] bg-[#0F0F0F] p-3 text-[12px] text-[#D1D5DB]">
                        <code className="font-mono">{item.codeSnippet}</code>
                      </pre>
                    ) : null}

                    {item.description ? (
                      <div className="mt-3">
                        <p className="text-[12px] font-semibold text-[#D1D5DB]">설명</p>
                        <p className="mt-1 text-[12px] text-[#A3A3A3]">{item.description}</p>
                      </div>
                    ) : null}

                    {item.aiSuggestion ? (
                      <div className="mt-3 rounded-lg border border-[#3ECF8E] bg-[#065F46] p-3">
                        <p className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#D1FAE5]">
                          <FileText className="h-3.5 w-3.5" /> AI 제안
                        </p>
                        <p className="mt-1 text-[14px] text-[#D1FAE5]">{item.aiSuggestion}</p>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </section>
    </MainLayout>
  )
}
