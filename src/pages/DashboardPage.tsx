import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  Activity,
  BookOpen,
  CircleCheckBig,
  CircleX,
  Copy,
  Clock3,
  Database,
  Eye,
  Globe,
  GitBranch,
  Play,
  Search,
  Shield,
  Star,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { Link, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { type RepositoryItem } from '@/data/repositories'
import {
  fetchJobsByIds,
  fetchReposWithBranches,
  getCachedRepos,
  getTrackedJobIds,
  removeTrackedJobId,
  setCachedRepos,
  type JobDetail,
  type JobVerdict,
} from '@/lib/api'
import { getLanguageColor } from '@/lib/languageColors'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

dayjs.extend(relativeTime)
dayjs.locale('ko')

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

type PipelineItem = {
  id: string
  jobId: string
  repoName: string
  description: string
  branch: string
  durationSec: number
  status: 'success' | 'failed' | 'running' | 'queued' | 'cancelled'
  score: number
  verdict: JobVerdict | null
  verdictReason: string | null
  totalFindings: number
  severityCounts: { critical: number; high: number; medium: number; low: number }
  executedAt: string
}

function formatDuration(durationSec: number) {
  const minutes = Math.floor(durationSec / 60)
  const seconds = durationSec % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function shortJobId(jobId: string) {
  return jobId ? `#${jobId.slice(0, 8)}` : ''
}

function mapJobToPipelineItem(job: JobDetail): PipelineItem {
  const finalStatus =
    job.status === 'success' || job.status === 'failed' || job.status === 'cancelled'
      ? job.status
      : job.status === 'running'
        ? 'running'
        : 'queued'

  return {
    id: shortJobId(job.jobId),
    jobId: job.jobId,
    repoName: job.repoName,
    description: `${job.triggerSource || 'pipeline'} · ${job.branch || '-'}`,
    branch: job.branch,
    durationSec: job.durationSecs,
    status: finalStatus,
    score: job.securityScore,
    verdict: job.verdict,
    verdictReason: job.verdictReason,
    totalFindings: job.totalFindings,
    severityCounts: job.severityCounts,
    executedAt: job.completedAt ?? job.startedAt ?? job.createdAt ?? '',
  }
}

const verdictMeta: Record<JobVerdict, { label: string; className: string }> = {
  passed: {
    label: 'PASS',
    className: 'border-[#6EE7B7] bg-[#065F46] text-[#6EE7B7]',
  },
  warning: {
    label: 'WARN',
    className: 'border-[#FCD34D] bg-[#78350F] text-[#FCD34D]',
  },
  failed: {
    label: 'FAIL',
    className: 'border-[#FCA5A5] bg-[#7F1D1D] text-[#FCA5A5]',
  },
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const cacheKey = token ? token.slice(0, 16) : 'anonymous'
  const [activeTab, setActiveTab] = useState<'repo' | 'pipeline'>('repo')
  const [searchInput, setSearchInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [repos, setRepos] = useState<RepositoryItem[]>(
    () => (token ? (getCachedRepos(cacheKey) ?? []) : []),
  )
  const [pipelines, setPipelines] = useState<PipelineItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isReposLoading, setIsReposLoading] = useState(
    () => !!token && !getCachedRepos(cacheKey),
  )
  const [isJobsLoading, setIsJobsLoading] = useState(
    () => !!token && getTrackedJobIds(cacheKey).length > 0,
  )
  const [reposError, setReposError] = useState<string | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const loadingTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!token) {
      setRepos([])
      return
    }

    let mounted = true
    setReposError(null)

    fetchReposWithBranches(token)
      .then((list) => {
        if (mounted) {
          setRepos(list)
          setCachedRepos(cacheKey, list)
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setReposError(
            error instanceof Error ? error.message : '레포지토리를 불러오지 못했습니다.',
          )
        }
      })
      .finally(() => {
        if (mounted) {
          setIsReposLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [token, cacheKey])

  useEffect(() => {
    if (!token) {
      setPipelines([])
      return
    }

    const ids = getTrackedJobIds(cacheKey)

    if (ids.length === 0) {
      setPipelines([])
      setIsJobsLoading(false)
      return
    }

    let cancelled = false
    let timer: number | null = null
    setIsJobsLoading(true)
    setJobsError(null)

    const TERMINAL = new Set(['success', 'failed', 'cancelled'])

    async function tick(initial: boolean) {
      try {
        const jobs = await fetchJobsByIds(token!, ids)
        if (cancelled) return
        const mapped = jobs.map(mapJobToPipelineItem)
        setPipelines(mapped)
        setJobsError(null)

        const hasActive = mapped.some((p) => !TERMINAL.has(p.status))
        if (!cancelled && hasActive) {
          timer = window.setTimeout(() => tick(false), 5000)
        }
      } catch (error) {
        if (cancelled) return
        setJobsError(
          error instanceof Error ? error.message : '파이프라인 결과를 불러오지 못했습니다.',
        )
      } finally {
        if (!cancelled && initial) setIsJobsLoading(false)
      }
    }

    tick(true)

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [token, cacheKey])

  const triggerLoading = () => {
    if (loadingTimerRef.current) {
      window.clearTimeout(loadingTimerRef.current)
    }

    setIsLoading(true)
    loadingTimerRef.current = window.setTimeout(() => setIsLoading(false), 280)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchKeyword(searchInput), 280)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    return () => {
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current)
      }
    }
  }, [])

  const filteredRepos = useMemo(
    () =>
      repos.filter((repo) => {
        const text = `${repo.name} ${repo.description}`.toLowerCase()
        return text.includes(searchKeyword.toLowerCase())
      }),
    [repos, searchKeyword],
  )

  const filteredPipelines = useMemo(
    () =>
      pipelines.filter((item) => {
        const text = `${item.repoName} ${item.description}`.toLowerCase()
        return text.includes(searchKeyword.toLowerCase())
      }),
    [pipelines, searchKeyword],
  )

  const deleteTarget = useMemo(
    () => pipelines.find((item) => item.jobId === deleteTargetId) ?? null,
    [deleteTargetId, pipelines],
  )

  const detectionOnCount = repos.filter((repo) => repo.detectEnabled).length
  const totalPipelines = pipelines.length
  const successCount = pipelines.filter((item) => item.status === 'success').length
  const successRate = totalPipelines === 0 ? 0 : Math.round((successCount / totalPipelines) * 100)
  const avgScore =
    totalPipelines === 0
      ? 0
      : Math.round(pipelines.reduce((sum, item) => sum + item.score, 0) / totalPipelines)
  const avgDuration =
    totalPipelines === 0
      ? 0
      : Math.round(pipelines.reduce((sum, item) => sum + item.durationSec, 0) / totalPipelines)

  const chartPipelines = useMemo(
    () => [...pipelines].reverse().slice(-20),
    [pipelines],
  )

  const chartData = useMemo(
    () => ({
      labels: chartPipelines.map((item) => item.id),
      datasets: [
        {
          label: '보안 점수 추이',
          data: chartPipelines.map((item) => item.score),
          borderColor: '#45bd87',
          backgroundColor: 'rgba(69, 189, 135, 0.2)',
          fill: true,
          tension: 0.35,
        },
      ],
    }),
    [chartPipelines],
  )

  return (
    <MainLayout>
      <section className="space-y-6">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <h1 className="text-4xl font-bold">대시보드</h1>
            <p className="mt-2 text-gray-200">
              레포지토리를 관리하고 파이프라인 실행 결과를 확인하세요
            </p>
          </div>
          <Button asChild size="lg" className="text-gray-900! shadow-none">
            <Link to="/pipeline/new" className="text-gray-900!">
              <Play className="mr-2 h-4 w-4 text-gray-900" /> 새 파이프라인
            </Link>
          </Button>
        </div>

        <div className="inline-flex w-fit items-center rounded-xl border border-white/10 bg-[#2A2A2A] p-1">
          <button
            type="button"
            onClick={() => {
              triggerLoading()
              setActiveTab('repo')
            }}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[14px] font-semibold transition ${
              activeTab === 'repo'
                ? 'bg-[#3A3A3A] text-[#34D399]'
                : 'bg-transparent text-[#9CA3AF] hover:text-gray-100'
            }`}
          >
            <BookOpen className="h-5 w-5" /> 내 레포지토리
            <span className="rounded-full bg-[#6B7280] px-2 py-0.5 text-xs text-white">{repos.length}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              triggerLoading()
              setActiveTab('pipeline')
            }}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[14px] font-semibold transition ${
              activeTab === 'pipeline'
                ? 'bg-[#3A3A3A] text-[#34D399]'
                : 'bg-transparent text-[#9CA3AF] hover:text-gray-100'
            }`}
          >
            <Activity className="h-5 w-5" /> 파이프라인 결과
            <span className="rounded-full bg-[#6B7280] px-2 py-0.5 text-xs text-white">{pipelines.length}</span>
          </button>
        </div>

        {activeTab === 'repo' ? (
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="inline-flex items-center gap-2 text-[14px] text-[#A1A1A1]">
              <Eye className="h-4 w-4 text-[#6EE7B7]" /> 탐지 활성: {detectionOnCount}/{repos.length}
            </p>

            <label className="relative block w-full md:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-300" />
              <input
                value={searchInput}
                onChange={(event) => {
                  triggerLoading()
                  setSearchInput(event.target.value)
                }}
                placeholder="레포지토리 검색..."
                className="h-11 w-full rounded-xl border border-white/10 bg-[#262626] pl-10 pr-3 text-sm text-gray-50 outline-none ring-green-500/45 placeholder:text-gray-300 focus:ring"
              />
            </label>
          </div>
        ) : null}

        {activeTab === 'repo' ? (
          <div className="space-y-4">
            {isLoading || isReposLoading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx} className="h-36 animate-pulse border-gray-500/60 bg-gray-700/30" />
              ))
            ) : reposError ? (
              <Card className="p-4 text-center text-[#FCA5A5]">
                {reposError}
              </Card>
            ) : filteredRepos.length === 0 ? (
              <Card className="p-4 text-center text-gray-200">
                레포지토리가 없습니다. GitHub 연동 후 레포지토리 추가를 진행하세요.
              </Card>
            ) : (
              filteredRepos.map((repo) => (
                <Card
                  key={repo.id}
                  className="cursor-pointer rounded-xl border-white/10 bg-[#262626] p-4"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/repository', { state: { repoId: repo.id } })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      navigate('/repository', { state: { repoId: repo.id } })
                    }
                  }}
                >
                  <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/repository"
                          state={{ repoId: repo.id }}
                          onClick={(event) => event.stopPropagation()}
                          className="text-[18px] font-bold text-white hover:text-[#6EE7B7]"
                        >
                          {repo.name}
                        </Link>
                        <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">
                          <Globe className="mr-1 h-3 w-3" /> {repo.visibility}
                        </Badge>
                      </div>
                      <p className="mt-2 text-[12px] text-[#6B7280]">{repo.description}</p>
                      <p className="mt-5 flex flex-wrap items-center gap-4 text-[12px] text-[#6B7280]">
                        <span>업데이트: {dayjs(repo.updatedAt).fromNow()}</span>
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-4 w-4" /> {repo.stars}
                        </span>
                        <span className="inline-flex items-center gap-2 text-[12px] text-[#6B7280]">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: getLanguageColor(repo.language) }}
                          />
                          {repo.language}
                        </span>
                      </p>
                    </div>

                    <div className="text-right text-[12px]">
                      <div className="mb-2 flex flex-wrap justify-end gap-2">
                        <span className="inline-flex items-center text-[#6B7280]">
                          <GitBranch className="h-4 w-4" />
                        </span>
                        {repo.branches.slice(0, 4).map((branch) => (
                          <Badge
                            key={branch}
                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] ${
                              branch === 'main' || branch === 'master'
                                ? 'border-[#6EE7B7] bg-[#065F46] text-[#6EE7B7]'
                                : 'border-white/20 bg-[#3A3A3A] text-[#9CA3AF]'
                            }`}
                          >
                            {branch}
                          </Badge>
                        ))}
                        {repo.branches.length > 4 ? (
                          <Badge className="inline-flex items-center gap-1 rounded-full border-white/20 bg-[#3A3A3A] px-3 py-1 text-[12px] text-[#9CA3AF]">
                            +{repo.branches.length - 4}개
                          </Badge>
                        ) : null}
                      </div>
                      <div className="inline-flex items-center gap-2 text-[12px] text-[#D1D5DB]">
                        <Eye className="h-4 w-4 text-[#34D399]" />
                        탐지
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setRepos((prev) =>
                              prev.map((item) =>
                                item.id === repo.id
                                  ? { ...item, detectEnabled: !item.detectEnabled }
                                  : item,
                              ),
                            )
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                            repo.detectEnabled ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                          aria-label="탐지 토글"
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                              repo.detectEnabled ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">전체 실행</p>
                  <Database className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {pipelines.length}
                </p>
              </Card>
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">성공률</p>
                  <Activity className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {successRate}%
                </p>
              </Card>
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">평균 보안 점수</p>
                  <Shield className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {avgScore} / 100
                </p>
              </Card>
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">평균 소요 시간</p>
                  <Clock3 className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {formatDuration(avgDuration)}
                </p>
              </Card>
            </div>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <h2 className="text-4xl font-extrabold text-white">파이프라인 실행 기록</h2>
              <label className="relative block w-full md:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-300" />
                <input
                  value={searchInput}
                  onChange={(event) => {
                    triggerLoading()
                    setSearchInput(event.target.value)
                  }}
                  placeholder="레포지토리 검색..."
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#262626] pl-10 pr-3 text-sm text-gray-50 outline-none ring-green-500/45 placeholder:text-gray-300 focus:ring"
                />
              </label>
            </div>

            <Card className="p-4">
              <p className="mb-3 text-sm text-gray-200">실행별 보안 점수 추이</p>
              <Line
                data={chartData}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: {
                      min: 0,
                      max: 100,
                      ticks: { color: '#d1d5db' },
                      grid: { color: 'rgba(255,255,255,0.08)' },
                    },
                    x: {
                      ticks: { color: '#d1d5db' },
                      grid: { color: 'rgba(255,255,255,0.05)' },
                    },
                  },
                }}
              />
            </Card>

            {isLoading || isJobsLoading ? (
              Array.from({ length: 2 }).map((_, idx) => (
                <Card key={idx} className="h-42 animate-pulse border-gray-500/60 bg-gray-700/30" />
              ))
            ) : jobsError ? (
              <Card className="p-4 text-center text-[#FCA5A5]">{jobsError}</Card>
            ) : filteredPipelines.length === 0 ? (
              <Card className="p-4 text-center text-gray-200">
                실행 기록이 없습니다. 새 파이프라인을 생성하세요.
              </Card>
            ) : (
              filteredPipelines.map((run) => (
                <Card
                  key={run.jobId}
                  className="border-white/10 bg-[#262626] p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        {run.status === 'success' ? (
                          <CircleCheckBig className="h-6 w-6 text-[#34D399]" />
                        ) : run.status === 'failed' ? (
                          <CircleX className="h-6 w-6 text-[#FF3B30]" />
                        ) : (
                          <Activity className="h-6 w-6 text-[#FCD34D]" />
                        )}
                        <h3 className="text-[18px] font-bold leading-none text-white">
                          {run.repoName || run.jobId}
                        </h3>
                        <span className="text-[14px] text-[#6B7280]">{run.id}</span>
                        {run.status === 'running' || run.status === 'queued' ? (
                          <Badge className="border-[#F59E0B] bg-[#78350F] px-2 py-0.5 text-[11px] text-[#FCD34D]">
                            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#FCD34D]" />
                            {run.status === 'running' ? '실행 중' : '대기 중'}
                          </Badge>
                        ) : null}
                        {run.verdict ? (
                          <Badge
                            className={`px-2 py-0.5 text-[11px] ${verdictMeta[run.verdict].className}`}
                            title={run.verdictReason ?? undefined}
                          >
                            {verdictMeta[run.verdict].label}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 text-[12px] text-[#6B7280]">{run.description}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-[#6B7280]">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-4.5 w-4.5 text-[#6B7280]" />
                        </span>
                        <Badge className="border-[#6EE7B7] bg-[#065F46] px-3 py-1 text-[12px] text-[#6EE7B7]">
                          {run.branch || '-'}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-[12px] text-[#6B7280]">
                          <Clock3 className="h-4 w-4" /> {formatDuration(run.durationSec)}
                        </span>
                        {run.executedAt ? (
                          <span className="text-[12px] text-[#6B7280]">
                            {dayjs(run.executedAt).fromNow()}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1 text-[12px] text-[#6B7280]">
                          <Shield className="h-4 w-4" /> {run.totalFindings} findings
                        </span>
                      </div>

                      {run.totalFindings > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                          {run.severityCounts.critical > 0 ? (
                            <Badge className="border-[#FCA5A5] bg-[#7F1D1D] px-2 py-0.5 text-[#FCA5A5]">
                              Critical {run.severityCounts.critical}
                            </Badge>
                          ) : null}
                          {run.severityCounts.high > 0 ? (
                            <Badge className="border-[#FDBA74] bg-[#7C2D12] px-2 py-0.5 text-[#FDBA74]">
                              High {run.severityCounts.high}
                            </Badge>
                          ) : null}
                          {run.severityCounts.medium > 0 ? (
                            <Badge className="border-[#FCD34D] bg-[#78350F] px-2 py-0.5 text-[#FCD34D]">
                              Medium {run.severityCounts.medium}
                            </Badge>
                          ) : null}
                          {run.severityCounts.low > 0 ? (
                            <Badge className="border-[#93C5FD] bg-[#1E3A8A] px-2 py-0.5 text-[#93C5FD]">
                              Low {run.severityCounts.low}
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}

                      <hr className="my-4 border-white/10" />

                      {run.status === 'running' || run.status === 'queued' ? (
                        <div>
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="text-[10px] text-[#E5E7EB]">진행 중...</span>
                            <span className="text-[12px] text-[#FCD34D]">결과 대기</span>
                          </div>
                          <div className="h-2.5 w-full max-w-203.75 overflow-hidden rounded-full bg-[#404040]">
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-[#F59E0B]" />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="text-[10px] text-[#E5E7EB]">보안 점수</span>
                            <span className="text-[14px] font-semibold text-[#FF7206]">
                              {run.score}/100
                            </span>
                          </div>
                          <div className="h-2.5 w-full max-w-203.75 overflow-hidden rounded-full bg-[#404040]">
                            <div className="h-full bg-[#FF7206]" style={{ width: `${run.score}%` }} />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate('/pipeline/progress', {
                            state: {
                              jobId: run.jobId,
                              repoName: run.repoName,
                              branch: run.branch,
                            },
                          })
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#5B5B5B] bg-[#2E2E2E] text-[#22D3EE] transition-colors hover:bg-[#3A3A3A]"
                        aria-label="실행 페이지 보기"
                      >
                        <GitBranch className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={
                          run.status !== 'success' &&
                          run.status !== 'failed' &&
                          run.status !== 'cancelled'
                        }
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate('/pipeline/result', {
                            state: {
                              jobId: run.jobId,
                              repoName: run.repoName,
                              branch: run.branch,
                            },
                          })
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#5B5B5B] bg-[#2E2E2E] text-[#6366F1] transition-colors hover:bg-[#3A3A3A] disabled:cursor-not-allowed disabled:text-[#4B5563] disabled:hover:bg-[#2E2E2E]"
                        aria-label="결과 페이지 보기"
                        title={
                          run.status === 'success' ||
                          run.status === 'failed' ||
                          run.status === 'cancelled'
                            ? '결과 페이지 보기'
                            : '파이프라인 종료 후 활성화됩니다'
                        }
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(run.jobId)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#5B5B5B] bg-[#2E2E2E] text-[#EF4444]"
                        aria-label="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </section>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>실행 기록을 삭제할까요?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.id} (${deleteTarget.repoName || deleteTarget.jobId}) 항목을 목록에서 제거합니다. 백엔드 데이터는 유지됩니다.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
              취소
            </Button>
            <Button
              onClick={() => {
                if (!deleteTarget) {
                  return
                }
                removeTrackedJobId(cacheKey, deleteTarget.jobId)
                setPipelines((prev) => prev.filter((item) => item.jobId !== deleteTarget.jobId))
                setDeleteTargetId(null)
              }}
              className="bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
