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
  Loader2,
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
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { type RepositoryItem } from '@/data/repositories'
import {
  AuthExpiredError,
  deriveJobStatus,
  fetchJobsByIds,
  fetchReposWithBranches,
  getCachedRepos,
  getRepoDetectEnabled,
  getTrackedJobIds,
  mergeTrackedJobIds,
  removeTrackedJobId,
  setCachedRepos,
  setRepoDetectEnabled,
  type JobDetail,
  type JobVerdict,
} from '@/lib/api'
import { getLanguageColor } from '@/lib/languageColors'
import { useAuth } from '@/contexts/AuthContext'
import { getAuthCacheKey } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

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
  totalSteps: number
  completedSteps: number
  currentStepName: string | null
}

type DashboardTab = 'repo' | 'pipeline'

const dashboardTabOrder: DashboardTab[] = ['repo', 'pipeline']

const dashboardTabPanelVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -28 : 28,
  }),
  animate: {
    opacity: 1,
    x: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 28 : -28,
  }),
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
  const finalStatus = deriveJobStatus(job)
  const completedSteps = job.steps.filter(
    (step) => step.status === 'success' || step.status === 'skipped',
  ).length
  const runningStep = job.steps.find((step) => step.status === 'running')

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
    totalSteps: job.steps.length,
    completedSteps,
    currentStepName: runningStep?.stepName ?? null,
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

const PIPELINE_CACHE_PREFIX = 'secupipeline:pipeline-items:'
const TERMINAL_PIPELINE_STATUS = new Set(['success', 'failed', 'cancelled'])

function getCachedPipelines(key: string): PipelineItem[] {
  try {
    const raw = localStorage.getItem(PIPELINE_CACHE_PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { pipelines?: PipelineItem[] }
    return Array.isArray(parsed.pipelines) && parsed.pipelines.length > 0
      ? parsed.pipelines
      : []
  } catch {
    return []
  }
}

function setCachedPipelines(key: string, pipelines: PipelineItem[]): void {
  try {
    localStorage.setItem(
      PIPELINE_CACHE_PREFIX + key,
      JSON.stringify({ timestamp: Date.now(), pipelines }),
    )
  } catch {
    // Ignore storage quota/unavailable errors.
  }
}

function mergeCachedPipelines(targetKey: string, sourceKey: string | null): PipelineItem[] {
  const target = getCachedPipelines(targetKey)
  if (!sourceKey || sourceKey === targetKey) return target

  const source = getCachedPipelines(sourceKey)
  if (source.length === 0) return target

  const mergedById = new Map<string, PipelineItem>()
  ;[...source, ...target].forEach((item) => {
    if (item.jobId) mergedById.set(item.jobId, item)
  })

  const merged = Array.from(mergedById.values())
  setCachedPipelines(targetKey, merged)
  return merged
}

function getAllKnownTrackedJobIds(key: string, cached: PipelineItem[]): string[] {
  const ids = new Set<string>(getTrackedJobIds(key))
  cached.forEach((item) => ids.add(item.jobId))

  return Array.from(ids).filter(Boolean)
}

function scoreTone(score: number): { color: string } {
  if (score >= 80) return { color: '#22C55E' }
  if (score >= 50) return { color: '#F97316' }
  return { color: '#EF4444' }
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { token, user, logout } = useAuth()
  const { locale, t } = useLanguage()
  const cacheKey = getAuthCacheKey(token, user)
  const legacyTokenCacheKey = token && user ? token.slice(0, 16) : null
  const [activeTab, setActiveTab] = useState<DashboardTab>('repo')
  const [tabDirection, setTabDirection] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [repos, setRepos] = useState<RepositoryItem[]>(() => {
    if (!token) return []
    const cached = getCachedRepos(cacheKey)
    if (!cached) return []
    // Merge persisted "탐지" toggle back in — the API doesn't carry this,
    // so without rehydrating from localStorage every toggle would reset on
    // navigation/refresh.
    return cached.map((repo) => ({
      ...repo,
      detectEnabled: getRepoDetectEnabled(cacheKey, repo.id),
    }))
  })
  const [pipelines, setPipelines] = useState<PipelineItem[]>(() => getCachedPipelines(cacheKey))
  const [isLoading, setIsLoading] = useState(false)
  const [isReposLoading, setIsReposLoading] = useState(
    () => !!token && !getCachedRepos(cacheKey),
  )
  const [isJobsLoading, setIsJobsLoading] = useState(
    () => !!token && getTrackedJobIds(cacheKey).length > 0 && getCachedPipelines(cacheKey).length === 0,
  )
  const [reposError, setReposError] = useState<string | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const loadingTimerRef = useRef<number | null>(null)

  useEffect(() => {
    dayjs.locale(locale)
  }, [locale])

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
          const hydrated = list.map((repo) => ({
            ...repo,
            detectEnabled: getRepoDetectEnabled(cacheKey, repo.id),
          }))
          setRepos(hydrated)
          setCachedRepos(cacheKey, list)
        }
      })
      .catch((error: unknown) => {
        if (!mounted) return
        if (error instanceof AuthExpiredError) {
          console.warn('[DashboardPage] auth expired — redirecting to login')
          logout()
          navigate('/auth', { replace: true })
          return
        }
        setReposError(
          error instanceof Error ? error.message : t('dashboard.repoLoadFailed'),
        )
      })
      .finally(() => {
        if (mounted) {
          setIsReposLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [token, cacheKey, logout, navigate, t])

  useEffect(() => {
    if (!token) {
      setPipelines([])
      return
    }

    const cached = mergeCachedPipelines(cacheKey, legacyTokenCacheKey)
    if (legacyTokenCacheKey) {
      mergeTrackedJobIds(cacheKey, legacyTokenCacheKey)
    }
    const ids = getAllKnownTrackedJobIds(cacheKey, cached)

    if (ids.length === 0) {
      if (cached.length > 0) {
        setPipelines(cached)
      } else {
        setPipelines([])
      }
      setIsJobsLoading(false)
      return
    }

    const visibleCached = cached.filter((item) => ids.includes(item.jobId))
    if (visibleCached.length > 0) {
      setPipelines(visibleCached)
    }

    const cachedById = new Map(visibleCached.map((item) => [item.jobId, item]))
    const idsToFetch =
      visibleCached.length > 0
        ? ids.filter((id) => {
            const cachedItem = cachedById.get(id)
            return !cachedItem || !TERMINAL_PIPELINE_STATUS.has(cachedItem.status)
          })
        : ids

    if (idsToFetch.length === 0) {
      setIsJobsLoading(false)
      setJobsError(null)
      return
    }

    let cancelled = false
    let timer: number | null = null
    setIsJobsLoading(visibleCached.length === 0)
    setJobsError(null)

    async function tick(initial: boolean) {
      try {
        const jobs = await fetchJobsByIds(token!, idsToFetch)
        if (cancelled) return
        const fetchedItems = jobs.map(mapJobToPipelineItem)
        const fetchedById = new Map(fetchedItems.map((item) => [item.jobId, item]))
        const merged =
          visibleCached.length > 0
            ? ids
                .map((id) => fetchedById.get(id) ?? cachedById.get(id))
                .filter((item): item is PipelineItem => !!item)
            : fetchedItems

        if (merged.length > 0 || visibleCached.length === 0) {
          setPipelines(merged)
        }
        if (merged.length > 0) {
          setCachedPipelines(cacheKey, merged)
        }
        setJobsError(null)

        const hasActive = fetchedItems.some((p) => !TERMINAL_PIPELINE_STATUS.has(p.status))
        if (!cancelled && hasActive) {
          timer = window.setTimeout(() => tick(false), 3000)
        }
      } catch (error) {
        if (cancelled) return
        setJobsError(
          error instanceof Error ? error.message : t('dashboard.jobsLoadFailed'),
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
  }, [token, cacheKey, legacyTokenCacheKey, t])

  const triggerLoading = () => {
    if (loadingTimerRef.current) {
      window.clearTimeout(loadingTimerRef.current)
    }

    setIsLoading(true)
    loadingTimerRef.current = window.setTimeout(() => setIsLoading(false), 280)
  }

  const switchTab = (nextTab: DashboardTab) => {
    if (nextTab === activeTab) {
      return
    }

    const currentIndex = dashboardTabOrder.indexOf(activeTab)
    const nextIndex = dashboardTabOrder.indexOf(nextTab)
    setTabDirection(nextIndex > currentIndex ? 1 : -1)
    setActiveTab(nextTab)
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
          label: t('dashboard.scoreTrend'),
          data: chartPipelines.map((item) => item.score),
          borderColor: '#45bd87',
          backgroundColor: '#45bd87',
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#45bd87',
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: false,
          tension: 0.18,
          borderWidth: 2,
        },
      ],
    }),
    [chartPipelines, t],
  )

  return (
    <MainLayout>
      <section className="space-y-6">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <h1 className="text-4xl font-bold">{t('dashboard.title')}</h1>
            <p className="mt-2 text-gray-200">
              {t('dashboard.description')}
            </p>
          </div>
          <Button asChild size="lg" className="text-gray-900! shadow-none">
            <Link to="/pipeline/new" className="text-gray-900!">
              <Play className="mr-2 h-4 w-4 text-gray-900" /> {t('common.newPipeline')}
            </Link>
          </Button>
        </div>

        <div className="inline-flex w-fit items-center rounded-xl border border-white/10 bg-[#2A2A2A] p-1">
          {([
            { key: 'repo', label: t('dashboard.repoTab'), icon: BookOpen, count: repos.length },
            { key: 'pipeline', label: t('dashboard.pipelineTab'), icon: Activity, count: pipelines.length },
          ] as const).map(({ key, label, icon: Icon, count }) => {
            const active = activeTab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => switchTab(key)}
                className={`relative inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[14px] font-semibold transition-colors ${
                  active ? 'text-[#34D399]' : 'text-[#9CA3AF] hover:text-gray-100'
                }`}
              >
                {/* Single shared pill that slides between tabs (magic-move). */}
                {active ? (
                  <motion.span
                    layoutId="dashboardTabPill"
                    className="tab-toggle__pill absolute inset-0 rounded-xl bg-[#3A3A3A] shadow-sm"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  />
                ) : null}
                <span className="relative z-10 inline-flex items-center gap-2">
                  <Icon className="h-5 w-5" /> {label}
                  <span className="rounded-full bg-[#6B7280] px-2 py-0.5 text-xs text-white">{count}</span>
                </span>
              </button>
            )
          })}
        </div>

        <AnimatePresence mode="wait" initial={false} custom={tabDirection}>
          {activeTab === 'repo' ? (
            <motion.div
              key="repo"
              className="space-y-4"
              custom={tabDirection}
              variants={dashboardTabPanelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="inline-flex items-center gap-2 text-[14px] text-[#A1A1A1]">
              <Eye className="h-4 w-4 text-[#6EE7B7]" /> {t('dashboard.detectActive')}: {detectionOnCount}/{repos.length}
            </p>

            <label className="relative block w-full md:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-300" />
              <input
                value={searchInput}
                onChange={(event) => {
                  triggerLoading()
                  setSearchInput(event.target.value)
                }}
                placeholder={t('dashboard.repoSearch')}
                className="h-11 w-full rounded-xl border border-white/10 bg-[#262626] pl-10 pr-3 text-sm text-gray-50 outline-none ring-green-500/45 placeholder:text-gray-300 focus:ring"
              />
            </label>
              </div>
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
                {t('dashboard.noRepos')}
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
                        <span>{t('dashboard.updated')}: {dayjs(repo.updatedAt).fromNow()}</span>
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
                            {t('dashboard.moreCount', { count: repo.branches.length - 4 })}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="inline-flex items-center gap-2 text-[12px] text-[#D1D5DB]">
                        <Eye className="h-4 w-4 text-[#34D399]" />
                        {t('dashboard.detect')}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            const nextEnabled = !repo.detectEnabled
                            setRepoDetectEnabled(cacheKey, repo.id, nextEnabled)
                            setRepos((prev) =>
                              prev.map((item) =>
                                item.id === repo.id
                                  ? { ...item, detectEnabled: nextEnabled }
                                  : item,
                              ),
                            )
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                            repo.detectEnabled ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                          aria-label={t('dashboard.detectToggle')}
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
            </motion.div>
          ) : (
            <motion.div
              key="pipeline"
              className="space-y-4"
              custom={tabDirection}
              variants={dashboardTabPanelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">{t('dashboard.totalRuns')}</p>
                  <Database className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {pipelines.length}
                </p>
              </Card>
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">{t('dashboard.successRate')}</p>
                  <Activity className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {successRate}%
                </p>
              </Card>
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">{t('dashboard.avgSecurityScore')}</p>
                  <Shield className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {avgScore} / 100
                </p>
              </Card>
              <Card className="p-4">
                <div className="flex items-start justify-between">
                  <p className="text-[14px] text-[#6B7280]">{t('dashboard.avgDuration')}</p>
                  <Clock3 className="h-6 w-6 text-[#6B7280]" />
                </div>
                <p className="mt-6 text-[32px] font-bold leading-none text-white">
                  {formatDuration(avgDuration)}
                </p>
              </Card>
            </div>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h2 className="flex h-11 items-center text-[28px] font-extrabold leading-none text-white">{t('dashboard.runHistory')}</h2>
              <label className="relative block w-full md:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-300" />
                <input
                  value={searchInput}
                  onChange={(event) => {
                    triggerLoading()
                    setSearchInput(event.target.value)
                  }}
                  placeholder={t('dashboard.repoSearch')}
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#262626] pl-10 pr-3 text-sm text-gray-50 outline-none ring-green-500/45 placeholder:text-gray-300 focus:ring"
                />
              </label>
            </div>

            <Card className="p-4">
              <p className="mb-3 text-sm text-gray-200">{t('dashboard.scoreTrend')}</p>
              <div className="h-52">
                <Line
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                      y: {
                        min: 0,
                        max: 100,
                        ticks: { color: '#d1d5db', stepSize: 25 },
                        grid: { color: 'rgba(255,255,255,0.08)' },
                      },
                      x: {
                        ticks: { color: '#d1d5db', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
                        grid: { display: false },
                      },
                    },
                  }}
                />
              </div>
            </Card>

            {isLoading || isJobsLoading ? (
              Array.from({ length: 2 }).map((_, idx) => (
                <Card key={idx} className="h-42 animate-pulse border-gray-500/60 bg-gray-700/30" />
              ))
            ) : jobsError ? (
              <Card className="p-4 text-center text-[#FCA5A5]">{jobsError}</Card>
            ) : filteredPipelines.length === 0 ? (
              <Card className="p-4 text-center text-gray-200">
                {t('dashboard.noRuns')}
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
                        ) : run.status === 'running' || run.status === 'queued' ? (
                          <Loader2 className="h-6 w-6 animate-spin text-[#FCD34D]" />
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
                            {run.status === 'running' ? t('dashboard.running') : t('dashboard.queued')}
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
                          <Shield className="h-4 w-4" /> {run.totalFindings} {t('dashboard.findings')}
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
                            <span className="text-[10px] text-[#E5E7EB]">
                              {run.currentStepName
                                ? t('dashboard.stepRunning', { step: run.currentStepName })
                                : run.status === 'queued'
                                  ? `${t('dashboard.queued')}...`
                                  : t('dashboard.runningEllipsis')}
                            </span>
                            <span className="text-[12px] text-[#FCD34D]">
                              {run.totalSteps > 0
                                ? t('dashboard.stepProgress', {
                                    completed: run.completedSteps,
                                    total: run.totalSteps,
                                  })
                                : t('dashboard.waitingResult')}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#404040]">
                            {run.totalSteps > 0 ? (
                              <div
                                className="h-full rounded-full bg-[#F59E0B] transition-all duration-500"
                                style={{
                                  width: `${Math.max(4, Math.round((run.completedSteps / run.totalSteps) * 100))}%`,
                                }}
                              />
                            ) : (
                              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#F59E0B]" />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="text-[10px] text-[#E5E7EB]">{t('dashboard.securityScore')}</span>
                            <span
                              className="text-[14px] font-semibold"
                              style={{ color: scoreTone(run.score).color }}
                            >
                              {run.score}/100
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#404040]">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.max(0, Math.min(100, run.score))}%`,
                                backgroundColor: scoreTone(run.score).color,
                              }}
                            />
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
                        aria-label={t('dashboard.viewRun')}
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
                        aria-label={t('dashboard.viewResult')}
                        title={
                          run.status === 'success' ||
                          run.status === 'failed' ||
                          run.status === 'cancelled'
                            ? t('dashboard.viewResult')
                            : t('dashboard.resultEnabledAfterDone')
                        }
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(run.jobId)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#5B5B5B] bg-[#2E2E2E] text-[#EF4444]"
                        aria-label={t('dashboard.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))
            )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t('dashboard.deleteDescription', {
                    id: deleteTarget.id,
                    name: deleteTarget.repoName || deleteTarget.jobId,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
              {t('dashboard.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!deleteTarget) {
                  return
                }
                removeTrackedJobId(cacheKey, deleteTarget.jobId)
                setPipelines((prev) => {
                  const next = prev.filter((item) => item.jobId !== deleteTarget.jobId)
                  setCachedPipelines(cacheKey, next)
                  return next
                })
                setDeleteTargetId(null)
              }}
              className="bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
            >
              {t('dashboard.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
