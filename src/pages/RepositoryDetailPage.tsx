import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import relativeTime from 'dayjs/plugin/relativeTime'
import { ArrowUpRight, CheckCircle2, CircleEllipsis, GitBranch, Globe, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
  fetchJobsByIds,
  fetchLatestCommit,
  fetchReposWithBranches,
  getCachedRepos,
  getRepoDomainUrl,
  getRepoPipelineInfo,
  getTrackedJobIds,
  setCachedRepos,
  setRepoDomainUrl,
  type GitHubCommitInfo,
  type JobDetail,
  type JobStatus,
} from '@/lib/api'

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
  pending: {
    className: 'border-[#F59E0B] bg-[#78350F] text-[#FCD34D]',
    icon: CircleEllipsis,
  },
} as const

type PipelineStatusKey = keyof typeof pipelineStatusMeta

function jobStatusToPipelineStatus(status: JobStatus): PipelineStatusKey {
  if (status === 'success') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'pending'
}

// Sort by createdAt — that's when the user *requested* the run, which is
// the most stable "latest" signal. Completed/started timestamps can disagree
// (long-running failed job finishing after a quick success started later).
function jobTimestampMs(job: JobDetail): number {
  const candidate = job.createdAt ?? job.startedAt ?? job.completedAt ?? ''
  const parsed = Date.parse(candidate)
  return Number.isNaN(parsed) ? 0 : parsed
}

function parseOwnerRepo(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo] = fullName.split('/')
  if (!owner || !repo) return null
  return { owner, repo }
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
  const [latestJob, setLatestJob] = useState<JobDetail | null>(null)
  const [latestCommit, setLatestCommit] = useState<GitHubCommitInfo | null>(null)
  // Branch list + push time fetched fresh from GitHub (public repos).
  const [githubBranches, setGithubBranches] = useState<string[] | null>(null)
  const [githubPushedAt, setGithubPushedAt] = useState<string | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  // User-provided deployment domain — the backend has no source for this,
  // so we let the user save it per-repo in localStorage and edit inline.
  // Domain is keyed by repo full_name (e.g. "owner/repo") so that the
  // pipeline page — which only has the repo URL/name, not the GitHub
  // numeric id — can write the auto-extracted deploy URL to the same slot.
  const [domainDraft, setDomainDraft] = useState<string>('')
  const [isEditingDomain, setIsEditingDomain] = useState(false)

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

  // Find this repo's most recent tracked pipeline run, if any.
  useEffect(() => {
    if (!token || !repo) {
      setLatestJob(null)
      return
    }

    const trackedIds = getTrackedJobIds(cacheKey)
    if (trackedIds.length === 0) {
      setLatestJob(null)
      return
    }

    let cancelled = false

    fetchJobsByIds(token, trackedIds)
      .then((jobs) => {
        if (cancelled) return
        const repoJobs = jobs.filter((job) => job.repoName === repo.name)
        if (repoJobs.length === 0) {
          setLatestJob(null)
          return
        }
        const sorted = [...repoJobs].sort(
          (a, b) => jobTimestampMs(b) - jobTimestampMs(a),
        )
        setLatestJob(sorted[0] ?? null)
      })
      .catch(() => {
        // pipeline status is best-effort — keep silent on transient errors
      })

    return () => {
      cancelled = true
    }
  }, [token, cacheKey, repo])

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
    fetchGithubRepoExtras(parsed.owner, parsed.repo)
      .then((extras) => {
        if (cancelled) return
        if (extras.branches.length > 0) setGithubBranches(extras.branches)
        if (extras.pushedAt) setGithubPushedAt(extras.pushedAt)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [token, repo])

  // Use considerVerdict=false here: the "파이프라인 최근 상태" badge reflects
  // whether the pipeline EXECUTED successfully, not whether the security
  // scan exceeded its threshold. The verdict is a separate concern surfaced
  // on the dashboard.
  const pipelineStatusKey: PipelineStatusKey = useMemo(() => {
    if (latestJob)
      return jobStatusToPipelineStatus(
        deriveJobStatus(latestJob, { considerVerdict: false }),
      )
    return repo?.pipelineStatus ?? 'pending'
  }, [latestJob, repo])

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
  // Try full_name first (the key the pipeline page writes to), then the
  // numeric id as legacy migration for users who saved before this fix.
  const savedDomain =
    getRepoDomainUrl(cacheKey, repo.name) || getRepoDomainUrl(cacheKey, repo.id)
  const domainUrl = savedDomain || repo.domainUrl?.trim() || ''
  const description = repo.description?.trim() || t('repo.noDescription')
  const branch =
    pipelineInfo?.branch?.trim() ||
    latestJob?.branch?.trim() ||
    repo.source.branch?.trim() ||
    repo.branches[0] ||
    '-'

  const handleDomainSave = () => {
    setRepoDomainUrl(cacheKey, repo.name, domainDraft)
    setIsEditingDomain(false)
  }
  const handleDomainCancel = () => {
    setDomainDraft(savedDomain)
    setIsEditingDomain(false)
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-[16px] font-semibold text-white">{t('repo.domainTitle')}</p>
              {!isEditingDomain ? (
                <button
                  type="button"
                  onClick={() => {
                    setDomainDraft(savedDomain)
                    setIsEditingDomain(true)
                  }}
                  className="rounded-md border border-[#3A3A3A] bg-[#1E1E1E] px-2 py-0.5 text-[11px] text-[#9CA3AF] hover:border-[#6B7280] hover:text-[#D1D5DB]"
                >
                  {savedDomain ? t('repo.edit') : t('repo.add')}
                </button>
              ) : null}
            </div>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              {isEditingDomain ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 shrink-0 text-[#34D399]" />
                    <input
                      type="text"
                      value={domainDraft}
                      onChange={(e) => setDomainDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleDomainSave()
                        if (e.key === 'Escape') handleDomainCancel()
                      }}
                      placeholder={t('repo.domainPlaceholder')}
                      autoFocus
                      className="flex-1 rounded-md border border-[#3A3A3A] bg-[#0F0F0F] px-2 py-1 text-[14px] text-[#D1D5DB] outline-none focus:border-[#34D399]"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleDomainCancel}
                      className="rounded-md border border-[#3A3A3A] px-2 py-0.5 text-[11px] text-[#9CA3AF] hover:text-[#D1D5DB]"
                    >
                      {t('dashboard.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleDomainSave}
                      className="rounded-md border border-[#3ECF8E] bg-[#065F46]/30 px-2 py-0.5 text-[11px] text-[#A7F3D0] hover:bg-[#065F46]/50"
                    >
                      {t('repo.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="inline-flex items-center gap-2 text-[14px] text-[#D1D5DB]">
                  <Globe className="h-4 w-4 text-[#34D399]" />
                  {domainUrl || t('repo.domainEmpty')}
                </p>
              )}
              <p className="mt-2 text-[12px] text-[#6B7280]">{t('repo.domainHelp')}</p>
            </div>
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="text-[16px] font-semibold text-white">{t('repo.pipelineRecentStatus')}</p>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <Badge className={`inline-flex items-center gap-1.5 ${status.className}`}>
                <StatusIcon className="h-3.5 w-3.5" /> {t(`repo.status.${pipelineStatusKey}`)}
              </Badge>
              <p className="mt-2 text-[12px] text-[#9CA3AF]">
                {latestJob
                  ? t('repo.latestBranchStatus', { branch: latestJob.branch || '-' })
                  : t('repo.noPipelineRuns')}
              </p>
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
