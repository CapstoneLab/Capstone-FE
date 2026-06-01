import type { RepositoryItem } from '@/data/repositories'

const API_BASE =
  window.location.protocol === 'file:'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api-proxy'

type UnknownRecord = Record<string, unknown>

export class AuthExpiredError extends Error {
  readonly status: number
  readonly detail: string
  constructor(detail: string, status = 401) {
    super(detail || '인증이 만료되었습니다. 다시 로그인해 주세요.')
    this.name = 'AuthExpiredError'
    this.status = status
    this.detail = detail
  }
}

export class PipelineConflictError extends Error {
  readonly status = 409
  readonly detail: string
  readonly existingJobId: string | null
  constructor(detail: string, existingJobId: string | null) {
    super(detail || '이미 실행 중인 파이프라인이 있습니다.')
    this.name = 'PipelineConflictError'
    this.detail = detail
    this.existingJobId = existingJobId
  }
}

function isGithubTokenMissing(detail: string): boolean {
  return /github access token not in cache|please log in again/i.test(detail)
}

function pick<T = unknown>(obj: UnknownRecord, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null) {
      return value as T
    }
  }
  return undefined
}

function mapRepo(raw: UnknownRecord): RepositoryItem {
  const isPrivate = pick<boolean>(raw, 'private', 'isPrivate', 'visibility_private')
  const visibilityField = pick<string>(raw, 'visibility')
  const visibility: 'Public' | 'Private' =
    visibilityField === 'private' || isPrivate === true ? 'Private' : 'Public'

  const fullName = pick<string>(raw, 'full_name', 'fullName', 'name') ?? ''
  const defaultBranch = pick<string>(raw, 'default_branch', 'defaultBranch')
  const updatedAt =
    pick<string>(raw, 'updated_at', 'updatedAt', 'pushed_at', 'pushedAt') ?? ''
  const htmlUrl = pick<string>(raw, 'html_url', 'htmlUrl', 'url') ?? ''
  const rawId = pick<string | number>(raw, 'id', 'repo_id', 'repoId')

  return {
    id: rawId !== undefined ? String(rawId) : fullName,
    name: fullName,
    visibility,
    description: pick<string>(raw, 'description') ?? '',
    updatedAt,
    stars: pick<number>(raw, 'stargazers_count', 'stars', 'stargazersCount') ?? 0,
    language: pick<string>(raw, 'language') ?? '',
    branches: defaultBranch ? [defaultBranch] : [],
    detectEnabled: false,
    repositoryUrl: htmlUrl,
    domainUrl: '',
    pipelineStatus: 'pending',
    source: {
      branch: defaultBranch ?? '',
      commitMessage: '',
      pushedBy: pick<string>(raw, 'pushed_by', 'pushedBy') ?? '',
      pushedAt: pick<string>(raw, 'pushed_at', 'pushedAt') ?? updatedAt,
    },
  }
}

function extractList(data: unknown): UnknownRecord[] {
  if (Array.isArray(data)) return data as UnknownRecord[]
  const record = (data ?? {}) as UnknownRecord
  if (Array.isArray(record.repos)) return record.repos as UnknownRecord[]
  if (Array.isArray(record.items)) return record.items as UnknownRecord[]
  if (Array.isArray(record.branches)) return record.branches as UnknownRecord[]
  return []
}

export async function fetchRepos(token: string): Promise<RepositoryItem[]> {
  const res = await fetch(`${API_BASE}/api/repos`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[api] /repos failed:', res.status, text)
    let detail = ''
    try {
      const parsed = JSON.parse(text) as UnknownRecord
      detail = pick<string>(parsed, 'detail', 'message') ?? ''
    } catch {
      detail = text
    }
    if (res.status === 401 || isGithubTokenMissing(detail)) {
      throw new AuthExpiredError(detail || 'GitHub 인증이 만료되었습니다. 다시 로그인해 주세요.')
    }
    throw new Error(`Failed to fetch repos (${res.status})`)
  }

  return extractList(await res.json()).map(mapRepo)
}

export async function fetchBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<string[]> {
  const res = await fetch(
    `${API_BASE}/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    console.error('[api] /branches failed:', res.status)
    return []
  }

  return extractList(await res.json())
    .map((item) => pick<string>(item, 'name', 'branch') ?? '')
    .filter(Boolean)
}

export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export type JobVerdict = 'passed' | 'warning' | 'failed'

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low'

export type SecuritySummaryItem = {
  scanner: string
  count: number
  critical: number
  high: number
  medium: number
  low: number
}

export type JobStep = {
  stepId: string
  stepName: string
  stepType: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  errorMessage: string | null
  startedAt: string | null
  endedAt: string | null
  durationSecs: number | null
}

export type JobDetail = {
  jobId: string
  repoUrl: string
  repoName: string
  branch: string
  triggerSource: string
  status: JobStatus
  overallResult: string | null
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
  durationSecs: number
  steps: JobStep[]
  verdict: JobVerdict | null
  verdictReason: string | null
  totalFindings: number
  severityCounts: Record<SecuritySeverity, number>
  summaries: SecuritySummaryItem[]
  securityScore: number
}

function repoNameFromUrl(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.pathname.replace(/^\/+|\.git$|\/+$/g, '')
  } catch {
    return url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$|\/+$/g, '')
  }
}

function durationBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0
  return Math.max(0, Math.round((endMs - startMs) / 1000))
}

export function computeSecurityScore(counts: Record<SecuritySeverity, number>): number {
  const penalty =
    counts.critical * 15 + counts.high * 5 + counts.medium * 2 + counts.low * 0.5
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

function aggregateSeverity(summaries: SecuritySummaryItem[]): Record<SecuritySeverity, number> {
  return summaries.reduce<Record<SecuritySeverity, number>>(
    (acc, item) => {
      acc.critical += item.critical ?? 0
      acc.high += item.high ?? 0
      acc.medium += item.medium ?? 0
      acc.low += item.low ?? 0
      return acc
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  )
}

function mapStep(raw: UnknownRecord): JobStep {
  return {
    stepId: pick<string>(raw, 'step_id', 'stepId') ?? '',
    stepName: pick<string>(raw, 'step_name', 'stepName') ?? '',
    stepType: pick<string>(raw, 'step_type', 'stepType') ?? '',
    status:
      (pick<JobStep['status']>(raw, 'status') as JobStep['status']) ?? 'pending',
    errorMessage: pick<string>(raw, 'error_message', 'errorMessage') ?? null,
    startedAt: pick<string>(raw, 'started_at', 'startedAt') ?? null,
    endedAt: pick<string>(raw, 'ended_at', 'endedAt', 'finished_at', 'finishedAt') ?? null,
    durationSecs: pick<number>(raw, 'duration_secs', 'durationSecs') ?? null,
  }
}

function mapJobDetail(raw: UnknownRecord): JobDetail {
  const job = (pick<UnknownRecord>(raw, 'job') ?? raw) as UnknownRecord
  const security = (pick<UnknownRecord>(raw, 'security') ?? {}) as UnknownRecord
  const verdictRaw = (pick<UnknownRecord>(security, 'verdict') ?? {}) as UnknownRecord
  const summariesRaw = (pick<unknown[]>(security, 'summaries') ?? []) as UnknownRecord[]
  const stepsRaw = (pick<unknown[]>(raw, 'steps') ?? []) as UnknownRecord[]

  const summaries: SecuritySummaryItem[] = summariesRaw.map((item) => ({
    scanner: pick<string>(item, 'scanner') ?? '',
    count: pick<number>(item, 'count') ?? 0,
    critical: pick<number>(item, 'critical') ?? 0,
    high: pick<number>(item, 'high') ?? 0,
    medium: pick<number>(item, 'medium') ?? 0,
    low: pick<number>(item, 'low') ?? 0,
  }))

  const severityCounts = aggregateSeverity(summaries)
  const totalFindings = pick<number>(verdictRaw, 'total_findings', 'totalFindings') ?? 0
  const startedAt = pick<string>(job, 'started_at', 'startedAt') ?? null
  const completedAt = pick<string>(job, 'completed_at', 'completedAt') ?? null
  const apiDuration = pick<number>(job, 'duration_secs', 'durationSecs')
  const durationSecs =
    typeof apiDuration === 'number' && apiDuration > 0
      ? apiDuration
      : durationBetween(startedAt, completedAt)
  const repoUrl = pick<string>(job, 'repo_url', 'repoUrl') ?? ''

  return {
    jobId: pick<string>(job, 'job_id', 'jobId') ?? '',
    repoUrl,
    repoName: repoNameFromUrl(repoUrl),
    branch: pick<string>(job, 'branch') ?? '',
    triggerSource: pick<string>(job, 'trigger_source', 'triggerSource') ?? '',
    status: (pick<JobStatus>(job, 'status') as JobStatus) ?? 'queued',
    overallResult: pick<string>(job, 'overall_result', 'overallResult') ?? null,
    createdAt: pick<string>(job, 'created_at', 'createdAt') ?? null,
    startedAt,
    completedAt,
    durationSecs,
    steps: stepsRaw.map(mapStep),
    verdict: (pick<JobVerdict>(verdictRaw, 'overall_status', 'overallStatus') as JobVerdict) ?? null,
    verdictReason: pick<string>(verdictRaw, 'status_reason', 'statusReason') ?? null,
    totalFindings,
    severityCounts,
    summaries,
    securityScore: computeSecurityScore(severityCounts),
  }
}

// Cross-checks the backend's reported status against step outcomes and,
// optionally, the security verdict. If any step failed, the run is a failure
// regardless of what `job.status` claims. The verdict-based override is
// opt-in via `considerVerdict` so callers that care only about pipeline
// EXECUTION (not security threshold) can keep `job.status` semantics.
export function deriveJobStatus(
  job: JobDetail,
  options?: { considerVerdict?: boolean },
): JobStatus {
  const considerVerdict = options?.considerVerdict ?? true
  if (job.status === 'queued') return 'queued'
  if (job.status === 'running') return 'running'
  if (job.status === 'cancelled') return 'cancelled'
  if (considerVerdict && job.verdict === 'failed') return 'failed'
  if (job.steps.some((step) => step.status === 'failed')) return 'failed'
  return job.status === 'failed' ? 'failed' : 'success'
}

export type GitHubCommitInfo = {
  sha: string
  message: string
  authorName: string
  authorLogin: string | null
  date: string
  htmlUrl: string
}

function parseCommitPayload(data: UnknownRecord): GitHubCommitInfo {
  const commit = (pick<UnknownRecord>(data, 'commit') ?? {}) as UnknownRecord
  const commitAuthor = (pick<UnknownRecord>(commit, 'author') ?? {}) as UnknownRecord
  const apiAuthor = (pick<UnknownRecord>(data, 'author') ?? {}) as UnknownRecord
  return {
    sha: pick<string>(data, 'sha') ?? '',
    message: pick<string>(commit, 'message') ?? '',
    authorName: pick<string>(commitAuthor, 'name') ?? '',
    authorLogin: pick<string>(apiAuthor, 'login') ?? null,
    date: pick<string>(commitAuthor, 'date') ?? '',
    htmlUrl: pick<string>(data, 'html_url', 'htmlUrl') ?? '',
  }
}

// Best-effort fetch of the latest commit on a branch. Tries the backend
// proxy first (matches our auth/CORS story) and falls back to api.github.com
// when the proxy doesn't expose this route — the backend currently
// documents only `/api/repos` and `.../branches`, so the proxy attempt
// usually 404s and we land on the direct GitHub call. The token is a
// GitHub OAuth access token per the backend spec, so the direct call
// authenticates the same way.
export async function fetchLatestCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<GitHubCommitInfo | null> {
  if (!owner || !repo || !branch) return null

  const proxyUrl = `${API_BASE}/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`
  try {
    const res = await fetch(proxyUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = (await res.json()) as UnknownRecord
      return parseCommitPayload(data)
    }
  } catch (error) {
    console.warn('[api] fetchLatestCommit proxy failed:', error)
  }

  // Direct GitHub fallback — api.github.com supports CORS for browser calls.
  const directUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`
  try {
    const res = await fetch(directUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as UnknownRecord
    return parseCommitPayload(data)
  } catch (error) {
    console.warn('[api] fetchLatestCommit direct GitHub failed:', error)
    return null
  }
}

const REPO_PIPELINE_INFO_PREFIX = 'secupipeline:repo-pipeline-info:'

export type RepoPipelineInfo = {
  /** Short or full SHA of the deployed commit (if extractable). */
  commitSha?: string
  /** First line of the commit message extracted from clone logs. */
  commitMessage?: string
  /** Branch the pipeline ran against. */
  branch?: string
  /** GitHub login of the user who triggered the run. */
  triggeredBy?: string
  /** ISO timestamp of when the run was created / started. */
  triggeredAt?: string
  /** Most recent observed JobStatus (used as a last-resort fallback for the
   *  repo detail page's "최근 상태" badge). */
  lastStatus?: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
}

export function getRepoPipelineInfo(
  cacheKey: string,
  repoIdentifier: string,
): RepoPipelineInfo | null {
  try {
    const raw = localStorage.getItem(
      `${REPO_PIPELINE_INFO_PREFIX}${cacheKey}:${repoIdentifier}`,
    )
    if (!raw) return null
    return JSON.parse(raw) as RepoPipelineInfo
  } catch {
    return null
  }
}

export function setRepoPipelineInfo(
  cacheKey: string,
  repoIdentifier: string,
  patch: Partial<RepoPipelineInfo>,
): void {
  try {
    const key = `${REPO_PIPELINE_INFO_PREFIX}${cacheKey}:${repoIdentifier}`
    const existing = getRepoPipelineInfo(cacheKey, repoIdentifier) ?? {}
    const merged: RepoPipelineInfo = { ...existing, ...patch }
    localStorage.setItem(key, JSON.stringify(merged))
  } catch {
    // ignore storage errors
  }
}

const REPO_DOMAIN_PREFIX = 'secupipeline:repo-domain:'

export function getRepoDomainUrl(cacheKey: string, repoId: string): string {
  try {
    return localStorage.getItem(`${REPO_DOMAIN_PREFIX}${cacheKey}:${repoId}`) ?? ''
  } catch {
    return ''
  }
}

export function setRepoDomainUrl(
  cacheKey: string,
  repoId: string,
  url: string,
): void {
  try {
    const key = `${REPO_DOMAIN_PREFIX}${cacheKey}:${repoId}`
    const trimmed = url.trim()
    if (trimmed) localStorage.setItem(key, trimmed)
    else localStorage.removeItem(key)
  } catch {
    // ignore storage errors
  }
}

const REPO_DETECT_PREFIX = 'secupipeline:repo-detect:'

export function getRepoDetectEnabled(cacheKey: string, repoId: string): boolean {
  try {
    return localStorage.getItem(`${REPO_DETECT_PREFIX}${cacheKey}:${repoId}`) === '1'
  } catch {
    return false
  }
}

export function setRepoDetectEnabled(
  cacheKey: string,
  repoId: string,
  enabled: boolean,
): void {
  try {
    const key = `${REPO_DETECT_PREFIX}${cacheKey}:${repoId}`
    if (enabled) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // ignore storage errors
  }
}

export async function fetchJobDetail(token: string, jobId: string): Promise<JobDetail | null> {
  const res = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 404) return null

  if (!res.ok) {
    console.error('[api] /api/jobs failed:', res.status)
    throw new Error(`Failed to fetch job ${jobId} (${res.status})`)
  }

  return mapJobDetail((await res.json()) as UnknownRecord)
}

function normalizeSeverity(raw: string | undefined | null): SecuritySeverity {
  const s = (raw ?? '').toLowerCase()
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s
  return 'low'
}

export type SecurityFinding = {
  id: string
  scanner: string
  ruleId: string
  cve: string | null
  cvss: string | null
  title: string
  severity: SecuritySeverity
  filePath: string
  lineStart: number | null
  lineEnd: number | null
  codeSnippet: string | null
  codeSnippetStartLine: number | null
  description: string
  aiSuggestion: string
  references: string[]
}

export type JobResult = {
  jobId: string
  repoUrl: string
  repoName: string
  branch: string
  completedAt: string | null
  securityScore: number | null
  codeQualityScore: number | null
  verdict: JobVerdict | null
  verdictReason: string | null
  totalFindings: number
  severitySummary: Record<SecuritySeverity, number>
  scannerSummaries: SecuritySummaryItem[]
  findings: SecurityFinding[]
}

function mapFinding(raw: UnknownRecord, idx: number): SecurityFinding {
  const lineStart =
    pick<number>(raw, 'line_start', 'lineStart', 'line_number', 'lineNumber') ?? null
  const lineEnd = pick<number>(raw, 'line_end', 'lineEnd') ?? lineStart
  const cvssRaw = pick<string | number>(raw, 'cvss')
  const refsRaw = pick<unknown[]>(raw, 'references')
  return {
    id: pick<string | number>(raw, 'id', 'finding_id', 'findingId') !== undefined
      ? String(pick<string | number>(raw, 'id', 'finding_id', 'findingId'))
      : String(idx),
    scanner: pick<string>(raw, 'scanner', 'scanner_name', 'scannerName') ?? '',
    ruleId: pick<string>(raw, 'rule_id', 'ruleId') ?? '',
    cve: pick<string>(raw, 'cve') ?? null,
    cvss: cvssRaw !== undefined && cvssRaw !== null ? String(cvssRaw) : null,
    title: pick<string>(raw, 'title', 'rule_id', 'ruleId') ?? '(제목 없음)',
    severity: normalizeSeverity(pick<string>(raw, 'severity')),
    filePath: pick<string>(raw, 'file_path', 'filePath') ?? '',
    lineStart,
    lineEnd,
    codeSnippet: pick<string>(raw, 'code_snippet', 'codeSnippet') ?? null,
    codeSnippetStartLine:
      pick<number>(raw, 'code_snippet_start_line', 'codeSnippetStartLine') ?? null,
    description: pick<string>(raw, 'description', 'message') ?? '',
    aiSuggestion:
      pick<string>(
        raw,
        'ai_suggestion',
        'aiSuggestion',
        'ai_recommendation',
        'aiRecommendation',
      ) ?? '',
    references: Array.isArray(refsRaw) ? (refsRaw as string[]) : [],
  }
}

function mapJobResult(raw: UnknownRecord): JobResult {
  const scores = (pick<UnknownRecord>(raw, 'scores') ?? {}) as UnknownRecord
  const verdictRaw = (pick<UnknownRecord>(raw, 'verdict') ?? {}) as UnknownRecord
  const findingsRaw = (pick<unknown[]>(raw, 'findings') ?? []) as UnknownRecord[]
  const scannerRaw = (pick<unknown[]>(
    raw,
    'scanner_summaries',
    'scannerSummaries',
    'summaries',
  ) ?? []) as UnknownRecord[]

  const findings = findingsRaw.map(mapFinding)

  const scannerSummaries: SecuritySummaryItem[] = scannerRaw.map((item) => ({
    scanner: pick<string>(item, 'scanner', 'scanner_name', 'scannerName') ?? '',
    count: pick<number>(item, 'count') ?? 0,
    critical: pick<number>(item, 'critical') ?? 0,
    high: pick<number>(item, 'high') ?? 0,
    medium: pick<number>(item, 'medium') ?? 0,
    low: pick<number>(item, 'low') ?? 0,
  }))

  // Prefer the backend's explicit severity_summary; fall back to aggregating
  // scanner summaries, then to counting findings — so the chart always has
  // numbers even if the backend omits one of the breakdowns.
  const severityRaw = (pick<UnknownRecord>(raw, 'severity_summary', 'severitySummary') ??
    {}) as UnknownRecord
  let severitySummary: Record<SecuritySeverity, number> = {
    critical: pick<number>(severityRaw, 'critical') ?? 0,
    high: pick<number>(severityRaw, 'high') ?? 0,
    medium: pick<number>(severityRaw, 'medium') ?? 0,
    low: pick<number>(severityRaw, 'low') ?? 0,
  }
  const severityTotal =
    severitySummary.critical + severitySummary.high + severitySummary.medium + severitySummary.low
  if (severityTotal === 0 && scannerSummaries.length > 0) {
    severitySummary = aggregateSeverity(scannerSummaries)
  }
  if (
    severitySummary.critical + severitySummary.high + severitySummary.medium + severitySummary.low ===
      0 &&
    findings.length > 0
  ) {
    severitySummary = findings.reduce<Record<SecuritySeverity, number>>(
      (acc, f) => {
        acc[f.severity] += 1
        return acc
      },
      { critical: 0, high: 0, medium: 0, low: 0 },
    )
  }

  const repoUrl = pick<string>(raw, 'repo_url', 'repoUrl') ?? ''
  const securityScore = pick<number>(scores, 'security_score', 'securityScore')
  const codeQualityScore = pick<number>(scores, 'code_quality_score', 'codeQualityScore')
  const totalFindings =
    pick<number>(verdictRaw, 'total_findings', 'totalFindings') ?? findings.length

  return {
    jobId: pick<string>(raw, 'job_id', 'jobId') ?? '',
    repoUrl,
    repoName: repoNameFromUrl(repoUrl),
    branch: pick<string>(raw, 'branch') ?? '',
    completedAt: pick<string>(raw, 'completed_at', 'completedAt') ?? null,
    securityScore:
      typeof securityScore === 'number'
        ? securityScore
        : computeSecurityScore(severitySummary),
    codeQualityScore: typeof codeQualityScore === 'number' ? codeQualityScore : null,
    verdict:
      (pick<JobVerdict>(verdictRaw, 'overall_status', 'overallStatus') as JobVerdict) ?? null,
    verdictReason: pick<string>(verdictRaw, 'status_reason', 'statusReason') ?? null,
    totalFindings,
    severitySummary,
    scannerSummaries,
    findings,
  }
}

// Fetch the detailed security result for a finished job (§3.9). Returns null
// when the job has no result yet — either because the endpoint isn't there
// (404) or the job hasn't finished (425 Too Early). Callers fall back to the
// job-detail summary in that case.
export async function fetchJobResult(
  token: string,
  jobId: string,
): Promise<JobResult | null> {
  const res = await fetch(
    `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/result`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  // 404: endpoint/job not found. 425: job not finished — no result yet.
  if (res.status === 404 || res.status === 425) return null

  if (!res.ok) {
    console.error('[api] /api/jobs/{id}/result failed:', res.status)
    throw new Error(`Failed to fetch job result ${jobId} (${res.status})`)
  }

  return mapJobResult((await res.json()) as UnknownRecord)
}

export type PipelineEnvironment = 'development' | 'feature' | 'staging' | 'production'

export type StartPipelinePayload = {
  repoUrl: string
  branch?: string
  /** Deployment environment. production/staging는 더 엄격 — Medium도 승인 필요로
   *  승격됨 (백엔드 게이트 정책). */
  environment?: PipelineEnvironment
  triggerSource?: string
  /** Security check identifiers the user selected — only these run. Sent as
   *  the top-level `selected_items` field; CWE id ("CWE-89") or key
   *  ("sql-injection") 둘 다 허용되지만 일관되게 CWE id를 보냄. */
  selectedItems?: string[]
  /** Latest commit SHA of the selected repo+branch (best-effort). */
  commitSha?: string
  /** First run for this repo → backend runs the full baseline regardless. */
  isFirstRun?: boolean
}

export type StartPipelineResponse = {
  jobId: string
  status: string
  message: string
}

export async function startPipeline(
  token: string,
  payload: StartPipelinePayload,
): Promise<StartPipelineResponse> {
  const body: UnknownRecord = { repo_url: payload.repoUrl }
  if (payload.branch) body.branch = payload.branch
  if (payload.environment) body.environment = payload.environment
  if (payload.triggerSource) body.trigger_source = payload.triggerSource
  // Only the selected checks run (CWE ids). Per spec A-3.
  if (payload.selectedItems && payload.selectedItems.length > 0) {
    body.selected_items = payload.selectedItems
  }
  if (payload.commitSha) body.commit_sha = payload.commitSha
  if (payload.isFirstRun !== undefined) body.is_first_run = payload.isFirstRun

  const res = await fetch(`${API_BASE}/api/pipelines`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[api] /api/pipelines failed:', res.status, text)
    let detail = ''
    let parsed: UnknownRecord | null = null
    try {
      parsed = JSON.parse(text) as UnknownRecord
      detail = pick<string>(parsed, 'detail', 'message') ?? ''
    } catch {
      detail = text
    }
    if (res.status === 409) {
      const existingJobId =
        (parsed
          ? pick<string>(parsed, 'existing_job_id', 'existingJobId', 'job_id', 'jobId')
          : undefined) ?? null
      throw new PipelineConflictError(detail, existingJobId)
    }
    throw new Error(
      detail
        ? `파이프라인 시작 실패 (${res.status}): ${detail}`
        : `파이프라인 시작 실패 (${res.status})`,
    )
  }

  const data = (await res.json()) as UnknownRecord
  return {
    jobId: pick<string>(data, 'job_id', 'jobId') ?? '',
    status: pick<string>(data, 'status') ?? '',
    message: pick<string>(data, 'message') ?? '',
  }
}

export type CancelPipelineResponse = {
  jobId: string
  status: string
  killed: boolean
  message: string
}

export async function cancelPipeline(
  token: string,
  jobId: string,
): Promise<CancelPipelineResponse> {
  const res = await fetch(
    `${API_BASE}/api/pipelines/${encodeURIComponent(jobId)}/cancel`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[api] /api/pipelines/{id}/cancel failed:', res.status, text)
    let detail = ''
    try {
      const parsed = JSON.parse(text) as UnknownRecord
      detail = pick<string>(parsed, 'detail', 'message') ?? ''
    } catch {
      detail = text
    }
    throw new Error(
      detail
        ? `파이프라인 취소 실패 (${res.status}): ${detail}`
        : `파이프라인 취소 실패 (${res.status})`,
    )
  }

  const data = (await res.json()) as UnknownRecord
  return {
    jobId: pick<string>(data, 'job_id', 'jobId') ?? jobId,
    status: pick<string>(data, 'status') ?? 'cancelled',
    killed: pick<boolean>(data, 'killed') ?? false,
    message: pick<string>(data, 'message') ?? '',
  }
}

export async function deletePipeline(token: string, jobId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/pipelines/${encodeURIComponent(jobId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '')
    console.error('[api] DELETE /api/pipelines/{id} failed:', res.status, text)
    let detail = ''
    try {
      const parsed = JSON.parse(text) as UnknownRecord
      detail = pick<string>(parsed, 'detail', 'message') ?? ''
    } catch {
      detail = text
    }
    throw new Error(
      detail
        ? `파이프라인 삭제 실패 (${res.status}): ${detail}`
        : `파이프라인 삭제 실패 (${res.status})`,
    )
  }
}

export async function fetchPipelineLogs(
  token: string,
  jobId: string,
): Promise<string[]> {
  const res = await fetch(
    `${API_BASE}/api/pipelines/${encodeURIComponent(jobId)}/logs`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    console.error('[api] /api/pipelines/{id}/logs failed:', res.status)
    return []
  }

  const data = (await res.json()) as UnknownRecord
  const lines = pick<unknown[]>(data, 'lines')
  return Array.isArray(lines) ? (lines as string[]) : []
}

export async function fetchPipelineSteps(
  token: string,
  jobId: string,
): Promise<JobStep[]> {
  const res = await fetch(
    `${API_BASE}/api/pipelines/${encodeURIComponent(jobId)}/steps`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    console.error('[api] /api/pipelines/{id}/steps failed:', res.status)
    return []
  }

  const data = (await res.json()) as UnknownRecord
  const steps = pick<unknown[]>(data, 'steps')
  return Array.isArray(steps) ? (steps as UnknownRecord[]).map(mapStep) : []
}

export async function fetchJobsByIds(
  token: string,
  jobIds: string[],
): Promise<JobDetail[]> {
  const results = await Promise.all(
    jobIds.map(async (id) => {
      try {
        return await fetchJobDetail(token, id)
      } catch (error) {
        console.error(`[api] failed to fetch job ${id}:`, error)
        return null
      }
    }),
  )
  return results.filter((job): job is JobDetail => job !== null)
}

const JOB_TRACK_PREFIX = 'secupipeline:jobs:'

export function getTrackedJobIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(JOB_TRACK_PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { ids?: string[] }
    return Array.isArray(parsed.ids) ? parsed.ids : []
  } catch {
    return []
  }
}

function writeTrackedJobIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(JOB_TRACK_PREFIX + key, JSON.stringify({ ids }))
  } catch {
    // storage quota or unavailable — ignore
  }
}

export function addTrackedJobId(key: string, jobId: string): string[] {
  const ids = getTrackedJobIds(key)
  if (ids.includes(jobId)) return ids
  const next = [jobId, ...ids]
  writeTrackedJobIds(key, next)
  return next
}

export function removeTrackedJobId(key: string, jobId: string): string[] {
  const next = getTrackedJobIds(key).filter((id) => id !== jobId)
  writeTrackedJobIds(key, next)
  return next
}

const LAUNCHED_REPOS_PREFIX = 'secupipeline:launched-repos:'

function normalizeRepoKey(raw: string): string {
  if (!raw) return ''
  let key = raw.trim().toLowerCase()
  key = key.replace(/^https?:\/\/(www\.)?github\.com\//, '')
  key = key.replace(/\.git$/, '')
  key = key.replace(/\/+$/, '')
  return key
}

export function getLaunchedRepos(cacheKey: string): string[] {
  try {
    const raw = localStorage.getItem(LAUNCHED_REPOS_PREFIX + cacheKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { urls?: string[]; keys?: string[] }
    const list = parsed.keys ?? parsed.urls ?? []
    return Array.isArray(list) ? list.map(normalizeRepoKey).filter(Boolean) : []
  } catch {
    return []
  }
}

export function hasLaunchedRepo(cacheKey: string, repoIdentifier: string): boolean {
  const target = normalizeRepoKey(repoIdentifier)
  if (!target) return false
  return getLaunchedRepos(cacheKey).includes(target)
}

export function addLaunchedRepo(cacheKey: string, repoIdentifier: string): string[] {
  const normalized = normalizeRepoKey(repoIdentifier)
  if (!normalized) return getLaunchedRepos(cacheKey)
  const list = getLaunchedRepos(cacheKey)
  if (list.includes(normalized)) return list
  const next = [...list, normalized]
  try {
    localStorage.setItem(LAUNCHED_REPOS_PREFIX + cacheKey, JSON.stringify({ keys: next }))
  } catch {
    // ignore
  }
  return next
}

// Back-compat aliases (kept so existing imports keep compiling)
export const getLaunchedRepoUrls = getLaunchedRepos
export const hasLaunchedRepoBefore = hasLaunchedRepo
export const addLaunchedRepoUrl = addLaunchedRepo

const REPO_CACHE_PREFIX = 'secupipeline:repos:'

export function getCachedRepos(key: string): RepositoryItem[] | null {
  try {
    const raw = localStorage.getItem(REPO_CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { repos?: RepositoryItem[] }
    return Array.isArray(parsed.repos) ? parsed.repos : null
  } catch {
    return null
  }
}

export function setCachedRepos(key: string, repos: RepositoryItem[]): void {
  try {
    localStorage.setItem(
      REPO_CACHE_PREFIX + key,
      JSON.stringify({ timestamp: Date.now(), repos }),
    )
  } catch {
    // storage quota or unavailable — ignore
  }
}

export async function fetchReposWithBranches(token: string): Promise<RepositoryItem[]> {
  const repos = await fetchRepos(token)
  const enriched = await Promise.all(
    repos.map(async (repo) => {
      const [owner, name] = repo.name.split('/')
      if (!owner || !name) return repo
      const branches = await fetchBranches(token, owner, name)
      if (branches.length === 0) return repo
      const defaultBranch = repo.source.branch
      const ordered = defaultBranch
        ? [defaultBranch, ...branches.filter((b) => b !== defaultBranch)]
        : branches
      return { ...repo, branches: ordered }
    }),
  )
  return enriched
}
