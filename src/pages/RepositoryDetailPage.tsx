import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  ArrowUpRight,
  Ban,
  Check,
  CheckCircle2,
  CircleEllipsis,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  Globe,
  Loader2,
  Pencil,
  Rocket,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getJobDetailCached, getJobDetailsCached, getPipelineStepsCached } from '@/hooks/useJobQueries'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { type RepositoryItem } from '@/data/repositories'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GitHubIcon } from '@/components/ui/github-icon'
import { useAuth } from '@/contexts/AuthContext'
import { getAuthCacheKey } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  AuthExpiredError,
  deriveJobStatus,
  fetchGithubRepoExtras,
  fetchLatestCommit,
  fetchDeploymentSettings,
  fetchPipelineDeployment,
  fetchPipelineHistory,
  fetchLatestRepoHistory,
  fetchReposWithBranches,
  getCachedRepos,
  getRepoDomainUrl,
  getRepoExternalDomainUrl,
  getRepoPipelineInfo,
  getTrackedJobIds,
  normalizeHttpUrl,
  repoNameFromUrl,
  saveDeploymentSettings,
  setCachedRepos,
  setRepoDomainUrl,
  setRepoExternalDomainUrl,
  type GitHubCommitInfo,
  type JobDetail,
  type PipelineHistoryItem,
} from '@/lib/api'
import { buildStageViews, summarizeProgress, type StageStatus } from '@/lib/pipelineExecution'
import { parseGateMessage } from '@/lib/gateMessage'

dayjs.extend(relativeTime)
dayjs.locale('ko')

const pipelineStatusMeta = {
  success: {
    className: 'border-[#3ECF8E] bg-[#065F46] text-[#6EE7B7]',
    icon: CheckCircle2,
  },
  failed: {
    className: 'border-[#F87171] bg-[#7F1D1D] text-[#FCA5A5]',
    icon: XCircle,
  },
  running: {
    className: 'border-[#60A5FA] bg-[#1E3A8A] text-[#BFDBFE]',
    icon: Loader2,
  },
  queued: {
    className: 'border-[#6B7280] bg-[#374151] text-[#D1D5DB]',
    icon: Clock,
  },
  cancelled: {
    className: 'border-[#6B7280] bg-[#374151] text-[#D1D5DB]',
    icon: Ban,
  },
  // Pipeline ran fine but the security gate stopped the deploy.
  blocked: {
    className: 'border-[#F87171] bg-[#7F1D1D] text-[#FCA5A5]',
    icon: ShieldAlert,
  },
  pending: {
    className: 'border-[#F59E0B] bg-[#78350F] text-[#FCD34D]',
    icon: CircleEllipsis,
  },
} as const

type PipelineStatusKey = keyof typeof pipelineStatusMeta

const stageSegmentClass: Record<StageStatus, string> = {
  success: 'bg-[#34D399]',
  failed: 'bg-[#F87171]',
  running: 'bg-[#60A5FA] animate-pulse',
  cancelled: 'bg-[#6B7280]',
  skipped: 'bg-[#3A3A3A]',
  pending: 'bg-[#3A3A3A]',
}

const severityDotClass = {
  critical: 'bg-[#EF4444]',
  high: 'bg-[#F97316]',
  medium: 'bg-[#EAB308]',
  low: 'bg-[#22C55E]',
} as const

// Re-poll interval while the latest run is still queued/running.
const LIVE_REFRESH_MS = 5000

// Sort by createdAt — that's when the user *requested* the run, which is
// the most stable "latest" signal. Completed/started timestamps can disagree
// (long-running failed job finishing after a quick success started later).
function timestampMs(item: Pick<JobDetail, 'createdAt' | 'startedAt' | 'completedAt'>): number {
  const candidate = item.createdAt ?? item.startedAt ?? item.completedAt ?? ''
  const parsed = Date.parse(candidate)
  return Number.isNaN(parsed) ? 0 : parsed
}

// Minimal JobDetail from a history row, used when /api/jobs/{id} fails.
function historyItemToJobDetail(item: PipelineHistoryItem): JobDetail {
  return {
    jobId: item.jobId,
    repoUrl: item.repoUrl,
    repoName: repoNameFromUrl(item.repoUrl),
    branch: item.branch,
    triggerSource: item.triggerSource,
    commitSha: item.commitSha,
    triggeredBy: '',
    status: item.status,
    overallResult: item.overallResult,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    durationSecs: item.durationSecs,
    steps: [],
    verdict: null,
    verdictReason: null,
    totalFindings: 0,
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    summaries: [],
    securityScore: 100,
  }
}

type LatestRunLookup = {
  repoName: string
  job: JobDetail | null
  /** Most recent successful run — the one whose deployment is "live". */
  latestSuccessJobId: string | null
}

// Latest pipeline run for a repository. The backend history is the source
// of truth (it includes webhook-triggered runs and runs from other devices);
// the locally tracked job ids are only a fallback when history is
// unavailable or empty.
async function loadLatestRun(
  client: QueryClient,
  token: string,
  cacheKey: string,
  repoName: string,
): Promise<LatestRunLookup> {
  const repoKey = repoName.toLowerCase()
  let job: JobDetail | null = null
  let latestSuccessJobId: string | null = null

  try {
    const history = await fetchPipelineHistory(token, { repo: repoName, limit: 20 })
    const items = history.items
      .filter((item) => repoNameFromUrl(item.repoUrl).toLowerCase() === repoKey)
      .sort((a, b) => timestampMs(b) - timestampMs(a))
    // History matches by substring ("sample_java" also hits "sample_java6"), so
    // other repos can push this one off the first page — page through then.
    const head = items[0] ?? (history.hasMore ? await fetchLatestRepoHistory(token, repoName) : null)
    latestSuccessJobId =
      items.find((item) => item.status === 'success')?.jobId ??
      (head?.status === 'success'
        ? head.jobId
        : history.hasMore
          ? (await fetchLatestRepoHistory(token, repoName, 'success').catch(() => null))?.jobId ?? null
          : null)
    if (head) {
      const detail = await getJobDetailCached(client, token, head.jobId).catch(() => null)
      job = detail ?? historyItemToJobDetail(head)
    }
  } catch {
    // fall through to the tracked-id fallback
  }

  if (!job) {
    const trackedIds = getTrackedJobIds(cacheKey)
    if (trackedIds.length > 0) {
      const jobs = await getJobDetailsCached(client, token, trackedIds).catch(() => [] as JobDetail[])
      const repoJobs = jobs
        .filter((item) => item.repoName.toLowerCase() === repoKey)
        .sort((a, b) => timestampMs(b) - timestampMs(a))
      job = repoJobs[0] ?? null
      latestSuccessJobId ??= repoJobs.find((item) => item.status === 'success')?.jobId ?? null
    }
  }

  // Some backends omit steps from /api/jobs/{id}; the steps endpoint has them.
  if (job && job.steps.length === 0) {
    const steps = await getPipelineStepsCached(client, token, job.jobId).catch(() => null)
    if (steps && steps.steps.length > 0) job = { ...job, steps: steps.steps }
  }

  return { repoName, job, latestSuccessJobId }
}

function DomainRow({
  label,
  icon,
  url,
  emptyText,
  hint,
  actions,
}: {
  label: string
  icon: ReactNode
  url: string
  emptyText: string
  hint?: string
  actions?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[12px] text-[#6B7280]">
          {icon}
          {label}
        </p>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[14px] text-[#D1D5DB]">
        <Globe className="h-4 w-4 shrink-0 text-[#34D399]" />
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 break-all text-[#34D399] underline-offset-4 hover:underline"
          >
            {url}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
          </a>
        ) : (
          <span className="text-[#9CA3AF]">{emptyText}</span>
        )}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-[#6B7280]">{hint}</p> : null}
    </div>
  )
}

const smallButtonClass =
  'inline-flex items-center gap-1 rounded-md border border-[#3A3A3A] bg-[#262626] px-2 py-0.5 text-[11px] text-[#9CA3AF] hover:border-[#6B7280] hover:text-[#D1D5DB] disabled:cursor-not-allowed disabled:opacity-40'

function parseOwnerRepo(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo] = fullName.split('/')
  if (!owner || !repo) return null
  return { owner, repo }
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard copy failed')
}

export function RepositoryDetailPage() {
  const { state } = useLocation()
  const { repoId: paramRepoId = '' } = useParams()
  const { token, user, logout } = useAuth()
  const { locale, t } = useLanguage()
  const navigate = useNavigate()
  const cacheKey = getAuthCacheKey(token, user)

  const locationState = (state ?? {}) as { repoId?: string }
  const resolvedRepoId = locationState.repoId ?? paramRepoId ?? ''

  const [repo, setRepo] = useState<RepositoryItem | null>(() => {
    if (!resolvedRepoId) return null
    const cached = getCachedRepos(cacheKey)
    return cached?.find((item) => item.id === resolvedRepoId) ?? null
  })
  const [isRepoLoading, setIsRepoLoading] = useState(
    () => !!token && !!resolvedRepoId && !repo,
  )
  const [latestCommit, setLatestCommit] = useState<GitHubCommitInfo | null>(null)
  // Branch list + push time fetched fresh from GitHub (public repos).
  const [githubBranches, setGithubBranches] = useState<string[] | null>(null)
  const [githubPushedAt, setGithubPushedAt] = useState<string | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  // Deployment URL sources are resolved automatically: backend deployment,
  // the pipeline's cached URL, then GitHub's configured repository homepage.
  const [githubHomepageUrl, setGithubHomepageUrl] = useState<string | null>(null)
  const [deploymentLookup, setDeploymentLookup] = useState<{
    repoName: string
    url: string | null
    jobId: string | null
  } | null>(null)
  const [copiedKey, setCopiedKey] = useState<'platform' | 'external' | null>(null)
  // External (non-SecuPipeline) deployment URL entered by the user.
  // Local edits override storage; keyed by repo so navigation resets them.
  const [externalOverride, setExternalOverride] = useState<{ repoName: string; url: string } | null>(null)
  const [isEditingExternal, setIsEditingExternal] = useState(false)
  const [externalDraft, setExternalDraft] = useState('')
  const [externalError, setExternalError] = useState<string | null>(null)
  const [isSavingExternal, setIsSavingExternal] = useState(false)

  useEffect(() => {
    dayjs.locale(locale)
  }, [locale])

  // If the repo isn't in cache (e.g. direct navigation / page refresh),
  // fetch the user's repos and look it up.
  useEffect(() => {
    if (!token || !resolvedRepoId || repo) {
      setIsRepoLoading(false)
      return
    }

    let cancelled = false
    setIsRepoLoading(true)
    setRepoError(null)

    fetchReposWithBranches(token)
      .then((list) => {
        if (cancelled) return
        setCachedRepos(cacheKey, list)
        const found = list.find((item) => item.id === resolvedRepoId) ?? null
        setRepo(found)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof AuthExpiredError) {
          logout()
          navigate('/auth', { replace: true })
          return
        }
        setRepoError(
          error instanceof Error
            ? error.message
            : '레포지토리 정보를 불러오지 못했습니다.',
        )
      })
      .finally(() => {
        if (!cancelled) setIsRepoLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, resolvedRepoId, cacheKey, repo, logout, navigate])

  // External deployment URL saved on the server (deployment-settings).
  // localStorage stays as an offline cache of the last known value.
  useEffect(() => {
    if (!token || !repo) return
    const parsed = parseOwnerRepo(repo.name)
    if (!parsed) return
    let cancelled = false
    fetchDeploymentSettings(token, parsed.owner, parsed.repo)
      .then((settings) => {
        if (cancelled || !settings) return
        setRepoExternalDomainUrl(cacheKey, repo.name, settings.externalUrl)
        setExternalOverride({ repoName: repo.name, url: settings.externalUrl })
      })
      .catch(() => {
        // keep the cached value
      })
    return () => {
      cancelled = true
    }
  }, [token, cacheKey, repo])

  // This repo's most recent pipeline run (backend history first), cached per
  // repo and persisted: the status card renders instantly from the last known
  // state, then refreshes in the background — every 5s while a run is live.
  const queryClient = useQueryClient()
  const repoName = repo?.name ?? ''
  const latestRunQuery = useQuery({
    queryKey: ['repo-latest-run', cacheKey, repoName],
    queryFn: () => loadLatestRun(queryClient, token!, cacheKey, repoName),
    enabled: !!token && !!repoName,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status
      return status === 'queued' || status === 'running' ? LIVE_REFRESH_MS : false
    },
  })
  const latestRun = latestRunQuery.data ?? null

  const latestJob = latestRun && repo && latestRun.repoName === repo.name ? latestRun.job : null
  const latestSuccessJobId =
    latestRun && repo && latestRun.repoName === repo.name ? latestRun.latestSuccessJobId : null

  // Best-effort fetch of the latest commit on the repo's default branch.
  // The backend's documented surface doesn't include a commits endpoint, so
  // this may 404 — we render a placeholder in that case.
  useEffect(() => {
    if (!token || !repo) {
      setLatestCommit(null)
      return
    }
    const parsed = parseOwnerRepo(repo.name)
    const branch = repo.source.branch || repo.branches[0]
    if (!parsed || !branch) {
      setLatestCommit(null)
      return
    }

    let cancelled = false

    fetchLatestCommit(token, parsed.owner, parsed.repo, branch)
      .then((commit) => {
        if (!cancelled) setLatestCommit(commit)
      })
      .catch(() => {
        if (!cancelled) setLatestCommit(null)
      })

    // Refresh branch list + push time straight from GitHub (public repos).
    fetchGithubRepoExtras(parsed.owner, parsed.repo, token ?? undefined)
      .then((extras) => {
        if (cancelled) return
        if (extras.branches.length > 0) setGithubBranches(extras.branches)
        if (extras.pushedAt) setGithubPushedAt(extras.pushedAt)
        setGithubHomepageUrl(extras.homepageUrl)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [token, repo])

  // SecuPipeline deployment URL recorded by the backend. The latest run is
  // tried first; if it did not deploy (failed / still running), the most
  // recent successful run's deployment is what is actually live.
  const latestJobId = latestJob?.jobId ?? null
  useEffect(() => {
    if (!token || !repo) return
    const candidates = [latestJobId, latestSuccessJobId].filter(
      (id, index, list): id is string => !!id && list.indexOf(id) === index,
    )
    if (candidates.length === 0) return

    let cancelled = false
    ;(async () => {
      for (const jobId of candidates) {
        const deployment = await fetchPipelineDeployment(token, jobId).catch(() => ({ url: null }))
        if (cancelled) return
        if (deployment.url) {
          setDeploymentLookup({ repoName: repo.name, url: deployment.url, jobId })
          setRepoDomainUrl(cacheKey, repo.name, deployment.url)
          return
        }
      }
      if (!cancelled) setDeploymentLookup({ repoName: repo.name, url: null, jobId: null })
    })()

    return () => {
      cancelled = true
    }
  }, [token, latestJobId, latestSuccessJobId, repo, cacheKey])

  // Use considerVerdict=false here: the "파이프라인 최근 상태" badge reflects
  // whether the pipeline EXECUTED successfully, not whether the security
  // scan exceeded its threshold. The verdict is a separate concern surfaced
  // on the dashboard.
  const runSummary = useMemo(() => {
    if (!latestJob) return null
    const status = deriveJobStatus(latestJob, { considerVerdict: false })
    const stages = buildStageViews(latestJob.steps, status)
    const progress = summarizeProgress(stages)
    return {
      status,
      stages,
      progress,
      failedStage: stages.find((stage) => stage.status === 'failed') ?? null,
      cancelledStage: stages.find((stage) => stage.status === 'cancelled') ?? null,
      runningStage: progress.currentIndex >= 0 ? stages[progress.currentIndex] : null,
    }
  }, [latestJob])

  const isGateBlocked =
    runSummary?.status === 'failed' && runSummary.failedStage?.key === 'gate'
  const pipelineStatusKey: PipelineStatusKey = isGateBlocked
    ? 'blocked'
    : runSummary?.status ?? repo?.pipelineStatus ?? 'pending'

  if (isRepoLoading) {
    return (
      <MainLayout>
        <section className="space-y-4">
          <Card className="h-32 animate-pulse border-[#404040] bg-[#262626]" />
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="h-32 animate-pulse border-[#404040] bg-[#262626]" />
            <Card className="h-32 animate-pulse border-[#404040] bg-[#262626]" />
          </div>
          <Card className="h-40 animate-pulse border-[#404040] bg-[#262626]" />
          <Card className="h-24 animate-pulse border-[#404040] bg-[#262626]" />
        </section>
      </MainLayout>
    )
  }

  if (!repo) {
    return (
      <MainLayout>
        <Card className="border-[#404040] bg-[#262626] p-6">
          <p className="text-[20px] font-bold text-white">{t('repo.notFoundTitle')}</p>
          <p className="mt-2 text-[14px] text-[#9CA3AF]">
            {repoError ?? t('repo.notFoundDescription')}
          </p>
          <Button asChild className="mt-4 w-fit shadow-none">
            <Link to="/dashboard">{t('repo.backDashboard')}</Link>
          </Button>
        </Card>
      </MainLayout>
    )
  }

  const status = pipelineStatusMeta[pipelineStatusKey]
  const StatusIcon = status.icon

  // Fallback chain for the source card. GitHub's commits endpoint often
  // 401s (the backend may not proxy it, and the token may be a JWT rather
  // than a GitHub OAuth token), so we layer in the pipeline metadata that
  // PipelineProcessPage extracts from the clone step's logs and persists
  // to localStorage. That gives us SOMETHING to show even when no external
  // API call succeeds.
  const pipelineInfo = getRepoPipelineInfo(cacheKey, repo.name)

  // 커밋 메시지는 실제로 조회된 커밋(GitHub/백엔드 프록시)만 사용한다.
  // clone 로그에서 추정해 localStorage에 캐시한 값(pipelineInfo.commitMessage)이나
  // SHA 기반 대체 문구는 "실제 메시지"가 아니므로 쓰지 않는다 — 없으면 그대로
  // "커밋 메시지가 없습니다"로 표시.
  const commitMessageRaw =
    latestCommit?.message?.split('\n')[0]?.trim() ||
    repo.source.commitMessage?.trim() ||
    ''
  const commitMessage = commitMessageRaw || t('repo.noCommitMessage')

  const pushedBy =
    latestCommit?.authorLogin?.trim() ||
    latestCommit?.authorName?.trim() ||
    pipelineInfo?.triggeredBy?.trim() ||
    repo.source.pushedBy?.trim() ||
    '-'

  const pushedAtRaw =
    githubPushedAt?.trim() ||
    latestCommit?.date?.trim() ||
    pipelineInfo?.triggeredAt?.trim() ||
    repo.source.pushedAt ||
    repo.updatedAt

  // Prefer the freshly-fetched GitHub branch list; fall back to the cached
  // repo branches.
  const displayBranches = githubBranches ?? repo.branches
  const pushedAt = pushedAtRaw
    ? dayjs(pushedAtRaw).isValid()
      ? dayjs(pushedAtRaw).format('YYYY-MM-DD HH:mm')
      : pushedAtRaw
    : '-'
  // 1) SecuPipeline deployment: backend record first, then the URL the
  //    pipeline page cached from the deploy-stage logs (full_name key, then
  //    the numeric id as legacy migration).
  const repoDeployment = deploymentLookup?.repoName === repo.name ? deploymentLookup : null
  const platformUrl =
    repoDeployment?.url ||
    normalizeHttpUrl(getRepoDomainUrl(cacheKey, repo.name) || getRepoDomainUrl(cacheKey, repo.id))
  const platformJobId = repoDeployment?.url ? repoDeployment.jobId : null

  const externalManualUrl =
    externalOverride?.repoName === repo.name
      ? externalOverride.url
      : getRepoExternalDomainUrl(cacheKey, repo.name)
  const setExternalManualUrl = (url: string) => setExternalOverride({ repoName: repo.name, url })

  // 2) External deployment: what the user entered, else the GitHub
  //    repository's "homepage" setting (via backend /api/repos or GitHub).
  const githubExternalUrl = normalizeHttpUrl(repo.domainUrl) || normalizeHttpUrl(githubHomepageUrl)
  const externalUrl = normalizeHttpUrl(externalManualUrl) || githubExternalUrl
  // The GitHub homepage often points at the very URL SecuPipeline deployed;
  // don't list the same address twice.
  const showExternalUrl = externalUrl && externalUrl !== platformUrl ? externalUrl : ''
  const externalSourceHint = showExternalUrl
    ? normalizeHttpUrl(externalManualUrl)
      ? t('repo.domain.sourceManual')
      : t('repo.domain.sourceGithub')
    : undefined

  const description = repo.description?.trim() || t('repo.noDescription')
  const branch =
    pipelineInfo?.branch?.trim() ||
    latestJob?.branch?.trim() ||
    repo.source.branch?.trim() ||
    repo.branches[0] ||
    '-'

  const handleCopy = async (key: 'platform' | 'external', value: string) => {
    if (!value) return
    try {
      await copyToClipboard(value)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500)
    } catch {
      setCopiedKey(null)
    }
  }

  const startExternalEdit = () => {
    setExternalDraft(normalizeHttpUrl(externalManualUrl) || showExternalUrl || '')
    setExternalError(null)
    setIsEditingExternal(true)
  }

  const persistExternal = async (url: string): Promise<boolean> => {
    const parsed = parseOwnerRepo(repo.name)
    if (!token || !parsed) return false
    setIsSavingExternal(true)
    setExternalError(null)
    try {
      const saved = await saveDeploymentSettings(token, parsed.owner, parsed.repo, url)
      const stored = url ? saved.externalUrl : ''
      setRepoExternalDomainUrl(cacheKey, repo.name, stored)
      setExternalManualUrl(stored)
      return true
    } catch (error) {
      setExternalError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setIsSavingExternal(false)
    }
  }

  const saveExternal = async () => {
    const raw = externalDraft.trim()
    const normalized = normalizeHttpUrl(raw)
    if (raw && !normalized) {
      setExternalError(t('repo.domain.invalid'))
      return
    }
    // Saving the value GitHub already provides is not an override.
    const toStore = normalized && normalized !== githubExternalUrl ? normalized : ''
    if (await persistExternal(toStore)) setIsEditingExternal(false)
  }

  const removeExternal = async () => {
    if (await persistExternal('')) setIsEditingExternal(false)
  }

  const copyButton = (key: 'platform' | 'external', value: string) => (
    <button
      type="button"
      onClick={() => void handleCopy(key, value)}
      disabled={!value}
      className={smallButtonClass}
    >
      {copiedKey === key ? <Check className="h-3 w-3 text-[#34D399]" /> : <Copy className="h-3 w-3" />}
      {copiedKey === key ? t('repo.copied') : t('repo.copy')}
    </button>
  )

  const runTime = latestJob ? latestJob.createdAt ?? latestJob.startedAt : null
  const runTimeLabel = runTime && dayjs(runTime).isValid() ? dayjs(runTime).fromNow() : '-'
  const stageLabel = (key: string) => t(`run.stage.${key}`)

  let runHeadline: string | null = null
  let runErrorDetail: string | null = null
  if (runSummary) {
    const { status: runStatus, progress, failedStage, cancelledStage, runningStage } = runSummary
    if (isGateBlocked) {
      runHeadline = t('repo.run.gateBlocked')
      runErrorDetail = failedStage?.errorMessage?.trim() || latestJob?.verdictReason?.trim() || latestJob?.errorMessage?.trim() || null
    } else if (runStatus === 'failed') {
      runHeadline = failedStage
        ? t('repo.run.failedAt', { stage: `${failedStage.number}. ${stageLabel(failedStage.key)}` })
        : t('repo.run.failedUnknownStage')
      runErrorDetail =
        failedStage?.errorMessage?.trim() ||
        latestJob?.verdictReason?.trim() ||
        latestJob?.errorMessage?.trim() ||
        t('repo.run.noErrorReason')
    } else if (runStatus === 'cancelled') {
      runHeadline = cancelledStage
        ? t('repo.run.cancelledAt', { stage: `${cancelledStage.number}. ${stageLabel(cancelledStage.key)}` })
        : t('repo.status.cancelled')
    } else if (runStatus === 'running') {
      runHeadline = runningStage
        ? t('repo.run.runningAt', {
            stage: `${runningStage.number}. ${stageLabel(runningStage.key)}`,
            completed: progress.completed,
            total: progress.total,
          })
        : t('repo.status.running')
    } else if (runStatus === 'queued') {
      runHeadline = t('repo.run.queued')
    } else {
      runHeadline = t('repo.run.succeeded', { total: progress.total })
    }
  }

  const gateSummary = parseGateMessage(runErrorDetail)

  const openLatestRun = () => {
    if (!latestJob) return
    navigate('/pipeline/progress', {
      state: { jobId: latestJob.jobId, repoName: repo.name, branch: latestJob.branch },
    })
  }

  return (
    <MainLayout>
      <section className="space-y-4">
        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[28px] font-bold text-white">{repo.name}</h1>
                <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">{repo.visibility}</Badge>
              </div>
              <p className="mt-2 text-[14px] text-[#9CA3AF]">{description}</p>
              <p className="mt-2 text-[12px] text-[#6B7280]">
                {t('repo.updated')}: {repo.updatedAt && dayjs(repo.updatedAt).isValid() ? dayjs(repo.updatedAt).fromNow() : '-'}
              </p>
            </div>

            <Button
              asChild
              variant="outline"
              className="w-fit border-[#3ECF8E] text-[#D1FAE5] hover:bg-[#065F46]/45"
            >
              <a href={repo.repositoryUrl} target="_blank" rel="noreferrer">
                <GitHubIcon className="mr-1.5 h-4 w-4" /> {t('repo.openRepository')}
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="text-[16px] font-semibold text-white">{t('repo.domainTitle')}</p>
            <div className="mt-3 space-y-2">
              <DomainRow
                label={t('repo.domain.platform')}
                icon={<Rocket className="h-3.5 w-3.5 text-[#34D399]" />}
                url={platformUrl}
                emptyText={t('repo.domain.platformEmpty')}
                hint={
                  platformJobId
                    ? t('repo.domain.platformFromJob', { jobId: platformJobId.slice(0, 8) })
                    : undefined
                }
                actions={copyButton('platform', platformUrl)}
              />

              {isEditingExternal ? (
                <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
                  <p className="inline-flex items-center gap-1.5 text-[12px] text-[#6B7280]">
                    <ExternalLink className="h-3.5 w-3.5 text-[#9CA3AF]" />
                    {t('repo.domain.external')}
                  </p>
                  <input
                    type="url"
                    autoFocus
                    value={externalDraft}
                    onChange={(event) => {
                      setExternalDraft(event.target.value)
                      setExternalError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !isSavingExternal) void saveExternal()
                      if (event.key === 'Escape') setIsEditingExternal(false)
                    }}
                    placeholder={t('repo.domain.externalPlaceholder')}
                    className="mt-1.5 w-full rounded-md border border-[#404040] bg-[#171717] px-2.5 py-1.5 text-[13px] text-[#E5E7EB] outline-none placeholder:text-[#6B7280] focus:border-[#3ECF8E]"
                  />
                  {externalError ? (
                    <p className="mt-1 text-[11px] text-[#FCA5A5]">{externalError}</p>
                  ) : null}
                  <div className="mt-2 flex justify-end gap-1">
                    <button type="button" className={smallButtonClass} onClick={() => setIsEditingExternal(false)}>
                      {t('repo.cancel')}
                    </button>
                    <button
                      type="button"
                      className={`${smallButtonClass} border-[#3ECF8E] text-[#6EE7B7]`}
                      disabled={isSavingExternal}
                      onClick={() => void saveExternal()}
                    >
                      {isSavingExternal ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {t('repo.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <DomainRow
                  label={t('repo.domain.external')}
                  icon={<ExternalLink className="h-3.5 w-3.5 text-[#9CA3AF]" />}
                  url={showExternalUrl}
                  emptyText={t('repo.domain.externalEmpty')}
                  hint={externalError ?? externalSourceHint}
                  actions={
                    <>
                      {normalizeHttpUrl(externalManualUrl) ? (
                        <button
                          type="button"
                          className={smallButtonClass}
                          disabled={isSavingExternal}
                          onClick={() => void removeExternal()}
                        >
                          {t('repo.remove')}
                        </button>
                      ) : null}
                      <button type="button" className={smallButtonClass} onClick={startExternalEdit}>
                        <Pencil className="h-3 w-3" />
                        {showExternalUrl ? t('repo.edit') : t('repo.add')}
                      </button>
                      {copyButton('external', showExternalUrl)}
                    </>
                  }
                />
              )}
            </div>
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[16px] font-semibold text-white">{t('repo.pipelineRecentStatus')}</p>
              {latestJob ? (
                <button type="button" className={smallButtonClass} onClick={openLatestRun}>
                  {t('repo.run.viewDetails')}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`inline-flex items-center gap-1.5 ${status.className}`}>
                  <StatusIcon
                    className={`h-3.5 w-3.5 ${pipelineStatusKey === 'running' ? 'animate-spin' : ''}`}
                  />{' '}
                  {t(`repo.status.${pipelineStatusKey}`)}
                </Badge>
                {latestJob ? (
                  <span className="text-[12px] text-[#9CA3AF]">
                    {t('repo.run.meta', { branch: latestJob.branch || '-', time: runTimeLabel })}
                  </span>
                ) : null}
              </div>

              {runSummary ? (
                <>
                  <div className="mt-3 flex gap-1" aria-hidden>
                    {runSummary.stages.map((stage) => (
                      <div
                        key={stage.key}
                        title={`${stage.number}. ${stageLabel(stage.key)} — ${stage.status}`}
                        className={`h-1.5 flex-1 rounded-full ${stageSegmentClass[stage.status]}`}
                      />
                    ))}
                  </div>
                  <p
                    className={`mt-2 text-[13px] ${
                      runSummary.status === 'failed' ? 'font-semibold text-[#FCA5A5]' : 'text-[#D1D5DB]'
                    }`}
                  >
                    {runHeadline}
                  </p>
                  {gateSummary ? (
                    <div className="mt-2 space-y-2 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 px-3 py-2 text-[12px]">
                      {gateSummary.reasons.length > 0 ? (
                        <div>
                          <p className="text-[11px] text-[#9CA3AF]">{t('repo.gate.reasons')}</p>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 font-medium text-[#FCA5A5]">
                            {gateSummary.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#D1D5DB]">
                        {gateSummary.score !== null ? (
                          <span>
                            {t('repo.gate.score')}{' '}
                            <b className="tabular-nums">{gateSummary.score}</b>
                            <span className="text-[#9CA3AF]">/100</span>
                          </span>
                        ) : null}
                        {gateSummary.counts
                          ? (['critical', 'high', 'medium', 'low'] as const).map((key) => (
                              <span key={key} className="inline-flex items-center gap-1">
                                <span className={`h-2 w-2 rounded-full ${severityDotClass[key]}`} />
                                <span className="capitalize">{key}</span>
                                <b className="tabular-nums">{gateSummary.counts![key]}</b>
                              </span>
                            ))
                          : null}
                      </div>
                      {gateSummary.env || gateSummary.risk || gateSummary.policy ? (
                        <p className="text-[11px] text-[#6B7280]">
                          {[
                            gateSummary.env && `${t('repo.gate.env')} ${gateSummary.env}`,
                            gateSummary.risk && `${t('repo.gate.risk')} ${gateSummary.risk}`,
                            gateSummary.policy && `${t('repo.gate.policy')} v${gateSummary.policy}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      ) : null}
                    </div>
                  ) : runErrorDetail ? (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-[#450A0A]/40 px-2 py-1.5 font-mono text-[11px] text-[#FCA5A5]">
                      {runErrorDetail}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-[12px] text-[#9CA3AF]">{t('repo.noPipelineRuns')}</p>
              )}
            </div>
          </Card>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="text-[16px] font-semibold text-white">{t('repo.source')}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">{t('repo.branch')}</p>
              <p className="mt-1 text-[14px] font-semibold text-[#E5E7EB]">{branch}</p>
            </div>
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3 md:col-span-2">
              <p className="text-[12px] text-[#6B7280]">{t('repo.commitMessage')}</p>
              <p className="mt-1 text-[14px] text-[#E5E7EB]">{commitMessage}</p>
            </div>
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">{t('repo.pushedBy')}</p>
              <p className="mt-1 text-[14px] text-[#E5E7EB]">{pushedBy}</p>
            </div>
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3 md:col-span-2">
              <p className="text-[12px] text-[#6B7280]">{t('repo.pushedAt')}</p>
              <p className="mt-1 text-[14px] text-[#E5E7EB]">{pushedAt}</p>
            </div>
          </div>
        </Card>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="inline-flex items-center gap-2 text-[16px] font-semibold text-white">
            <GitBranch className="h-4 w-4 text-[#34D399]" /> {t('repo.branchList')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {displayBranches.length === 0 ? (
              <p className="text-[12px] text-[#6B7280]">{t('repo.branchLoadFailed')}</p>
            ) : (
              displayBranches.map((b) => (
                <Badge
                  key={b}
                  className={`rounded-full px-3 py-1 text-[12px] ${
                    b === 'main' || b === 'master'
                      ? 'border-[#6EE7B7] bg-[#065F46] text-[#6EE7B7]'
                      : 'border-white/20 bg-[#3A3A3A] text-[#9CA3AF]'
                  }`}
                >
                  {b}
                </Badge>
              ))
            )}
          </div>
        </Card>
      </section>
    </MainLayout>
  )
}
