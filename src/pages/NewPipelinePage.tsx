import { GitBranch, Loader2, Lock, Play, Search, SquareMousePointer, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
  cancelPipeline,
  fetchJobsByIds,
  fetchLatestCommit,
  fetchReposWithBranches,
  fetchSecurityCatalog,
  getCachedRepos,
  getLaunchedRepos,
  getTrackedJobIds,
  hasLaunchedRepo,
  PipelineConflictError,
  setCachedRepos,
  startPipeline,
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
import type { RepositoryItem } from '@/data/repositories'
import {
  allCheckIds,
  buildCatalogBySeverity,
  securityCheckCatalog,
  severityMeta,
  severityOrder,
  type CheckSeverity,
  type SecurityCheckItem,
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
  const [selectedRepoId, setSelectedRepoId] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  // Latest commit for the current repo+branch, tagged with the selection key
  // it was fetched for so a stale SHA is never sent after switching repos.
  const [commitInfo, setCommitInfo] = useState<{ key: string; sha: string } | null>(null)
  // Security policy catalog — fetched from GET /api/security/catalog, with the
  // bundled list as a fallback so the selection UI always renders.
  const [catalog, setCatalog] = useState<SecurityCheckItem[]>(securityCheckCatalog)
  // Default to ALL checks selected (spec: "전체 선택" 기본값 권장).
  const [selectedVulnerabilityIds, setSelectedVulnerabilityIds] =
    useState<string[]>(allCheckIds)
  const [launchedRepoUrls, setLaunchedRepoUrls] = useState<string[]>(() =>
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
        if (!mounted) return
        if (error instanceof AuthExpiredError) {
          console.warn('[NewPipelinePage] auth expired — redirecting to login')
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

  const filteredRepos = useMemo(() => {
    return repos.filter((repo) => {
      return `${repo.name} ${repo.description}`.toLowerCase().includes(search.toLowerCase())
    })
  }, [repos, search])

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null

  const isFirstRunForRepo = useMemo(() => {
    if (!selectedRepo) return false
    // hasLaunchedRepo normalizes both sides (lowercase, strips github.com/.git/trailing slash)
    return !hasLaunchedRepo(cacheKey, selectedRepo.name)
    // launchedRepoUrls in deps so this recomputes after addLaunchedRepo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo, launchedRepoUrls, cacheKey])

  const allVulnerabilityIds = useMemo(() => catalog.map((c) => c.id), [catalog])
  const bySeverity = useMemo(() => buildCatalogBySeverity(catalog), [catalog])

  // Load the policy catalog from the API; keep the local fallback if it fails
  // or returns nothing. Only sets state in the async callback.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchSecurityCatalog(token)
      .then((items) => {
        if (!cancelled && items.length > 0) setCatalog(items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token])

  // Selection key for the commit we want — so we never send a SHA fetched for
  // a different repo/branch than the one currently selected.
  const selectionKey =
    selectedRepo && selectedBranch ? `${selectedRepo.id}@${selectedBranch}` : ''
  const currentCommitSha =
    commitInfo && commitInfo.key === selectionKey ? commitInfo.sha : ''

  // Best-effort fetch of the selected repo+branch's latest commit SHA so the
  // POST /api/pipelines body can include `commit_sha`. Only sets state inside
  // the async callback (no synchronous setState in the effect body).
  useEffect(() => {
    if (!token || !selectedRepo || !selectedBranch) return
    const [owner, repo] = selectedRepo.name.split('/')
    if (!owner || !repo) return
    const key = `${selectedRepo.id}@${selectedBranch}`
    let cancelled = false
    fetchLatestCommit(token, owner, repo, selectedBranch)
      .then((commit) => {
        if (!cancelled && commit?.sha) setCommitInfo({ key, sha: commit.sha })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token, selectedRepo, selectedBranch])

  useEffect(() => {
    if (repos.length === 0) return
    if (!selectedRepoId || !repos.some((repo) => repo.id === selectedRepoId)) {
      const first = repos[0]
      setSelectedRepoId(first.id)
      setSelectedBranch(first.branches[0] ?? '')
    }
  }, [repos, selectedRepoId])

  useEffect(() => {
    if (isFirstRunForRepo) {
      setSelectedVulnerabilityIds(allVulnerabilityIds)
    }
  }, [isFirstRunForRepo, allVulnerabilityIds])

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
  const hasNoSelection = !isFirstRunForRepo && selectedVulnerabilityIds.length === 0

  async function handleStartPipeline() {
    if (!selectedRepo || !token) return
    setStartError(null)
    setIsStarting(true)
    try {
      const checksToSend = isFirstRunForRepo
        ? allVulnerabilityIds
        : selectedVulnerabilityIds
      // Guard: never start a non-first-run pipeline with zero checks.
      if (checksToSend.length === 0) {
        setStartError(t('pipelineNew.minSelectionError'))
        return
      }
      const repoUrlToSend =
        selectedRepo.repositoryUrl || `https://github.com/${selectedRepo.name}`
      const { jobId } = await startPipeline(token, {
        repoUrl: repoUrlToSend,
        branch: selectedBranch || undefined,
        triggerSource: 'windows-api',
        selectedItems: checksToSend,
        commitSha: currentCommitSha || undefined,
        isFirstRun: isFirstRunForRepo,
      })
      if (!jobId) throw new Error(t('pipelineNew.serverNoJobId'))
      addTrackedJobId(cacheKey, jobId)
      const nextLaunched = addLaunchedRepo(cacheKey, selectedRepo.name)
      setLaunchedRepoUrls(nextLaunched)
      navigate('/pipeline/progress', {
        state: {
          jobId,
          repoName: selectedRepo.name,
          branch: selectedBranch,
          selectedChecks: selectedVulnerabilityTitles,
        },
      })
    } catch (error) {
      if (error instanceof PipelineConflictError) {
        setConflictDialog({
          existingJobId: error.existingJobId,
          detail: error.detail,
        })
        return
      }
      setStartError(
        error instanceof Error ? error.message : t('pipelineNew.startFailed'),
      )
    } finally {
      setIsStarting(false)
    }
  }

  async function handleConfirmConflict() {
    if (!conflictDialog || !token) return
    setIsResolvingConflict(true)
    try {
      if (conflictDialog.existingJobId) {
        await cancelPipeline(token, conflictDialog.existingJobId)
      }
      setConflictDialog(null)
      await handleStartPipeline()
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : t('pipelineNew.cancelExistingFailed'),
      )
      setConflictDialog(null)
    } finally {
      setIsResolvingConflict(false)
    }
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
                    <GitBranch className="h-3.5 w-3.5" /> {t('pipelineNew.branchCount', { count: repo.branches.length })}
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
                      {selectedRepo.branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
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
                        className="rounded-lg border border-[#2F2F2F] bg-[#171717] p-2.5"
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
            onClick={() => void handleStartPipeline()}
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
              {isResolvingConflict ? t('pipelineNew.processing') : t('pipelineNew.cancelAndRestart')}
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
