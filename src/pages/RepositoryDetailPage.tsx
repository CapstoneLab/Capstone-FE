import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import relativeTime from 'dayjs/plugin/relativeTime'
import { ArrowUpRight, Check, CheckCircle2, CircleEllipsis, Copy, GitBranch, Globe, LoaderCircle, XCircle } from 'lucide-react'
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
  fetchPipelineDeployment,
  fetchReposWithBranches,
  getCachedRepos,
  getRepoExternalUrl,
  normalizeWebUrl,
  fetchLatestRepoHistory,
  fetchJobDetail,
  historyJobDetail,
  getRepoPipelineInfo,
  getTrackedJobIds,
  setCachedRepos,
  setRepoExternalUrl,
  fetchRepoDeploymentSettings,
  saveRepoDeploymentSettings,
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
  running: { className: 'border-blue-400 bg-blue-950 text-blue-200', icon: LoaderCircle },
  queued: { className: 'border-amber-400 bg-amber-950 text-amber-200', icon: CircleEllipsis },
  cancelled: { className: 'border-gray-400 bg-gray-800 text-gray-200', icon: XCircle },
  pending: {
    className: 'border-[#F59E0B] bg-[#78350F] text-[#FCD34D]',
    icon: CircleEllipsis,
  },
} as const

type PipelineStatusKey = keyof typeof pipelineStatusMeta

function jobStatusToPipelineStatus(status: JobStatus): PipelineStatusKey {
  return status in pipelineStatusMeta ? status : 'pending'
}

const pipelineStages = ['clone', 'install', 'security-light', 'test', 'security-deep', 'security-gate', 'build', 'deploy']

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
  const { repoId } = useParams()
  const { token } = useAuth()
  return <RepositoryDetailContent key={`${token}:${(state as { repoId?: string } | null)?.repoId ?? repoId}`} />
}

function RepositoryDetailContent() {
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
  // Service deployments and user-configured external URLs remain separate.
  const [githubHomepageUrl, setGithubHomepageUrl] = useState<string | null>(null)
  const [deploymentLookup, setDeploymentLookup] = useState<{
    repoName: string
    url: string | null
    jobId: string
  } | null>(null)
  const [copiedRow, setCopiedRow] = useState<string | null>(null)
  const [serverExternalUrl, setServerExternalUrl] = useState<string | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsLoadError, setSettingsLoadError] = useState(false)
  const [savingExternal, setSavingExternal] = useState(false)
  const [editingExternal, setEditingExternal] = useState(false)
  const [externalDraft, setExternalDraft] = useState('')
  const [externalError, setExternalError] = useState(false)
  const [pipelineError, setPipelineError] = useState(false)

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

  useEffect(() => {
    if (!token || !repo) return
    const parsed = parseOwnerRepo(repo.name)
    if (!parsed) return
    let cancelled = false
    fetchRepoDeploymentSettings(token, parsed.owner, parsed.repo).then(async (settings) => {
      if (cancelled) return
      // Migrate the old device preference only when the server has no record.
      // A cleared server setting must not resurrect an older local value.
      const localUrl = getRepoExternalUrl(cacheKey, repo.name)
      const externalUrl = !settings.configured && localUrl
        ? await saveRepoDeploymentSettings(token, parsed.owner, parsed.repo, localUrl)
        : settings.externalUrl
      if (cancelled) return
      setServerExternalUrl(externalUrl)
      setGithubHomepageUrl(settings.homepage)
      setSettingsReady(true)
      setSettingsLoadError(false)
    }).catch((error: unknown) => {
      if (cancelled) return
      if (error instanceof AuthExpiredError) { logout(); navigate('/auth', { replace: true }); return }
      setSettingsLoadError(true)
    })
    return () => { cancelled = true }
  }, [token, repo, cacheKey, logout, navigate])

  // Poll the server history, including webhook runs created on other devices.
  useEffect(() => {
    setLatestJob(null)
    setDeploymentLookup(null)
    setPipelineError(false)
    if (!token || !repo) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      let job: JobDetail | null = null
      let retry = false
      try {
        let latest
        try {
          latest = await fetchLatestRepoHistory(token, repo.name)
        } catch (error) {
          if (error instanceof AuthExpiredError) throw error
          // Local IDs are only a fallback when the history request fails.
          retry = true
          const jobs = await fetchJobsByIds(token, getTrackedJobIds(cacheKey))
          job = jobs.filter((item) => item.repoName.toLowerCase() === repo.name.toLowerCase())
            .sort((a, b) => (Date.parse(b.createdAt ?? b.startedAt ?? '') || 0) - (Date.parse(a.createdAt ?? a.startedAt ?? '') || 0))[0] ?? null
          if (!job) throw error
        }
        if (latest) {
          job = historyJobDetail(latest)
          try {
            const detail = await fetchJobDetail(token, latest.jobId)
            if (detail) job = detail
            else retry = true
          }
          catch (error) {
            if (error instanceof AuthExpiredError) throw error
            retry = true
          }
        }
        if (cancelled) return
        setLatestJob(job)
        setPipelineError(retry)
        if (!job) setDeploymentLookup(null)
        if (job) {
          let url = (await fetchPipelineDeployment(token, job.jobId)).url
          let deploymentJobId = job.jobId
          if (!url) {
            const successful = await fetchLatestRepoHistory(token, repo.name, 'success')
            if (successful && successful.jobId !== job.jobId) {
              url = (await fetchPipelineDeployment(token, successful.jobId)).url
              deploymentJobId = successful.jobId
            }
          }
          if (!cancelled) setDeploymentLookup({ repoName: repo.name, url, jobId: deploymentJobId })
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof AuthExpiredError) {
          logout()
          navigate('/auth', { replace: true })
          return
        }
        retry = true
        setPipelineError(true)
      } finally {
        if (!cancelled && (retry || job?.status === 'running' || job?.status === 'queued')) {
          timer = setTimeout(refresh, 5000)
        }
      }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [token, cacheKey, repo, logout, navigate])

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
    fetchGithubRepoExtras(parsed.owner, parsed.repo, token)
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

  // Use considerVerdict=false here: the "파이프라인 최근 상태" badge reflects
  // whether the pipeline EXECUTED successfully, not whether the security
  // scan exceeded its threshold. The verdict is a separate concern surfaced
  // on the dashboard.
  const pipelineStatusKey: PipelineStatusKey = useMemo(() => {
    if (latestJob)
      return jobStatusToPipelineStatus(
        deriveJobStatus(latestJob, { considerVerdict: false }),
      )
    return 'pending'
  }, [latestJob])

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
  const domainUrl = deploymentLookup?.repoName === repo.name ? deploymentLookup.url ?? '' : ''
  // Separate from the legacy cache that was also written by pipeline deployments.
  const savedExternalUrl = serverExternalUrl ?? getRepoExternalUrl(cacheKey, repo.name)
  const externalUrl = savedExternalUrl || normalizeWebUrl(repo.domainUrl || githubHomepageUrl || '')
  const duplicateUrl = !!externalUrl && externalUrl === domainUrl
  const stageStates = pipelineStages.map((type) => latestJob?.steps.find((step) =>
    step.stepType === type || step.stepName === type ||
    ({ 'security-light': 'lightweight-security', 'security-deep': 'deep-security', 'security-gate': 'security_gate' } as Record<string, string>)[type] === step.stepName))
  const failedStage = stageStates.findIndex((step) => step?.status === 'failed')
  const failureReason = (failedStage >= 0 ? stageStates[failedStage]?.errorMessage : null) || latestJob?.errorMessage
  const description = repo.description?.trim() || t('repo.noDescription')
  const branch =
    pipelineInfo?.branch?.trim() ||
    latestJob?.branch?.trim() ||
    repo.source.branch?.trim() ||
    repo.branches[0] ||
    '-'

  const handleDomainCopy = async (row: string, value: string) => {
    try {
      await copyToClipboard(value)
      setCopiedRow(row)
      window.setTimeout(() => setCopiedRow(null), 1500)
    } catch { setCopiedRow(null) }
  }

  const saveExternal = async () => {
    const parsed = parseOwnerRepo(repo.name)
    if (!token || !parsed || savingExternal) return
    setSavingExternal(true)
    try {
      const url = await saveRepoDeploymentSettings(token, parsed.owner, parsed.repo, externalDraft)
      setServerExternalUrl(url)
      setSettingsReady(true)
      setSettingsLoadError(false)
      // Best-effort cache; server persistence determines whether saving succeeded.
      try { setRepoExternalUrl(cacheKey, repo.name, url) } catch { /* storage may be disabled */ }
      setEditingExternal(false)
      setExternalError(false)
    } catch (error) {
      if (error instanceof AuthExpiredError) { logout(); navigate('/auth', { replace: true }); return }
      setExternalError(true)
    } finally { setSavingExternal(false) }
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
            {[
              { id: 'service', label: t('repo.serviceDeployment'), url: domainUrl },
              { id: 'external', label: t('repo.externalDeployment'), url: duplicateUrl ? '' : externalUrl },
            ].map((row) => (
              <div key={row.id} className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
                <div className="flex items-center justify-between gap-2 text-sm text-gray-300">
                  <span>{row.label}</span>
                  <div className="flex gap-2">
                    {row.id === 'external' && <button type="button" disabled={!settingsReady && !settingsLoadError} onClick={() => {
                      setExternalDraft(savedExternalUrl || externalUrl)
                      setExternalError(false)
                      setEditingExternal(true)
                    }}>{t(externalUrl ? 'repo.edit' : 'repo.add')}</button>}
                    {row.url && <button type="button" aria-label={`${row.label} ${t('repo.copy')}`} onClick={() => void handleDomainCopy(row.id, row.url)}>
                      {copiedRow === row.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 shrink-0 text-[#34D399]" />
                  {row.url ? <a href={row.url} target="_blank" rel="noopener noreferrer" className="break-all text-[#34D399] hover:underline">{row.url}</a>
                    : <span className="text-gray-400">{t(row.id === 'external' && duplicateUrl ? 'repo.sameDeployment' : 'repo.domainEmpty')}</span>}
                </div>
                {row.id === 'service' && row.url && <Link className="mt-2 block break-all text-xs text-gray-400 hover:underline" to="/pipeline/progress" state={{ jobId: deploymentLookup?.jobId }}>
                  {t('repo.deployedBy', { id: deploymentLookup?.jobId ?? '' })}
                </Link>}
                {row.id === 'external' && settingsLoadError && <p role="alert" className="mt-2 text-xs text-amber-300">{t('repo.settingsLoadFailed')}</p>}
                {row.id === 'external' && editingExternal && <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void saveExternal() }}>
                  <input aria-label={t('repo.externalDeployment')} className="w-full rounded border border-gray-600 bg-[#262626] p-2 text-white" value={externalDraft} onChange={(event) => setExternalDraft(event.target.value)} placeholder={t('repo.domainPlaceholder')} />
                  <p className="text-xs text-gray-400">{t('repo.externalHint')}</p>
                  {externalError && <p role="alert" className="text-sm text-red-300">{t('repo.invalidUrl')}</p>}
                  <Button type="submit" disabled={savingExternal}>{t('repo.save')}</Button>
                  <Button type="button" variant="outline" onClick={() => setEditingExternal(false)}>{t('repo.cancel')}</Button>
                </form>}
              </div>
            ))}
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="text-[16px] font-semibold text-white">{t('repo.pipelineRecentStatus')}</p>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <Badge className={`inline-flex items-center gap-1.5 ${status.className}`}>
                <StatusIcon className={`h-3.5 w-3.5 ${pipelineStatusKey === 'running' ? 'animate-spin' : ''}`} /> {t(`repo.status.${pipelineStatusKey}`)}
              </Badge>
              <p className="mt-2 text-[12px] text-[#9CA3AF]">
                {latestJob
                  ? t('repo.latestBranchStatus', { branch: latestJob.branch || '-' })
                  : t('repo.noPipelineRuns')}
              </p>
              {pipelineError && <p role="alert" className="mt-2 text-sm text-amber-300">{t('repo.pipelineLoadFailed')}</p>}
              {latestJob && <>
                <ol aria-label={t('repo.pipelineProgress')} className="mt-3 grid grid-cols-4 gap-2">
                  {pipelineStages.map((type, index) => {
                    const stepStatus = stageStates[index]?.status ?? 'pending'
                    return <li key={type} className="text-xs text-gray-300" title={t(`repo.stageStatus.${stepStatus}`)}>
                      <div className={`mb-1 h-1.5 rounded ${stepStatus === 'failed' ? 'bg-red-400' : stepStatus === 'success' ? 'bg-emerald-400' : stepStatus === 'running' ? 'animate-pulse bg-blue-400' : 'bg-gray-600'}`} />
                      {index + 1}. {t(`repo.stage.${type}`)}
                    </li>
                  })}
                </ol>
                {failedStage >= 0 && <div role="alert" className="mt-3 text-sm text-red-300">
                  <p>{t('repo.failedStage', { number: failedStage + 1, stage: t(`repo.stage.${pipelineStages[failedStage]}`) })}</p>

                </div>}
                {pipelineStatusKey === 'failed' && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-red-300">{failureReason || t('repo.failureNotReported')}</p>}
                <Link className="mt-3 inline-block text-sm text-emerald-300 hover:underline" to="/pipeline/progress" state={{ jobId: latestJob.jobId }}>{t('repo.viewDetails')}</Link>
              </>}
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
