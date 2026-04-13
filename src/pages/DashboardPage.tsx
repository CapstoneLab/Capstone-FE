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
import { fetchReposWithBranches, getCachedRepos, setCachedRepos } from '@/lib/api'
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
  repoName: string
  description: string
  branch: string
  durationSec: number
  language: string
  status: 'success' | 'failed'
  score: number
  executedAt: string
}

const pipelineSeed: PipelineItem[] = [
  {
    id: '#400001',
    repoName: 'myuser/web-app',
    description: '웹 앱 CI/CD 실행',
    branch: 'main',
    durationSec: 225,
    language: 'TypeScript',
    status: 'success',
    score: 91,
    executedAt: '2026-03-30T08:12:00',
  },
  {
    id: '#400002',
    repoName: 'myuser/api-server',
    description: 'API 서버 CI/CD 실행',
    branch: 'develop',
    durationSec: 252,
    language: 'TypeScript',
    status: 'failed',
    score: 72,
    executedAt: '2026-03-30T10:03:00',
  },
  {
    id: '#400003',
    repoName: 'myuser/mobile-client',
    description: '모바일 클라이언트 파이프라인',
    branch: 'main',
    durationSec: 182,
    language: 'TypeScript',
    status: 'success',
    score: 84,
    executedAt: '2026-03-31T12:22:00',
  },
]

function formatDuration(durationSec: number) {
  const minutes = Math.floor(durationSec / 60)
  const seconds = durationSec % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
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
  const [pipelines, setPipelines] = useState(pipelineSeed)
  const [isLoading, setIsLoading] = useState(false)
  const [isReposLoading, setIsReposLoading] = useState(
    () => !!token && !getCachedRepos(cacheKey),
  )
  const [reposError, setReposError] = useState<string | null>(null)
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
    () => pipelines.find((item) => item.id === deleteTargetId) ?? null,
    [deleteTargetId, pipelines],
  )

  const detectionOnCount = repos.filter((repo) => repo.detectEnabled).length
  const successRate = Math.round(
    (pipelines.filter((item) => item.status === 'success').length / pipelines.length) * 100,
  )
  const avgScore = Math.round(pipelines.reduce((sum, item) => sum + item.score, 0) / pipelines.length)
  const avgDuration = Math.round(
    pipelines.reduce((sum, item) => sum + item.durationSec, 0) / pipelines.length,
  )

  const chartData = useMemo(
    () => ({
      labels: pipelines.map((item) => item.id),
      datasets: [
        {
          label: '보안 점수 추이',
          data: pipelines.map((item) => item.score),
          borderColor: '#45bd87',
          backgroundColor: 'rgba(69, 189, 135, 0.2)',
          fill: true,
          tension: 0.35,
        },
      ],
    }),
    [pipelines],
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

            {isLoading ? (
              Array.from({ length: 2 }).map((_, idx) => (
                <Card key={idx} className="h-42 animate-pulse border-gray-500/60 bg-gray-700/30" />
              ))
            ) : filteredPipelines.length === 0 ? (
              <Card className="p-4 text-center text-gray-200">
                실행 기록이 없습니다. 새 파이프라인을 생성하세요.
              </Card>
            ) : (
              filteredPipelines.map((run) => (
                <Card
                  key={run.id}
                  className="border-white/10 bg-[#262626] p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        {run.status === 'success' ? (
                          <CircleCheckBig className="h-6 w-6 text-[#34D399]" />
                        ) : (
                          <CircleX className="h-6 w-6 text-[#FF3B30]" />
                        )}
                        <h3 className="text-[18px] font-bold leading-none text-white">
                          {run.repoName}
                        </h3>
                        <span className="text-[18px] text-[#6B7280]">{run.id}</span>
                      </div>
                      <p className="mt-3 text-[12px] text-[#6B7280]">{run.description}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-[#6B7280]">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-4.5 w-4.5 text-[#6B7280]" />
                        </span>
                        <Badge className="border-[#6EE7B7] bg-[#065F46] px-3 py-1 text-[12px] text-[#6EE7B7]">
                          {run.branch}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-[12px] text-[#6B7280]">
                          <Clock3 className="h-4 w-4" /> {formatDuration(run.durationSec)}
                        </span>
                        <span className="inline-flex items-center gap-2 text-[12px] text-[#6B7280]">
                          <span
                            className="h-4 w-4 rounded-full"
                            style={{ backgroundColor: getLanguageColor(run.language) }}
                          />{' '}
                          {run.language}
                        </span>
                      </div>

                      <hr className="my-4 border-white/10" />

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
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#5B5B5B] bg-[#2E2E2E] text-[#22D3EE]"
                        aria-label="브랜치 보기"
                      >
                        <GitBranch className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#5B5B5B] bg-[#2E2E2E] text-[#6366F1]"
                        aria-label="복사"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(run.id)}
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
              {deleteTarget ? `${deleteTarget.id} 항목은 삭제 후 복구할 수 없습니다.` : ''}
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
                setPipelines((prev) => prev.filter((item) => item.id !== deleteTarget.id))
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
