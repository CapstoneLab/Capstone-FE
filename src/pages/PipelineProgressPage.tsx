import { AlertTriangle, CodeXml, Download, FileText, ShieldAlert } from 'lucide-react'
import { useMemo } from 'react'
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartOptions } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

ChartJS.register(ArcElement, Tooltip, Legend)

type LocationState = {
  repoName?: string
  branch?: string
}

type Severity = 'Critical' | 'High' | 'Medium' | 'Low'

type VulnerabilityItem = {
  id: string
  cve: string
  cvss: string
  title: string
  severity: 'HIGH' | 'CRITICAL' | 'MEDIUM' | 'LOW'
  filePath: string
  description: string
  aiSuggestion: string
}

const securityScore = 62
const codeQualityScore = 75
const pipelineId = 'f3fk34432h-h4lo56j34-5oi3j56r-tijw4h3n'

const severitySummary: Record<Severity, number> = {
  Critical: 4,
  High: 11,
  Medium: 19,
  Low: 27,
}

const severityColors: Record<Severity, string> = {
  Critical: '#EF4444',
  High: '#F87171',
  Medium: '#F97316',
  Low: '#22C55E',
}

const vulnerabilities: VulnerabilityItem[] = [
  {
    id: '1',
    cve: 'CVE-2003-0041',
    cvss: 'CVSS V2.0: 7.5 / 10.0',
    title: 'SQL Injection',
    severity: 'HIGH',
    filePath: '/var/folders/DVWA_9241efe5/vulnerabilities/sac/source/low.php:35',
    description:
      "Executing non-constant commands. This can lead to command injection. You should use 'escapeshellarg()' when using command.",
    aiSuggestion:
      '해당 라인의 코드가 SQL 인젝션 위험이 존재하였다. 따라서 이렇게 재작성 하여라 구체적 수정 해보면 좋을 것 같다.',
  },
  {
    id: '2',
    cve: 'CVE-2020-9484',
    cvss: 'CVSS V2.0: 9.0 / 10.0',
    title: 'Insecure Deserialization',
    severity: 'CRITICAL',
    filePath: '/workspace/tomcat/session/manager.java:102',
    description:
      'Untrusted serialized data is deserialized without validation, enabling remote code execution risk.',
    aiSuggestion:
      '역직렬화 입력은 서명 검증 후 허용 목록 타입만 처리하고, 기본 역직렬화 경로는 차단하세요.',
  },
  {
    id: '3',
    cve: 'CVE-2019-11043',
    cvss: 'CVSS V2.0: 6.4 / 10.0',
    title: 'Path Traversal',
    severity: 'MEDIUM',
    filePath: '/srv/app/controllers/download.php:77',
    description:
      'User-controlled file path is concatenated directly, allowing directory traversal outside intended scope.',
    aiSuggestion: '경로 정규화 후 루트 디렉터리 이탈을 차단하고 허용된 파일 확장자만 접근 가능하게 제한하세요.',
  },
  {
    id: '4',
    cve: 'CVE-2018-1000007',
    cvss: 'CVSS V2.0: 3.1 / 10.0',
    title: 'Information Disclosure',
    severity: 'LOW',
    filePath: '/opt/api/src/error-handler.ts:41',
    description:
      'Detailed stack traces and internal service paths are exposed in API error responses to external clients.',
    aiSuggestion: '운영 환경에서는 공통 오류 메시지만 반환하고, 상세 예외는 내부 로깅 시스템으로만 전송하세요.',
  },
]

const severityBadgeClassMap: Record<VulnerabilityItem['severity'], string> = {
  CRITICAL: 'border-[#EF4444] bg-[#450A0A] text-[#F87171]',
  HIGH: 'border-[#DC2626] bg-[#3B0A0A] text-[#F87171]',
  MEDIUM: 'border-[#F97316] bg-[#3A1A05] text-[#FDBA74]',
  LOW: 'border-[#22C55E] bg-[#052E1B] text-[#86EFAC]',
}

const scoreChartOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  rotation: 270,
  circumference: 180,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      enabled: false,
    },
  },
}

const severityChartOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '0%',
  plugins: {
    legend: {
      display: false,
    },
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

export function PipelineProgressPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState

  const repoName = locationState.repoName ?? 'myuser/web-app'
  const branch = locationState.branch ?? 'main'

  const severityLabels = useMemo(() => Object.keys(severitySummary) as Severity[], [])
  const severityValues = useMemo(() => severityLabels.map((label) => severitySummary[label]), [severityLabels])
  const totalVulnerabilityCount = useMemo(
    () => severityValues.reduce((sum, value) => sum + value, 0),
    [severityValues],
  )

  const scoreChartData = useMemo(
    () => ({
      labels: ['보안 점수', '남은 점수'],
      datasets: [
        {
          data: [securityScore, 100 - securityScore],
          backgroundColor: ['#F97316', '#404040'],
          borderWidth: 0,
          hoverOffset: 0,
        },
      ],
    }),
    [],
  )

  const severityChartData = useMemo(
    () => ({
      labels: severityLabels,
      datasets: [
        {
          data: severityValues,
          backgroundColor: severityLabels.map((label) => severityColors[label]),
          borderColor: '#1E1E1E',
          borderWidth: 2,
        },
      ],
    }),
    [severityLabels, severityValues],
  )

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[18px] font-bold text-white">보안 분석 결과</p>
            <p className="mt-2 flex items-center gap-2 text-[28px] font-bold leading-none text-white">
              <CodeXml className="h-7 w-7 text-[#34D399]" /> {repoName}
            </p>
            <p className="mt-1 text-[12px] text-[#6B7280]">브랜치 {branch} | ID: {pipelineId}</p>
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

        <div className="rounded-xl border border-[#DC2626] bg-[#7F1D1D]/30 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[16px] font-semibold text-[#FCA5A5]">
                <AlertTriangle className="h-4.5 w-4.5" />
                파이프라인 실패
              </p>
              <p className="mt-1 text-[12px] text-[#FECACA]">
                보안 취약점이 발견되어 파이프라인을 종료하였습니다.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 border-[#991B1B] bg-[#F87171]/20 px-3 text-xs text-[#FECACA] hover:bg-[#F87171]/30"
              onClick={() => navigate('/pipeline/progress', { state: { repoName, branch } })}
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
                {securityScore}
              </p>
              <p className="pointer-events-none absolute left-1/2 top-[96%] -translate-x-1/2 -translate-y-1/2 text-[14px] text-[#9CA3AF]">
                / 100
              </p>
            </div>
            <div className="mt-2 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">쓰레스홀드</p>
              <p className="text-[24px] font-bold leading-none text-white">
                {codeQualityScore}
                <span className="text-[24px]">/100</span>
              </p>
            </div>
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="mb-3 text-[16px] font-semibold text-white">취약점 설명</p>
            <div className="flex min-h-45 items-center justify-center gap-6">
              <div className="flex h-40 w-40 items-center justify-center">
                <Doughnut data={severityChartData} options={severityChartOptions} />
              </div>
              <div className="flex-1 self-center space-y-2">
                {severityLabels.map((label) => (
                  <div key={label} className="flex items-center justify-between text-[12px] text-[#D1D5DB]">
                    <p className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: severityColors[label] }} />
                      {label}
                    </p>
                    <span>{severitySummary[label]}</span>
                  </div>
                ))}
                <div className="pt-1 text-[12px] text-[#A3A3A3]">total {totalVulnerabilityCount.toLocaleString()}</div>
              </div>
            </div>
          </Card>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="mb-3 flex items-center gap-2 text-[16px] font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-[#34D399]" /> 탐지된 취약점
          </p>

          <div className="space-y-3">
            {vulnerabilities.map((item) => (
              <div key={item.id} className="rounded-xl border border-[#404040] bg-[#1E1E1E] p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[12px] font-semibold ${severityBadgeClassMap[item.severity]}`}
                  >
                    {item.severity}
                  </span>
                  <span className="text-[14px] text-[#9CA3AF]">{item.cve}</span>
                </div>

                <p className="text-[24px] font-bold text-white">{item.title}</p>
                <p className="mt-1 text-[18px] text-[#808080]">{item.cvss}</p>
                <p className="mt-1 text-[12px] text-[#34D399]">{item.filePath}</p>

                <div className="mt-3">
                  <p className="text-[12px] font-semibold text-[#D1D5DB]">설명</p>
                  <p className="mt-1 text-[12px] text-[#A3A3A3]">{item.description}</p>
                </div>

                <div className="mt-3 rounded-lg border border-[#3ECF8E] bg-[#065F46] p-3">
                  <p className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#D1FAE5]">
                    <FileText className="h-3.5 w-3.5" /> AI 제안
                  </p>
                  <p className="mt-1 text-[14px] text-[#D1FAE5]">{item.aiSuggestion}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </MainLayout>
  )
}
