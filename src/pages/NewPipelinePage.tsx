import { GitBranch, Loader2, Lock, Play, Search, SquareMousePointer, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/contexts/AuthContext'
import { getAuthCacheKey } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  addLaunchedRepo,
  addTrackedJobId,
  AuthExpiredError,
  fetchBranches,
  fetchJobsByIds,
  fetchLatestRepoHistory,
  fetchRepos,
  getCachedRepos,
  getLaunchedRepos,
  getTrackedJobIds,
  isGithubRateLimitError,
  setCachedRepos,
  startPipeline,
  type PipelineEnvironment,
} from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getLanguageColor } from '@/lib/languageColors'
import { useSecurityCatalog } from '@/hooks/useSecurityCatalog'
import { markStartClicked, markStartResponse } from '@/lib/startTiming'
import { registerPendingStart } from '@/lib/pendingStart'
import type { RepositoryItem } from '@/data/repositories'
import {
  buildCatalogBySeverity,
  severityMeta,
  severityOrder,
  type CheckSeverity,
} from '@/data/securityCatalog'

export function NewPipelinePage() {
  const navigate = useNavigate()
  const { token, user, logout } = useAuth()
  const { t } = useLanguage()
  const cacheKey = getAuthCacheKey(token, user)
  const [search, setSearch] = useState('')
  const [repos, setRepos] = useState<RepositoryItem[]>(
    () => (token ? (getCachedRepos(cacheKey) ?? []) : []),
  )
  const [isReposLoading, setIsReposLoading] = useState(
    () => !!token && !getCachedRepos(cacheKey),
  )
  const [reposError, setReposError] = useState<string | null>(null)
  // What the user picked; the effective selection falls back to the first
  // repo / first branch while nothing valid is picked (derived, not synced).
  const [pickedRepoId, setSelectedRepoId] = useState('')
  const [pickedBranch, setSelectedBranch] = useState('')
  const [environment, setEnvironment] = useState<PipelineEnvironment>('development')
  // Security policy catalog — the server response is the single source of truth
  // (shared, cached query; same list the result page counts against).
  const { items: catalog, fromServer: catalogFromServer, error: catalogError } = useSecurityCatalog(token)
  // Default to ALL checks selected (spec: "전체 선택" 기본값 권장).
  const [selectedVulnerabilityIds, setSelectedVulnerabilityIds] =
    useState<string[]>([])
  const [, setLaunchedRepoUrls] = useState<string[]>(() =>
    token ? getLaunchedRepos(cacheKey) : [],
  )
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [conflictDialog, setConflictDialog] = useState<{
    existingJobId: string | null
    detail: string
  } | null>(null)
  const [isResolvingConflict, setIsResolvingConflict] = useState(false)

  useEffect(() => {
    if (!token) return

    let mounted = true

    // Repository list only — branches are fetched for the selected repo below,
    // instead of fetching every repository's branches before showing anything.
    fetchRepos(token)
      .then((list) => {
        if (mounted) {
          // Keep branches already known from the cache until the selected
          // repo's fresh branch list arrives.
          const cachedById = new Map((getCachedRepos(cacheKey) ?? []).map((repo) => [repo.id, repo]))
          const merged = list.map((repo) => {
            const cached = cachedById.get(repo.id)
            return cached && cached.branches.length > repo.branches.length
              ? { ...repo, branches: cached.branches, branchCommitShas: cached.branchCommitShas }
              : repo
          })
          setRepos(merged)
          setCachedRepos(cacheKey, merged)
        }
      })
      .catch((error: unknown) => {
        if (!mounted) return
        if (error instanceof AuthExpiredError) {
          console.warn('[NewPipelinePage] auth expired — redirecting to login')
          logout()
          navigate('/auth', { replace: true })
          return
        }
        const cached = getCachedRepos(cacheKey)
        if (isGithubRateLimitError(error) && cached && cached.length > 0) {
          setRepos(cached)
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
  }, [token, cacheKey, logout, navigate])

  const filteredRepos = useMemo(() => {
    return repos.filter((repo) => {
      return `${repo.name} ${repo.description}`.toLowerCase().includes(search.toLowerCase())
    })
  }, [repos, search])

  const selectedRepoId = repos.some((repo) => repo.id === pickedRepoId) ? pickedRepoId : (repos[0]?.id ?? '')
  const listedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null

  // Branches of the selected repository only (cached per repo).
  const branchesQuery = useQuery({
    queryKey: ['repo-branches', listedRepo?.name ?? ''],
    queryFn: async () => {
      const [owner, name] = listedRepo!.name.split('/')
      return fetchBranches(token!, owner, name)
    },
    enabled: !!token && !!listedRepo?.name.includes('/'),
    staleTime: 60_000,
  })
  const selectedRepo = useMemo(() => {
    if (!listedRepo) return null
    const items = branchesQuery.data
    if (!items || items.length === 0) return listedRepo
    const defaultBranch = listedRepo.source.branch
    const names = items.map((item) => item.name)
    return {
      ...listedRepo,
      branches: defaultBranch && names.includes(defaultBranch)
        ? [defaultBranch, ...names.filter((name) => name !== defaultBranch)]
        : names,
      branchCommitShas: Object.fromEntries(items.map((item) => [item.name, item.commitSha])),
    }
  }, [listedRepo, branchesQuery.data])

  // First run = the server has no run of this repository yet. The backend then
  // scans with the full catalog regardless of what is selected, so the screen
  // must say so (and send the full list) instead of implying a partial scan.
  const historyQuery = useQuery({
    queryKey: ['repo-has-runs', listedRepo?.name ?? ''],
    queryFn: async () => (await fetchLatestRepoHistory(token!, listedRepo!.name)) !== null,
    enabled: !!token && !!listedRepo?.name,
    staleTime: 60_000,
  })
  const isFirstRunForRepo = historyQuery.data === false

  const allVulnerabilityIds = useMemo(() => catalog.map((c) => c.id), [catalog])
  const bySeverity = useMemo(() => buildCatalogBySeverity(catalog), [catalog])

  // Select every catalog item by default once the server catalog is in.
  const [catalogSeeded, setCatalogSeeded] = useState(false)
  if (!catalogSeeded && catalogFromServer) {
    setCatalogSeeded(true)
    setSelectedVulnerabilityIds(allVulnerabilityIds)
  }

  // Use the commit SHA returned with the selected branch.
  // A picked branch that the selected repo does not have (another repo's, or
  // before the branch list arrived) falls back to the repo's first branch.
  const selectedBranch =
    selectedRepo && selectedRepo.branches.includes(pickedBranch)
      ? pickedBranch
      : (selectedRepo?.branches[0] ?? pickedBranch)
  const currentCommitSha = selectedRepo?.branchCommitShas?.[selectedBranch] ?? ''

  // First run: the server scans the full catalog, so show every item selected.
  const firstRunKey = isFirstRunForRepo ? allVulnerabilityIds.join(',') : ''
  const [appliedFirstRunKey, setAppliedFirstRunKey] = useState('')
  if (firstRunKey && firstRunKey !== appliedFirstRunKey) {
    setAppliedFirstRunKey(firstRunKey)
    setSelectedVulnerabilityIds(allVulnerabilityIds)
  }

  // One-time migration: register repos of previously-run jobs as launched
  // so users who ran pipelines before this feature don't see the forced state.
  useEffect(() => {
    if (!token) return
    const trackedIds = getTrackedJobIds(cacheKey)
    if (trackedIds.length === 0) return
    if (getLaunchedRepos(cacheKey).length > 0) return

    let cancelled = false
    fetchJobsByIds(token, trackedIds)
      .then((jobs) => {
        if (cancelled) return
        let next: string[] = []
        for (const job of jobs) {
          if (job.repoName) next = addLaunchedRepo(cacheKey, job.repoName)
        }
        if (next.length > 0) setLaunchedRepoUrls(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token, cacheKey])

  const toggleVulnerabilityOption = (optionId: string, checked: boolean | 'indeterminate') => {
    setSelectedVulnerabilityIds((prev) => {
      if (checked) {
        return prev.includes(optionId) ? prev : [...prev, optionId]
      }
      return prev.filter((id) => id !== optionId)
    })
  }

  // Per-severity "전체 선택/해제" toggle. If every item in the grade is already
  // selected, clicking clears them; otherwise it selects all of them.
  const toggleSeverityGroup = (severity: CheckSeverity) => {
    const groupIds = bySeverity[severity].map((c) => c.id)
    setSelectedVulnerabilityIds((prev) => {
      const allSelected = groupIds.every((id) => prev.includes(id))
      if (allSelected) {
        return prev.filter((id) => !groupIds.includes(id))
      }
      const merged = new Set(prev)
      groupIds.forEach((id) => merged.add(id))
      return Array.from(merged)
    })
  }

  const toggleAll = () => {
    setSelectedVulnerabilityIds((prev) =>
      prev.length === allVulnerabilityIds.length ? [] : allVulnerabilityIds,
    )
  }

  const selectedVulnerabilityTitles = catalog
    .filter((option) => selectedVulnerabilityIds.includes(option.id))
    .map((option) => option.title)

  // Min-1 enforcement (spec: 0개 선택은 제출 비활성). First-run repos always
  // send the full baseline, so they're never blocked.
  // Before the catalog arrives the default (all checks) applies — never block.
  const hasNoSelection = !isFirstRunForRepo && catalogSeeded && selectedVulnerabilityIds.length === 0

  function handleStartPipeline() {
    if (!selectedRepo || !token || isStarting) return
    // The untouched default is "every check": until the server catalog has
    // arrived that is sent as [] (the backend then runs the full catalog), so
    // the click never waits on the catalog request.
    const checksToSend = isFirstRunForRepo
      ? allVulnerabilityIds
      : !catalogSeeded
        ? []
        : selectedVulnerabilityIds
    if (catalogSeeded && checksToSend.length === 0) {
      setStartError(t('pipelineNew.minSelectionError'))
      return
    }
    const repoName = selectedRepo.name
    const branch = selectedBranch || selectedRepo.source.branch

    // Send the start request right now, on the click — nothing awaited first.
    markStartClicked()
    const request = startPipeline(token, {
      repoUrl: selectedRepo.repositoryUrl || `https://github.com/${repoName}`,
      branch,
      triggerSource: 'manual',
      environment,
      selectedItems: checksToSend,
      commitSha: currentCommitSha || undefined,
    })
    // Bookkeeping once the backend answers (the progress page shows the rest).
    request
      .then(({ jobId }) => {
        if (!jobId) return
        markStartResponse(jobId)
        addTrackedJobId(cacheKey, jobId)
        setLaunchedRepoUrls(addLaunchedRepo(cacheKey, repoName))
      })
      .catch(() => undefined)

    setStartError(null)
    setIsStarting(true)
    // Move to the progress screen immediately; it attaches to the execution
    // as soon as the job id arrives (and handles a duplicate run or an error).
    navigate('/pipeline/progress', {
      state: {
        pendingStartId: registerPendingStart(request),
        repoName,
        branch,
        selectedChecks: selectedVulnerabilityTitles,
      },
    })
  }

  function handleConfirmConflict() {
    const existingJobId = conflictDialog?.existingJobId
    if (!existingJobId) return
    setIsResolvingConflict(true)
    addTrackedJobId(cacheKey, existingJobId)
    setConflictDialog(null)
    navigate('/pipeline/progress', {
      state: { jobId: existingJobId, repoName: selectedRepo?.name ?? '', branch: selectedBranch },
    })
  }

  return (
    <MainLayout>
      <section className="w-full space-y-5">
        <div>
          <h1 className="text-5xl font-extrabold text-white md:text-4xl">{t('pipelineNew.title')}</h1>
          <p className="mt-2 text-sm text-[#6B7280]">
            {t('pipelineNew.description')}
          </p>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="flex items-center gap-2 text-[24px] font-bold text-white">
            <SquareMousePointer className="h-6 w-6 text-[#34D399]" /> {t('pipelineNew.selectRepo')}
          </div>

          <label className="relative mt-4 block">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#6B7280]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('dashboard.repoSearch')}
              className="pl-10"
            />
          </label>

          {isReposLoading && repos.length === 0 ? (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-16 animate-pulse rounded-lg border border-[#2F2F2F] bg-[#1E1E1E]"
                />
              ))}
            </div>
          ) : reposError ? (
            <p className="mt-4 rounded-lg border border-[#404040] bg-[#1E1E1E] p-4 text-center text-sm text-[#FCA5A5]">
              {reposError}
            </p>
          ) : filteredRepos.length === 0 ? (
            <p className="mt-4 rounded-lg border border-[#404040] bg-[#1E1E1E] p-4 text-center text-sm text-[#9CA3AF]">
              {t('pipelineNew.noRepos')}
            </p>
          ) : (
          <RadioGroup
            className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-2"
            value={selectedRepoId}
            onValueChange={(value) => {
              setSelectedRepoId(value)
              const nextRepo = repos.find((repo) => repo.id === value)
              if (nextRepo?.branches[0]) {
                setSelectedBranch(nextRepo.branches[0])
              }
            }}
          >
            {filteredRepos.map((repo) => (
              <label
                key={repo.id}
                htmlFor={`repo-${repo.id}`}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-3 hover:bg-white/3"
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem id={`repo-${repo.id}`} value={repo.id} />

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[18px] font-bold text-white">{repo.name}</p>
                      <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">
                        {repo.visibility}
                      </Badge>
                      <span className="inline-flex items-center gap-2 text-[12px] text-[#6B7280]">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: getLanguageColor(repo.language) }}
                        />
                        {repo.language}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-[#6B7280]">{repo.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[12px] text-[#6B7280]">
                  <span className="inline-flex items-center gap-1">
                    <GitBranch className="h-3.5 w-3.5" />{' '}
                    {/* Branch lists load per selected repo; others show the default branch. */}
                    {repo.id === selectedRepoId && selectedRepo && selectedRepo.branches.length > 1
                      ? t('pipelineNew.branchCount', { count: selectedRepo.branches.length })
                      : repo.branches.length > 1
                        ? t('pipelineNew.branchCount', { count: repo.branches.length })
                        : repo.source.branch || '-'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5" /> {repo.stars}
                  </span>
                </div>
              </label>
            ))}
          </RadioGroup>
          )}
        </Card>

        {selectedRepo ? (
          <Card className="border-[#404040] bg-[#262626] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[18px] font-bold text-white">{selectedRepo.name}</p>
                  <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">
                    {selectedRepo.visibility}
                  </Badge>
                </div>
                <p className="mt-2 text-[12px] text-[#6B7280]">{selectedRepo.description}</p>
              </div>

              <div className="w-full md:w-56">
                <p className="inline-flex items-center gap-1 text-[12px] text-[#6B7280]">
                  <GitBranch className="h-4 w-4" /> {t('pipelineNew.runBranch')}
                </p>
                <div className="mt-2">
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('pipelineNew.selectBranch')} />
                    </SelectTrigger>
                    <SelectContent>
                      {branchesQuery.isFetching && selectedRepo.branches.length <= 1 ? (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-[#9CA3AF]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('pipelineNew.loadingBranches')}
                        </div>
                      ) : null}
                      {selectedRepo.branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="mt-3 text-[12px] text-[#6B7280]">실행 환경</p>
                <Select value={environment} onValueChange={(value) => setEnvironment(value as PipelineEnvironment)}>
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="development">Development</SelectItem>
                    <SelectItem value="feature">Feature</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
                {environment === 'production' || environment === 'staging' ? (
                  <p className="mt-2 text-[11px] text-[#FBBF24]">이 환경에서는 Medium 탐지도 승인 대상으로 승격될 수 있습니다.</p>
                ) : null}
              </div>
            </div>

            <hr className="my-4 border-[#404040]" />

            <div className="space-y-3">
              {isFirstRunForRepo ? (
                <div className="flex items-start gap-2 rounded-lg border border-[#3ECF8E]/40 bg-[#065F46]/20 p-3 text-[12px] text-[#A7F3D0]">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-[#D1FAE5]">{t('pipelineNew.firstRunTitle')}</p>
                    <p className="mt-1 text-[#A7F3D0]">
                      {t('pipelineNew.firstRunDescription')}
                    </p>
                    <p className="mt-1 font-semibold text-[#D1FAE5]">
                      {t('pipelineNew.firstRunScope', { count: allVulnerabilityIds.length })}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg bg-transparent p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-[#D1D5DB]">{t('pipelineNew.checkItems')}</p>
                  <div className="flex items-center gap-3">
                    <p className="text-[12px] text-[#6B7280]">
                      {isFirstRunForRepo
                        ? t('pipelineNew.allAutoSelected', { count: allVulnerabilityIds.length })
                        : t('pipelineNew.selectedCount', {
                            selected: selectedVulnerabilityIds.length,
                            total: allVulnerabilityIds.length,
                          })}
                    </p>
                    {!isFirstRunForRepo ? (
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="rounded-md border border-[#404040] px-2 py-1 text-[11px] text-[#9CA3AF] hover:border-[#3ECF8E]/50 hover:text-[#D1FAE5]"
                      >
                        {selectedVulnerabilityIds.length === allVulnerabilityIds.length
                          ? t('pipelineNew.clearAll')
                          : t('pipelineNew.selectAll')}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {severityOrder.map((severity) => {
                    const meta = severityMeta[severity]
                    const items = bySeverity[severity]
                    const selectedInGroup = items.filter((item) =>
                      selectedVulnerabilityIds.includes(item.id),
                    ).length
                    const allInGroupSelected = selectedInGroup === items.length
                    return (
                      <div
                        key={severity}
                        className="rounded-lg bg-transparent p-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#E5E7EB]">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: meta.color }}
                            />
                            {meta.label}
                            <span className="text-[12px] font-normal text-[#6B7280]">
                              ({selectedInGroup}/{items.length})
                            </span>
                          </p>
                          {!isFirstRunForRepo ? (
                            <button
                              type="button"
                              onClick={() => toggleSeverityGroup(severity)}
                              className="text-[11px] text-[#6B7280] hover:text-[#D1FAE5]"
                            >
                              {allInGroupSelected ? t('pipelineNew.clear') : t('pipelineNew.selectAll')}
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {items.map((option) => (
                            <label
                              key={option.id}
                              htmlFor={option.id}
                              title={option.description}
                              className={`flex items-start gap-2 rounded-md border border-[#2F2F2F] bg-[#101010] p-2.5 ${
                                isFirstRunForRepo
                                  ? 'cursor-not-allowed opacity-60'
                                  : 'cursor-pointer hover:border-[#3ECF8E]/50'
                              }`}
                            >
                              <Checkbox
                                id={option.id}
                                checked={selectedVulnerabilityIds.includes(option.id)}
                                onCheckedChange={(checked) =>
                                  toggleVulnerabilityOption(option.id, checked)
                                }
                                disabled={isFirstRunForRepo}
                                className="mt-0.5"
                              />
                              <div>
                                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#E5E7EB]">
                                  {option.title}
                                  <span className="text-[11px] font-normal text-[#6B7280]">
                                    {option.cwe}
                                  </span>
                                </p>
                                <p className="mt-1 text-[12px] leading-5 text-[#9CA3AF]">
                                  {option.description}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {hasNoSelection ? (
                  <p className="mt-3 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-center text-[12px] text-[#FCA5A5]">
                    {t('pipelineNew.minSelection')}
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}

        {catalogError && !catalogFromServer ? (
          <p className="rounded-lg border border-[#78350F] bg-[#451A03]/40 p-3 text-center text-sm text-[#FCD34D]">
            {t('pipelineNew.catalogFallback')}
          </p>
        ) : null}

        {startError ? (
          <p className="rounded-lg border border-[#7F1D1D] bg-[#450A0A]/40 p-3 text-center text-sm text-[#FCA5A5]">
            {startError}
          </p>
        ) : null}

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => navigate('/dashboard')}
            disabled={isStarting}
          >
            {t('dashboard.cancel')}
          </Button>
          <Button
            onClick={handleStartPipeline}
            className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
            disabled={!selectedRepo || !token || isStarting || hasNoSelection}
          >
            {isStarting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            {isStarting ? t('pipelineNew.starting') : t('pipelineNew.runPipeline')}
          </Button>
        </div>
      </section>

      <Dialog
        open={!!conflictDialog}
        onOpenChange={(open) => {
          if (!open && !isResolvingConflict) setConflictDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pipelineNew.conflictTitle')}</DialogTitle>
            <DialogDescription>
              {t('pipelineNew.conflictDescription', {
                repo: selectedRepo?.name || t('pipelineNew.thisRepo'),
                branch: selectedBranch ? ` (${selectedBranch})` : '',
              })}
              <br />
              {t('pipelineNew.conflictQuestion')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConflictDialog(null)}
              disabled={isResolvingConflict}
            >
              {t('pipelineNew.no')}
            </Button>
            <Button
              onClick={() => void handleConfirmConflict()}
              disabled={isResolvingConflict || !conflictDialog?.existingJobId}
              className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
            >
              {isResolvingConflict ? t('pipelineNew.processing') : t('pipelineNew.openExisting')}
            </Button>
          </DialogFooter>
          {!conflictDialog?.existingJobId ? (
            <p className="mt-3 text-center text-xs text-[#FCA5A5]">
              {t('pipelineNew.missingJobId')}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
