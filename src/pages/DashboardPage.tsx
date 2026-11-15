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
  Webhook,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  deletePipeline,
  deriveJobStatus,
  fetchPipelineHistory,
  fetchRepos,
  fetchReposWithBranches,
  fetchRepositoryWebhookStatuses,
  getCachedRepos,
  getRepoDetectEnabled,
  isGithubRateLimitError,
  isWebhookTrigger,
  removeTrackedJobId,
  setCachedRepos,
  setRepositoryWebhook,
  setRepoDetectEnabled,
  WebhookRequestError,
  type JobDetail,
  type JobVerdict,
  type PipelineHistoryItem,
  type RepositoryWebhookStatus,
} from '@/lib/api'
import { getLanguageColor } from '@/lib/languageColors'
import { PIPELINE_STAGES, stageIndexForTag } from '@/lib/pipelineExecution'
import { useAuth } from '@/contexts/AuthContext'
import { getAuthCacheKey } from '@/contexts/AuthContext'
import { useQueryClient } from '@tanstack/react-query'
import { getJobDetailsCached, prefetchRun } from '@/hooks/useJobQueries'
import type { QueryClient } from '@tanstack/react-query'
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
  /** Raw trigger_source (`webhook`, `manual`, ...). Missing on old cache entries. */
  triggerSource?: string
  /** Commit hash of the run; missing on old cache entries. */
  commitSha?: string
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

type TriggerFilter = 'all' | 'webhook' | 'manual'

type WebhookToast = {
  jobId: string
  repoName: string
  branch: string
}

const WEBHOOK_TOAST_DURATION_MS = 8000

/**
 * Localised name of the stage a failed run stopped at, from the
 * backend-reported latest step. Null when the backend did not report it.
 */
function failedStageLabel(
  run: PipelineItem,
  t: (key: string) => string,
): string | null {
  const index = stageIndexForTag(run.currentStepName)
  if (index !== null) return t(`run.stage.${PIPELINE_STAGES[index].key}`)
  return run.currentStepName || null
}

function webhookEventsLabel(status: RepositoryWebhookStatus | undefined): string {
  const events = status && status.state !== 'unknown' ? status.webhook.events : []
  return (events.length > 0 ? events : ['push']).join(', ')
}

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
    triggerSource: job.triggerSource,
    commitSha: job.commitSha,
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

function repoNameFromHistoryUrl(repoUrl: string): string {
  if (!repoUrl) return ''
  try {
    return new URL(repoUrl).pathname.replace(/^\/+|\.git$|\/+$/g, '')
  } catch {
    return repoUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$|\/+$/g, '')
  }
}

function mapHistoryToPipelineItem(
  history: PipelineHistoryItem,
  detail?: JobDetail,
): PipelineItem {
  const enriched = detail ? mapJobToPipelineItem(detail) : null

  return {
    id: shortJobId(history.jobId),
    jobId: history.jobId,
    repoName: enriched?.repoName || repoNameFromHistoryUrl(history.repoUrl),
    description: `${history.triggerSource || 'pipeline'} · ${history.branch || '-'}`,
    triggerSource: history.triggerSource || enriched?.triggerSource || '',
    commitSha: history.commitSha || enriched?.commitSha || '',
    branch: history.branch,
    durationSec: history.durationSecs || enriched?.durationSec || 0,
    status: history.status,
    score: enriched?.score ?? 0,
    verdict: enriched?.verdict ?? null,
    verdictReason: enriched?.verdictReason ?? null,
    totalFindings: enriched?.totalFindings ?? 0,
    severityCounts: enriched?.severityCounts ?? { critical: 0, high: 0, medium: 0, low: 0 },
    executedAt: history.completedAt ?? history.startedAt ?? history.createdAt ?? '',
    totalSteps: history.totalSteps,
    completedSteps: history.completedSteps,
    currentStepName: history.latestStepName,
  }
}

// Details go through the query cache: a finished run is fetched once, ever
// (persisted across restarts), so only new or still-running jobs hit the API.
async function fetchPipelineHistoryDetails(
  client: QueryClient,
  token: string,
  historyItems: PipelineHistoryItem[],
): Promise<Map<string, JobDetail>> {
  const details = await getJobDetailsCached(client, token, historyItems.map((item) => item.jobId))
  return new Map(details.map((item) => [item.jobId, item]))
}

async function enrichPipelineHistory(
  client: QueryClient,
  token: string,
  historyItems: PipelineHistoryItem[],
): Promise<PipelineItem[]> {
  const detailsById = await fetchPipelineHistoryDetails(client, token, historyItems)
  return historyItems.map((item) => mapHistoryToPipelineItem(item, detailsById.get(item.jobId)))
}

function preservePipelineSecurity(item: PipelineItem, existing?: PipelineItem): PipelineItem {
  if (!existing) return item
  return {
    ...item,
    score: existing.score,
    verdict: existing.verdict,
    verdictReason: existing.verdictReason,
    totalFindings: existing.totalFindings,
    severityCounts: existing.severityCounts,
  }
}

const PIPELINE_CACHE_PREFIX = 'secupipeline:pipeline-items:'
const TERMINAL_PIPELINE_STATUS = new Set(['success', 'failed', 'cancelled'])
const HISTORY_PAGE_SIZE = 20

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

function scoreTone(score: number): { color: string } {
  if (score >= 80) return { color: '#22C55E' }
  if (score >= 50) return { color: '#F97316' }
  return { color: '#EF4444' }
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { token, user, isLoading: isAuthLoading, logout } = useAuth()
  const queryClient = useQueryClient()
  const { locale, t } = useLanguage()
  const cacheKey = getAuthCacheKey(token, user)
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
    () => isAuthLoading || (!!token && !getCachedRepos(cacheKey)),
  )
  const [isJobsLoading, setIsJobsLoading] = useState(
    isAuthLoading,
  )
  const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const [isDeletingPipeline, setIsDeletingPipeline] = useState(false)
  const [reposError, setReposError] = useState<string | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [webhookUpdatingRepoId, setWebhookUpdatingRepoId] = useState<string | null>(null)
  const [webhookError, setWebhookError] = useState<{
    message: string
    isPermission: boolean
  } | null>(null)
  // Server-side webhook state per repository full name. Missing = not loaded
  // yet; `unknown` = lookup failed → keep the locally cached toggle value.
  const [webhookStatuses, setWebhookStatuses] = useState<
    Record<string, RepositoryWebhookStatus>
  >({})
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all')
  const [webhookToasts, setWebhookToasts] = useState<WebhookToast[]>([])
  // Job ids already seen by history polling; anything new that came from a
  // webhook raises a toast.
  const knownJobIdsRef = useRef<Set<string> | null>(null)
  const loadingTimerRef = useRef<number | null>(null)
  const historyRepoQuery = activeTab === 'pipeline' ? searchKeyword : ''

  useEffect(() => {
    dayjs.locale(locale)
  }, [locale])

  const dismissWebhookToast = useCallback((jobId: string) => {
    setWebhookToasts((prev) => prev.filter((toast) => toast.jobId !== jobId))
  }, [])

  const pushWebhookToasts = useCallback(
    (items: WebhookToast[]) => {
      if (items.length === 0) return
      setWebhookToasts((prev) => {
        const existing = new Set(prev.map((toast) => toast.jobId))
        // Keep the stack short: newest three only.
        return [...items.filter((item) => !existing.has(item.jobId)), ...prev].slice(0, 3)
      })
      for (const item of items) {
        window.setTimeout(() => dismissWebhookToast(item.jobId), WEBHOOK_TOAST_DURATION_MS)
      }
    },
    [dismissWebhookToast],
  )

  // Only the set of names matters; repos is replaced again once branches load.
  const repoNamesKey = useMemo(
    () => repos.map((repo) => repo.name).filter(Boolean).sort().join('\n'),
    [repos],
  )

  useEffect(() => {
    if (isAuthLoading || !token || !repoNamesKey) return
    let mounted = true
    fetchRepositoryWebhookStatuses(token, repoNamesKey.split('\n'))
      .then((statuses) => {
        if (mounted) setWebhookStatuses(Object.fromEntries(statuses))
      })
      .catch((error: unknown) => {
        if (!mounted) return
        if (error instanceof AuthExpiredError) {
          logout()
          navigate('/auth', { replace: true })
          return
        }
        console.warn('[DashboardPage] webhook status lookup failed:', error)
      })
    return () => {
      mounted = false
    }
  }, [token, isAuthLoading, repoNamesKey, logout, navigate])

  // Reflect the server's webhook state in the 탐지 toggles (and their cache).
  useEffect(() => {
    const updates = new Map<string, boolean>()
    for (const repo of repos) {
      const status = webhookStatuses[repo.name]
      if (!status || status.state === 'unknown') continue
      const enabled = status.state === 'on'
      if (repo.detectEnabled !== enabled) updates.set(repo.id, enabled)
    }
    if (updates.size === 0) return
    updates.forEach((enabled, repoId) => setRepoDetectEnabled(cacheKey, repoId, enabled))
    setRepos((prev) =>
      prev.map((repo) =>
        updates.has(repo.id) ? { ...repo, detectEnabled: updates.get(repo.id)! } : repo,
      ),
    )
  }, [webhookStatuses, repos, cacheKey])

  useEffect(() => {
    if (isAuthLoading) {
      setIsReposLoading(true)
      return
    }

    if (!token) {
      setRepos([])
      setIsReposLoading(false)
      return
    }

    let mounted = true
    const cached = getCachedRepos(cacheKey)
    if (cached) {
      setRepos(
        cached.map((repo) => ({
          ...repo,
          detectEnabled: getRepoDetectEnabled(cacheKey, repo.id),
        })),
      )
    } else {
      setRepos([])
    }
    setIsReposLoading(!cached)
    setReposError(null)

    fetchRepos(token)
      .then((baseRepos) => {
        if (mounted) {
          const hydrated = baseRepos.map((repo) => ({
            ...repo,
            detectEnabled: getRepoDetectEnabled(cacheKey, repo.id),
          }))
          setRepos(hydrated)
          setCachedRepos(cacheKey, baseRepos)
          setIsReposLoading(false)
        }
        return fetchReposWithBranches(token, baseRepos)
      })
      .then((enrichedRepos) => {
        if (!mounted) return
        const hydrated = enrichedRepos.map((repo) => ({
          ...repo,
          detectEnabled: getRepoDetectEnabled(cacheKey, repo.id),
        }))
        setRepos(hydrated)
        setCachedRepos(cacheKey, enrichedRepos)
      })
      .catch((error: unknown) => {
        if (!mounted) return
        if (error instanceof AuthExpiredError) {
          console.warn('[DashboardPage] auth expired — redirecting to login')
          logout()
          navigate('/auth', { replace: true })
          return
        }
        const cached = getCachedRepos(cacheKey)
        if (isGithubRateLimitError(error) && cached && cached.length > 0) {
          setRepos(
            cached.map((repo) => ({
              ...repo,
              detectEnabled: getRepoDetectEnabled(cacheKey, repo.id),
            })),
          )
          setReposError(null)
          return
        }
        setReposError(
          error instanceof Error ? error.message : '레포지토리를 불러오지 못했습니다.',
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
  }, [token, cacheKey, isAuthLoading, logout, navigate])

  useEffect(() => {
    if (isAuthLoading) {
      setIsJobsLoading(true)
      return
    }

    if (!token) {
      setPipelines([])
      setHistoryTotal(0)
      setHistoryHasMore(false)
      setHasLoadedHistory(false)
      setIsJobsLoading(false)
      return
    }

    let cancelled = false
    let timer: number | null = null
    const cached = getCachedPipelines(cacheKey)
    if (cached.length > 0) setPipelines(cached)
    setIsJobsLoading(cached.length === 0)
    setJobsError(null)

    async function tick(initial: boolean) {
      try {
        const response = await fetchPipelineHistory(token!, {
          repo: historyRepoQuery,
          limit: HISTORY_PAGE_SIZE,
          offset: 0,
        })
        const fetchedItems = response.items.map((item) => mapHistoryToPipelineItem(item))
        if (cancelled) return

        // The first page establishes the baseline; later polls toast only
        // runs that appeared since and were started by a GitHub webhook.
        const known = knownJobIdsRef.current
        if (initial || !known) {
          knownJobIdsRef.current = new Set(fetchedItems.map((item) => item.jobId))
        } else {
          const fresh = fetchedItems.filter((item) => !known.has(item.jobId))
          fresh.forEach((item) => known.add(item.jobId))
          pushWebhookToasts(
            fresh
              .filter((item) => isWebhookTrigger(item.triggerSource))
              .map((item) => ({
                jobId: item.jobId,
                repoName: item.repoName,
                branch: item.branch,
              })),
          )
        }

        setPipelines((previous) => {
          const previousById = new Map(previous.map((item) => [item.jobId, item]))
          const refreshedItems = fetchedItems.map((item) =>
            preservePipelineSecurity(item, previousById.get(item.jobId)),
          )

          if (initial) {
            setCachedPipelines(cacheKey, refreshedItems)
            return refreshedItems
          }

          const fetchedIds = new Set(refreshedItems.map((item) => item.jobId))
          const merged = [
            ...refreshedItems,
            ...previous.filter((item) => !fetchedIds.has(item.jobId)),
          ]
          setCachedPipelines(cacheKey, merged)
          setHistoryHasMore(merged.length < response.total)
          return merged
        })
        setHistoryTotal(response.total)
        if (initial) setHistoryHasMore(response.hasMore)
        setHasLoadedHistory(true)
        setJobsError(null)

        if (initial && response.items.length > 0) {
          const historyById = new Map(response.items.map((item) => [item.jobId, item]))
          void fetchPipelineHistoryDetails(queryClient, token!, response.items).then((detailsById) => {
            if (cancelled || detailsById.size === 0) return
            setPipelines((previous) => {
              const enriched = previous.map((item) => {
                const history = historyById.get(item.jobId)
                const detail = detailsById.get(item.jobId)
                return history && detail ? mapHistoryToPipelineItem(history, detail) : item
              })
              setCachedPipelines(cacheKey, enriched)
              return enriched
            })
          })
        }

        const hasActive = response.items.some((item) => !TERMINAL_PIPELINE_STATUS.has(item.status))
        if (!cancelled) {
          timer = window.setTimeout(() => tick(false), hasActive ? 3000 : 10000)
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof AuthExpiredError) {
          logout()
          navigate('/auth', { replace: true })
          return
        }
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
  }, [token, cacheKey, historyRepoQuery, isAuthLoading, logout, navigate, pushWebhookToasts, queryClient])

  const loadMoreHistory = async () => {
    if (!token || isHistoryLoadingMore || !historyHasMore) return

    setIsHistoryLoadingMore(true)
    setJobsError(null)
    try {
      const response = await fetchPipelineHistory(token, {
        repo: searchKeyword,
        limit: HISTORY_PAGE_SIZE,
        offset: pipelines.length,
      })
      const nextItems = await enrichPipelineHistory(queryClient, token, response.items)
      setPipelines((previous) => {
        const previousIds = new Set(previous.map((item) => item.jobId))
        const merged = [...previous, ...nextItems.filter((item) => !previousIds.has(item.jobId))]
        setCachedPipelines(cacheKey, merged)
        return merged
      })
      setHistoryTotal(response.total)
      setHistoryHasMore(response.hasMore)
      setHasLoadedHistory(true)
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        logout()
        navigate('/auth', { replace: true })
        return
      }
      setJobsError(
        error instanceof Error ? error.message : '파이프라인 히스토리를 불러오지 못했습니다.',
      )
    } finally {
      setIsHistoryLoadingMore(false)
    }
  }

  const confirmDeletePipeline = async () => {
    if (!token || !deleteTarget || isDeletingPipeline) return

    setIsDeletingPipeline(true)
    setDeleteError(null)
    try {
      await deletePipeline(token, deleteTarget.jobId)
      removeTrackedJobId(cacheKey, deleteTarget.jobId)
      setPipelines((previous) => {
        const next = previous.filter((item) => item.jobId !== deleteTarget.jobId)
        setCachedPipelines(cacheKey, next)
        return next
      })
      setHistoryTotal((previous) => Math.max(0, previous - 1))
      setDeleteTargetId(null)
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        logout()
        navigate('/auth', { replace: true })
        return
      }
      setDeleteError(error instanceof Error ? error.message : '파이프라인을 삭제하지 못했습니다.')
    } finally {
      setIsDeletingPipeline(false)
    }
  }

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

  const triggerCounts = useMemo(() => {
    const webhook = pipelines.filter((item) => isWebhookTrigger(item.triggerSource)).length
    return { all: pipelines.length, webhook, manual: pipelines.length - webhook }
  }, [pipelines])

  const filteredPipelines = useMemo(
    () =>
      pipelines.filter((item) => {
        const fromWebhook = isWebhookTrigger(item.triggerSource)
        if (triggerFilter === 'webhook' && !fromWebhook) return false
        if (triggerFilter === 'manual' && fromWebhook) return false
        const text = `${item.repoName} ${item.description}`.toLowerCase()
        return text.includes(searchKeyword.toLowerCase())
      }),
    [pipelines, searchKeyword, triggerFilter],
  )

  const triggerLabel = (source: string | undefined) => {
    if (isWebhookTrigger(source)) return t('dashboard.trigger.webhook')
    if (!source || source === 'manual') return t('dashboard.trigger.manual')
    return source
  }

  const deleteTarget = useMemo(
    () => pipelines.find((item) => item.jobId === deleteTargetId) ?? null,
    [deleteTargetId, pipelines],
  )

  const detectionOnCount = repos.filter((repo) => repo.detectEnabled).length
  const totalPipelines = pipelines.length
  const successCount = pipelines.filter((item) => item.status === 'success').length
  const successRate = totalPipelines === 0 ? 0 : Math.round((successCount / totalPipelines) * 100)
  const scoredPipelines = pipelines.filter(
    (item) => item.status === 'success' || item.status === 'failed',
  )
  const avgScore =
    scoredPipelines.length === 0
      ? 0
      : Math.round(
          scoredPipelines.reduce((sum, item) => sum + item.score, 0) / scoredPipelines.length,
        )
  const avgDuration =
    totalPipelines === 0
      ? 0
      : Math.round(pipelines.reduce((sum, item) => sum + item.durationSec, 0) / totalPipelines)

  const chartPipelines = useMemo(
    () => [...pipelines]
      .filter((item) => item.status === 'success' || item.status === 'failed')
      .reverse()
      .slice(-20),
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
            { key: 'pipeline', label: t('dashboard.pipelineTab'), icon: Activity, count: hasLoadedHistory ? historyTotal : pipelines.length },
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
            {webhookError ? (
              <Card
                role="alert"
                className="flex flex-col gap-3 border-[#7F1D1D] bg-[#2A1515] p-4 text-[13px] text-[#FCA5A5] md:flex-row md:items-start md:justify-between"
              >
                <p className="whitespace-pre-line break-words">{webhookError.message}</p>
                <div className="flex shrink-0 gap-2">
                  {webhookError.isPermission ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setWebhookError(null)
                        logout()
                        navigate('/auth', { replace: true })
                      }}
                    >
                      {t('dashboard.reLogin')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-[#FCA5A5] hover:bg-white/10"
                    onClick={() => setWebhookError(null)}
                  >
                    {t('dashboard.close')}
                  </Button>
                </div>
              </Card>
            ) : null}
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
                        {webhookStatuses[repo.name]?.state === 'on' ? (
                          <Badge
                            className="border-[#6EE7B7] bg-[#065F46] text-[#6EE7B7]"
                            title={t('dashboard.webhookOnTooltip', {
                              events: webhookEventsLabel(webhookStatuses[repo.name]),
                            })}
                          >
                            <Webhook className="mr-1 h-3 w-3" /> {t('dashboard.webhookOn')}
                          </Badge>
                        ) : webhookStatuses[repo.name]?.state === 'unknown' ? (
                          <Badge
                            className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]"
                            title={t('dashboard.webhookUnknownTooltip')}
                          >
                            <Webhook className="mr-1 h-3 w-3" /> {t('dashboard.webhookUnknown')}
                          </Badge>
                        ) : null}
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
                          onClick={async (event) => {
                            event.stopPropagation()
                            const nextEnabled = !repo.detectEnabled
                            if (!token || webhookUpdatingRepoId) return
                            setWebhookUpdatingRepoId(repo.id)
                            setRepoDetectEnabled(cacheKey, repo.id, nextEnabled)
                            setRepos((prev) =>
                              prev.map((item) =>
                                item.id === repo.id
                                  ? { ...item, detectEnabled: nextEnabled }
                                  : item,
                              ),
                            )
                            try {
                              const webhook = await setRepositoryWebhook(
                                token,
                                repo.name,
                                nextEnabled,
                              )
                              if (webhook.enabled !== nextEnabled) {
                                throw new Error('서버가 요청한 웹훅 상태를 반영하지 않았습니다.')
                              }
                              setWebhookStatuses((prev) => ({
                                ...prev,
                                [repo.name]: {
                                  state: webhook.enabled ? 'on' : 'off',
                                  webhook,
                                },
                              }))
                              setWebhookError(null)
                            } catch (error) {
                              setRepoDetectEnabled(cacheKey, repo.id, !nextEnabled)
                              setRepos((prev) =>
                                prev.map((item) =>
                                  item.id === repo.id
                                    ? { ...item, detectEnabled: !nextEnabled }
                                    : item,
                                ),
                              )
                              if (error instanceof AuthExpiredError) {
                                logout()
                                navigate('/auth', { replace: true })
                                return
                              }
                              // Separate from reposError so a webhook failure
                              // doesn't replace the whole repository list.
                              setWebhookError({
                                message: `${repo.name}: ${
                                  error instanceof Error
                                    ? error.message
                                    : '저장소 웹훅 설정을 변경하지 못했습니다.'
                                }`,
                                isPermission:
                                  error instanceof WebhookRequestError &&
                                  error.isPermissionError,
                              })
                            } finally {
                              setWebhookUpdatingRepoId(null)
                            }
                          }}
                          disabled={webhookUpdatingRepoId === repo.id}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:cursor-wait ${
                            repo.detectEnabled ? 'bg-green-500' : 'bg-gray-500'
                          }`}
                          role="switch"
                          aria-checked={repo.detectEnabled}
                          aria-busy={webhookUpdatingRepoId === repo.id}
                          aria-label={t('dashboard.detectToggle')}
                        >
                          <span
                            className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white transition ${
                              repo.detectEnabled ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          >
                            {webhookUpdatingRepoId === repo.id ? (
                              <Loader2 className="h-3 w-3 animate-spin text-gray-500" />
                            ) : null}
                          </span>
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
                  {historyTotal}
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

            <div className="flex flex-wrap gap-2" role="group" aria-label="trigger filter">
              {(['all', 'webhook', 'manual'] as const).map((key) => {
                const active = triggerFilter === key
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTriggerFilter(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                      active
                        ? 'border-[#6EE7B7] bg-[#065F46] text-[#6EE7B7]'
                        : 'border-white/15 bg-[#2E2E2E] text-[#9CA3AF] hover:text-gray-100'
                    }`}
                  >
                    {key === 'webhook' ? <Webhook className="h-3.5 w-3.5" /> : null}
                    {t(`dashboard.trigger.${key}`)}
                    <span className="opacity-70">{triggerCounts[key]}</span>
                  </button>
                )
              })}
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
              <>
              {filteredPipelines.map((run) => (
                <Card
                  key={run.jobId}
                  className="border-white/10 bg-[#262626] p-4"
                  // Prefetch the result while the pointer is on the row, so the
                  // result page opens from cache.
                  onMouseEnter={() => {
                    if (run.status === 'success' || run.status === 'failed' || run.status === 'cancelled') {
                      prefetchRun(queryClient, token, run.jobId)
                    }
                  }}
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
                        {run.status === 'failed' ? (
                          <Badge
                            className="border-[#FCA5A5] bg-transparent px-2 py-0.5 text-[11px] text-[#FCA5A5]"
                            title={t('dashboard.runFailedHint')}
                          >
                            {failedStageLabel(run, t)
                              ? t('dashboard.runFailedAt', { stage: failedStageLabel(run, t)! })
                              : t('dashboard.runFailed')}
                          </Badge>
                        ) : null}
                        {run.status !== 'cancelled' && run.verdict ? (
                          <Badge
                            className={`px-2 py-0.5 text-[11px] ${verdictMeta[run.verdict].className}`}
                            title={run.verdictReason ?? undefined}
                          >
                            {t('dashboard.securityVerdict')} {verdictMeta[run.verdict].label}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 flex items-center gap-2 text-[12px] text-[#6B7280]">
                        {isWebhookTrigger(run.triggerSource) ? (
                          <Badge className="border-[#A5B4FC] bg-[#312E81] px-2 py-0.5 text-[11px] text-[#C7D2FE]">
                            <Webhook className="mr-1 h-3 w-3" />
                            {t('dashboard.trigger.webhook')}
                          </Badge>
                        ) : (
                          <span>{triggerLabel(run.triggerSource)}</span>
                        )}
                        <span>· {run.branch || '-'}</span>
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-[#6B7280]">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-4.5 w-4.5 text-[#6B7280]" />
                        </span>
                        <Badge className="border-[#6EE7B7] bg-[#065F46] px-3 py-1 text-[12px] text-[#6EE7B7]">
                          {run.branch || '-'}
                        </Badge>
                        {run.commitSha ? (
                          <span
                            className="font-mono text-[12px] text-[#6B7280]"
                            title={run.commitSha}
                          >
                            {run.commitSha.slice(0, 7)}
                          </span>
                        ) : null}
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
                      ) : run.status === 'cancelled' ? (
                        <p className="text-[12px] text-[#9CA3AF]">
                          {t('dashboard.cancelledNoScore')}
                        </p>
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
                              commitSha: run.commitSha,
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
              ))}
              {historyHasMore ? (
                <div className="flex justify-center pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isHistoryLoadingMore}
                    onClick={() => void loadMoreHistory()}
                  >
                    {isHistoryLoadingMore ? t('dashboard.loadingMore') : t('dashboard.loadMore')}
                  </Button>
                </div>
              ) : null}
              </>
            )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div
        className="pointer-events-none fixed right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {webhookToasts.map((toast) => (
            <motion.div
              key={toast.jobId}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto"
            >
              <Card role="status" className="flex items-start gap-3 border-[#4338CA] bg-[#1E1B4B] p-3">
                <Webhook className="mt-0.5 h-5 w-5 shrink-0 text-[#A5B4FC]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#E0E7FF]">
                    {t('dashboard.webhookToastTitle')}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[#A5B4FC]">
                    {toast.repoName || toast.jobId} · {toast.branch || '-'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      dismissWebhookToast(toast.jobId)
                      navigate('/pipeline/progress', {
                        state: {
                          jobId: toast.jobId,
                          repoName: toast.repoName,
                          branch: toast.branch,
                        },
                      })
                    }}
                    className="mt-2 text-[12px] font-semibold text-[#C7D2FE] underline underline-offset-2 hover:text-white"
                  >
                    {t('dashboard.webhookToastView')}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => dismissWebhookToast(toast.jobId)}
                  className="rounded-md p-1 text-[#A5B4FC] hover:bg-white/10 hover:text-white"
                  aria-label={t('dashboard.close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeletingPipeline) {
            setDeleteTargetId(null)
            setDeleteError(null)
          }
        }}
      >
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
            {deleteError ? <p className="mt-2 text-sm text-[#FCA5A5]">{deleteError}</p> : null}
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={isDeletingPipeline}
              onClick={() => {
                setDeleteTargetId(null)
                setDeleteError(null)
              }}
            >
              {t('dashboard.cancel')}
            </Button>
            <Button
              disabled={isDeletingPipeline}
              onClick={() => void confirmDeletePipeline()}
              className="bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
            >
              {isDeletingPipeline ? t('dashboard.deleting') : t('dashboard.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
