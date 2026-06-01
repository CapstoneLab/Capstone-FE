import type { RepositoryItem } from '@/data/repositories'
import {
  descriptionForKey,
  type CheckSeverity,
  type SecurityCheckItem,
} from '@/data/securityCatalog'

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
  /** Matched policy item name (CWE selection). null => detected outside the
   *  16-item policy set ("16항목 외"). */
  policyItem: string | null
  /** CWE id, e.g. "CWE-89". Classification is by CWE, not CVE. */
  cwe: string | null
  /** Whether this finding is within the selected check scope. false => shown
   *  dimmed under the "정책 범위 밖" section, no gate impact. */
  inScope: boolean
  cve: string | null
  cvss: string | null
  cvssScore: number | null
  title: string
  severity: SecuritySeverity
  filePath: string
  lineNumber: number | null
  columnNumber: number | null
  lineStart: number | null
  lineEnd: number | null
  codeSnippet: string | null
  codeSnippetStartLine: number | null
  description: string
  aiSuggestion: string
  references: string[]
}

// The 4-state deployment gate verdict (화면 B). NOT the same as JobVerdict
// (passed/warning/failed) used by the summary endpoint — this is the richer
// gate model from GET /api/jobs/{id}/result → security.verdict.
export type VerdictKind = 'pass' | 'warn' | 'block_pending_approval' | 'block'

// The verdict object is consumed VERBATIM — colors, labels and reasons are
// pre-computed by the backend and must NOT be re-derived on the frontend
// (spec B-0: "그대로 사용, 재계산 금지").
export type JobVerdictDetail = {
  verdict: VerdictKind | null
  /** Gauge/banner color — use directly, never recompute from score. */
  gaugeColor: string | null
  score: number | null
  /** e.g. "82.0/100 (검사 항목 9개 기준)" — print as-is. */
  scoreLabel: string | null
  /** In-scope severity counts. */
  counts: Record<SecuritySeverity, number>
  /** CWE ids the user selected for this run. */
  selectedItems: string[]
  selectedCount: number | null
  /** Findings detected outside the selected scope. >0 => B-3 banner. */
  outOfScopeCount: number
  /** true => approval path exists (화면 C CTA). */
  requiresApproval: boolean
  blockReasons: string[]
  warnReasons: string[]
  /** Per-severity score deductions. */
  scoreBreakdown: Record<SecuritySeverity, number>
  /** Commit actually scanned; compare with requested (B-4). */
  scannedCommitSha: string | null
  requestedCommitSha: string | null
  commitMismatch: boolean
  /** CWEs that passed the gate under approval (B-5). */
  acknowledgedCwes: string[]
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
  /** Rich gate verdict (new model). null when the backend returns only the
   *  legacy flat shape — the page then falls back to the legacy verdict. */
  verdictDetail: JobVerdictDetail | null
  totalFindings: number
  severitySummary: Record<SecuritySeverity, number>
  scannerSummaries: SecuritySummaryItem[]
  findings: SecurityFinding[]
}

function mapFinding(raw: UnknownRecord, idx: number): SecurityFinding {
  const lineNumber =
    pick<number>(raw, 'line_number', 'lineNumber', 'line_start', 'lineStart') ?? null
  const lineEnd = pick<number>(raw, 'line_end', 'lineEnd') ?? lineNumber
  const cvssRaw = pick<string | number>(raw, 'cvss')
  const refsRaw = pick<unknown[]>(raw, 'references')
  // in_scope defaults to true: legacy payloads have no scope concept, so
  // treat every finding as in-scope unless the backend explicitly flags it.
  const inScopeRaw = pick<boolean>(raw, 'in_scope', 'inScope')
  const policyItem = pick<string>(raw, 'policy_item', 'policyItem') ?? null
  return {
    id: pick<string | number>(raw, 'id', 'finding_id', 'findingId') !== undefined
      ? String(pick<string | number>(raw, 'id', 'finding_id', 'findingId'))
      : String(idx),
    scanner: pick<string>(raw, 'scanner', 'scanner_name', 'scannerName') ?? '',
    ruleId: pick<string>(raw, 'rule_id', 'ruleId') ?? '',
    policyItem,
    cwe: pick<string>(raw, 'cwe', 'cwe_id', 'cweId') ?? null,
    inScope: inScopeRaw ?? true,
    cve: pick<string>(raw, 'cve') ?? null,
    cvss: cvssRaw !== undefined && cvssRaw !== null ? String(cvssRaw) : null,
    cvssScore: pick<number>(raw, 'cvss_score', 'cvssScore') ?? null,
    title: pick<string>(raw, 'title', 'rule_id', 'ruleId') ?? '(제목 없음)',
    severity: normalizeSeverity(pick<string>(raw, 'severity')),
    filePath: pick<string>(raw, 'file_path', 'filePath') ?? '',
    lineNumber,
    columnNumber: pick<number>(raw, 'column_number', 'columnNumber') ?? null,
    lineStart: lineNumber,
    lineEnd,
    codeSnippet: pick<string>(raw, 'code_snippet', 'codeSnippet') ?? null,
    codeSnippetStartLine:
      pick<number>(raw, 'code_snippet_start_line', 'codeSnippetStartLine') ?? null,
    description: pick<string>(raw, 'message', 'description') ?? '',
    aiSuggestion:
      pick<string>(
        raw,
        'ai_recommendation',
        'aiRecommendation',
        'ai_suggestion',
        'aiSuggestion',
      ) ?? '',
    references: Array.isArray(refsRaw) ? (refsRaw as string[]) : [],
  }
}

function parseSeverityCounts(obj: UnknownRecord | undefined): Record<SecuritySeverity, number> {
  const o = obj ?? {}
  return {
    critical: pick<number>(o, 'critical') ?? 0,
    high: pick<number>(o, 'high') ?? 0,
    medium: pick<number>(o, 'medium') ?? 0,
    low: pick<number>(o, 'low') ?? 0,
  }
}

function mapJobResult(raw: UnknownRecord): JobResult {
  // The new shape nests everything under `security`; the legacy flat shape
  // puts verdict/findings at the top level. Support both.
  const security = (pick<UnknownRecord>(raw, 'security') ?? raw) as UnknownRecord
  const scores = (pick<UnknownRecord>(raw, 'scores') ?? {}) as UnknownRecord
  // §3-4 actual shape: `security.verdict` is a STRING ("block") and
  // score / gauge_color / *_count / block_reasons sit DIRECTLY on `security`
  // as siblings. A nested-object form (security.verdict = {...}) is also
  // tolerated. The legacy summary endpoint's verdict.overall_status is handled
  // by mapJobDetail, not here.
  const rawVerdictField = security['verdict']
  const verdictObj: UnknownRecord =
    rawVerdictField && typeof rawVerdictField === 'object'
      ? (rawVerdictField as UnknownRecord)
      : security
  const verdictKind =
    typeof rawVerdictField === 'string'
      ? rawVerdictField
      : pick<string>(verdictObj, 'verdict')

  const findingsRaw = (pick<unknown[]>(security, 'findings') ??
    pick<unknown[]>(raw, 'findings') ??
    []) as UnknownRecord[]
  const scannerRaw = (pick<unknown[]>(
    security,
    'summaries',
    'scanner_summaries',
    'scannerSummaries',
  ) ??
    pick<unknown[]>(raw, 'scanner_summaries', 'scannerSummaries', 'summaries') ??
    []) as UnknownRecord[]

  const findings = findingsRaw.map(mapFinding)

  // Build the rich gate verdict ONLY when the new model is recognizable —
  // otherwise leave it null so the page falls back to the legacy verdict.
  const isNewVerdict =
    verdictKind === 'pass' ||
    verdictKind === 'warn' ||
    verdictKind === 'block_pending_approval' ||
    verdictKind === 'block' ||
    pick(verdictObj, 'gauge_color', 'gaugeColor', 'score_label', 'scoreLabel', 'out_of_scope_count') !==
      undefined

  // counts: prefer a nested `counts` object, else the flat *_count fields the
  // backend actually returns (critical_count/high_count/...).
  const countsObj = pick<UnknownRecord>(verdictObj, 'counts')
  const counts: Record<SecuritySeverity, number> = countsObj
    ? parseSeverityCounts(countsObj)
    : {
        critical: pick<number>(verdictObj, 'critical_count', 'criticalCount') ?? 0,
        high: pick<number>(verdictObj, 'high_count', 'highCount') ?? 0,
        medium: pick<number>(verdictObj, 'medium_count', 'mediumCount') ?? 0,
        low: pick<number>(verdictObj, 'low_count', 'lowCount') ?? 0,
      }

  const requestedCommitSha =
    pick<string>(verdictObj, 'requested_commit_sha', 'requestedCommitSha') ??
    pick<string>(raw, 'commit_sha', 'commitSha', 'requested_commit_sha') ??
    null
  const scannedCommitSha =
    pick<string>(verdictObj, 'scanned_commit_sha', 'scannedCommitSha') ??
    pick<string>(raw, 'scanned_commit_sha', 'scannedCommitSha') ??
    null
  const explicitMismatch = pick<boolean>(verdictObj, 'commit_mismatch', 'commitMismatch')
  const commitMismatch =
    explicitMismatch ??
    (!!requestedCommitSha && !!scannedCommitSha && requestedCommitSha !== scannedCommitSha)

  // acknowledged_cwes may live on the verdict OR on a top-level `approval`.
  const approvalObj = pick<UnknownRecord>(raw, 'approval')
  const ackRaw =
    pick<unknown[]>(verdictObj, 'acknowledged_cwes', 'acknowledgedCwes') ??
    (approvalObj
      ? pick<unknown[]>(approvalObj, 'acknowledged_cwes', 'acknowledgedCwes')
      : undefined)
  const selRaw = pick<unknown[]>(verdictObj, 'selected_items', 'selectedItems')
  const blockReasonsRaw = pick<unknown[]>(verdictObj, 'block_reasons', 'blockReasons')
  const warnReasonsRaw = pick<unknown[]>(verdictObj, 'warn_reasons', 'warnReasons')

  const verdictDetail: JobVerdictDetail | null = isNewVerdict
    ? {
        verdict: (verdictKind as VerdictKind) ?? null,
        gaugeColor: pick<string>(verdictObj, 'gauge_color', 'gaugeColor') ?? null,
        score: pick<number>(verdictObj, 'score') ?? null,
        scoreLabel: pick<string>(verdictObj, 'score_label', 'scoreLabel') ?? null,
        counts,
        selectedItems: Array.isArray(selRaw) ? (selRaw as string[]) : [],
        selectedCount: pick<number>(verdictObj, 'selected_count', 'selectedCount') ?? null,
        outOfScopeCount: pick<number>(verdictObj, 'out_of_scope_count', 'outOfScopeCount') ?? 0,
        requiresApproval: pick<boolean>(verdictObj, 'requires_approval', 'requiresApproval') ?? false,
        blockReasons: Array.isArray(blockReasonsRaw) ? (blockReasonsRaw as string[]) : [],
        warnReasons: Array.isArray(warnReasonsRaw) ? (warnReasonsRaw as string[]) : [],
        scoreBreakdown: parseSeverityCounts(
          pick<UnknownRecord>(verdictObj, 'score_breakdown', 'scoreBreakdown'),
        ),
        scannedCommitSha,
        requestedCommitSha,
        commitMismatch,
        acknowledgedCwes: Array.isArray(ackRaw) ? (ackRaw as string[]) : [],
      }
    : null

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
    pick<number>(verdictObj, 'total_findings', 'totalFindings') ?? findings.length

  return {
    jobId: pick<string>(raw, 'job_id', 'jobId') ?? '',
    repoUrl,
    repoName: repoNameFromUrl(repoUrl),
    branch: pick<string>(raw, 'branch') ?? '',
    completedAt: pick<string>(raw, 'completed_at', 'completedAt') ?? null,
    // Prefer the verdict's pre-computed score (new model) — never recompute
    // when the backend already gave us one.
    securityScore:
      verdictDetail?.score ??
      (typeof securityScore === 'number' ? securityScore : computeSecurityScore(severitySummary)),
    codeQualityScore: typeof codeQualityScore === 'number' ? codeQualityScore : null,
    verdict:
      (pick<JobVerdict>(verdictObj, 'overall_status', 'overallStatus') as JobVerdict) ?? null,
    verdictReason: pick<string>(verdictObj, 'status_reason', 'statusReason') ?? null,
    verdictDetail,
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

// Raised when the approval endpoints return 403 — the caller (보안책임자/
// 팀리드가 아닌 개발자 본인 등) lacks approval rights. The UI surfaces this as
// a permission notice instead of a generic error (화면 C C-2 / C-5).
export class ApprovalForbiddenError extends Error {
  readonly status = 403
  readonly detail: string
  constructor(detail: string) {
    super(detail || '승인 권한이 없습니다. 보안책임자/팀리드 권한이 필요합니다.')
    this.name = 'ApprovalForbiddenError'
    this.detail = detail
  }
}

export type ApprovalResponse = {
  status: string
  /** Backend auto-enqueues a follow-up job on approve — track via this id. */
  followupJobId: string | null
  /** CWEs accepted under approval (echoed back). Connects to B-5. */
  acknowledgedCwes: string[]
  message: string
}

async function postApproval(
  token: string,
  jobId: string,
  action: 'request' | 'approve' | 'reject',
  body: UnknownRecord,
): Promise<ApprovalResponse> {
  const res = await fetch(
    `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/approval/${action}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = ''
    try {
      detail = pick<string>(JSON.parse(text) as UnknownRecord, 'detail', 'message') ?? ''
    } catch {
      detail = text
    }
    console.error(`[api] /approval/${action} failed:`, res.status, text)
    if (res.status === 403) throw new ApprovalForbiddenError(detail)
    throw new Error(
      detail ? `승인 처리 실패 (${res.status}): ${detail}` : `승인 처리 실패 (${res.status})`,
    )
  }

  const data = (await res.json().catch(() => ({}))) as UnknownRecord
  const ack = pick<unknown[]>(data, 'acknowledged_cwes', 'acknowledgedCwes')
  return {
    status: pick<string>(data, 'status') ?? 'ok',
    followupJobId: pick<string>(data, 'followup_job_id', 'followupJobId') ?? null,
    acknowledgedCwes: Array.isArray(ack) ? (ack as string[]) : [],
    message: pick<string>(data, 'message') ?? '',
  }
}

// C-1: create an approval request → "승인 대기" 상태.
export function requestApproval(
  token: string,
  jobId: string,
  reason?: string,
): Promise<ApprovalResponse> {
  return postApproval(token, jobId, 'request', reason ? { reason } : {})
}

// C-2 (전체 승인) / C-3 (부분 승인). Omit approvedCwes → 전체 수용; pass a subset
// of CWE ids → only those are accepted, the rest stay blocked.
export function approveJob(
  token: string,
  jobId: string,
  reason: string,
  approvedCwes?: string[],
): Promise<ApprovalResponse> {
  const body: UnknownRecord = { reason }
  if (approvedCwes && approvedCwes.length > 0) body.approved_cwes = approvedCwes
  return postApproval(token, jobId, 'approve', body)
}

// C-2: reject — 수용 불가, 즉시 수정 필요.
export function rejectJob(
  token: string,
  jobId: string,
  reason: string,
): Promise<ApprovalResponse> {
  return postApproval(token, jobId, 'reject', { reason })
}

// 화면 D — 감사 로그 (append-only 승인 이력).
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export type ApprovalLogEntry = {
  id: string
  jobId: string
  /** Commit actually scanned (B-4 추적 뷰). */
  scannedCommitSha: string | null
  requestedCommitSha: string | null
  commitMismatch: boolean
  /** 대상 CWE 목록. */
  cwes: string[]
  reason: string
  approver: string
  status: ApprovalStatus
  /** 일시 (요청/처리 시각). */
  createdAt: string | null
  /** 만료 — null이면 무기한 아님(보통 커밋 한정). */
  expiresAt: string | null
}

function mapApprovalEntry(raw: UnknownRecord, idx: number): ApprovalLogEntry {
  const scannedCommitSha =
    pick<string>(raw, 'scanned_commit_sha', 'scannedCommitSha', 'commit', 'commit_sha') ?? null
  const requestedCommitSha =
    pick<string>(raw, 'requested_commit_sha', 'requestedCommitSha') ?? null
  const explicitMismatch = pick<boolean>(raw, 'commit_mismatch', 'commitMismatch')
  const cwesRaw = pick<unknown[]>(raw, 'cwes', 'target_cwes', 'targetCwes', 'approved_cwes', 'approvedCwes')
  const rawStatus = (pick<string>(raw, 'status') ?? 'pending').toLowerCase()
  const status: ApprovalStatus =
    rawStatus === 'approved' || rawStatus === 'rejected' ? rawStatus : 'pending'
  return {
    id:
      pick<string | number>(raw, 'id', 'approval_id', 'approvalId') !== undefined
        ? String(pick<string | number>(raw, 'id', 'approval_id', 'approvalId'))
        : String(idx),
    jobId: pick<string>(raw, 'job_id', 'jobId') ?? '',
    scannedCommitSha,
    requestedCommitSha,
    commitMismatch:
      explicitMismatch ??
      (!!requestedCommitSha && !!scannedCommitSha && requestedCommitSha !== scannedCommitSha),
    cwes: Array.isArray(cwesRaw) ? (cwesRaw as string[]) : [],
    reason: pick<string>(raw, 'reason') ?? '',
    approver: pick<string>(raw, 'approver', 'approved_by', 'approvedBy', 'reviewer') ?? '',
    status,
    createdAt:
      pick<string>(raw, 'created_at', 'createdAt', 'requested_at', 'requestedAt', 'at') ?? null,
    expiresAt: pick<string>(raw, 'expires_at', 'expiresAt', 'expiry') ?? null,
  }
}

// GET /api/approvals?status=... — append-only approval history. `status`
// omitted returns all. Returns [] on failure so the audit view degrades
// gracefully rather than blanking.
export async function fetchApprovals(
  token: string,
  status?: ApprovalStatus,
): Promise<ApprovalLogEntry[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await fetch(`${API_BASE}/api/approvals${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    console.error('[api] /api/approvals failed:', res.status)
    if (res.status === 401) {
      const text = await res.text().catch(() => '')
      throw new AuthExpiredError(text || '인증이 만료되었습니다. 다시 로그인해 주세요.')
    }
    throw new Error(`Failed to fetch approvals (${res.status})`)
  }

  const data = (await res.json()) as unknown
  const list = Array.isArray(data)
    ? (data as UnknownRecord[])
    : (pick<unknown[]>(data as UnknownRecord, 'approvals', 'items', 'results') ?? [])
  return (list as UnknownRecord[]).map(mapApprovalEntry)
}

export type PipelineEnvironment = 'development' | 'feature' | 'staging' | 'production'

// GET /api/security/catalog — the 16-item security policy catalog. Returns
// [] on failure so callers fall back to the bundled local catalog. Maps the
// backend's {key,name,cwe,grade} to our SecurityCheckItem, reusing local
// descriptions (the API carries none).
function normalizeGrade(grade: string | undefined): CheckSeverity {
  const g = (grade ?? '').toLowerCase()
  return g === 'critical' || g === 'high' || g === 'medium' || g === 'low' ? g : 'low'
}

export async function fetchSecurityCatalog(token: string): Promise<SecurityCheckItem[]> {
  const res = await fetch(`${API_BASE}/api/security/catalog`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[api] /api/security/catalog failed:', res.status)
    return []
  }
  const data = (await res.json()) as UnknownRecord
  const items = (pick<unknown[]>(data, 'items') ?? []) as UnknownRecord[]
  return items
    .map((it) => {
      const key = pick<string>(it, 'key', 'id') ?? ''
      return {
        id: key,
        title: pick<string>(it, 'name', 'title') ?? key,
        cwe: pick<string>(it, 'cwe', 'cwe_id') ?? '',
        severity: normalizeGrade(pick<string>(it, 'grade', 'severity')),
        description: pick<string>(it, 'description') ?? descriptionForKey(key),
      }
    })
    .filter((c) => c.id)
}

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
  // Only the selected checks run — catalog keys (e.g. "sql-injection").
  if (payload.selectedItems && payload.selectedItems.length > 0) {
    body.selected_items = payload.selectedItems
  }
  if (payload.commitSha) body.commit_sha = payload.commitSha
  if (payload.isFirstRun !== undefined) body.is_first_run = payload.isFirstRun

  // Backend pipeline-start endpoint (per backend spec 3-2).
  const res = await fetch(`${API_BASE}/start-pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[api] /start-pipeline failed:', res.status, text)
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
