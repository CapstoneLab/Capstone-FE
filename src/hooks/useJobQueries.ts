import { useQuery, type QueryClient } from '@tanstack/react-query'
import {
  fetchJobDetail,
  fetchJobResult,
  fetchPipelineDeployment,
  fetchPipelineLogs,
  fetchPipelineSteps,
  type JobDetail,
  type JobResult,
  type PipelineStepsResponse,
} from '@/lib/api'
import { isTerminalJobStatus, mergeLogSnapshot, type LogEntry } from '@/lib/pipelineExecution'

// Query keys for one pipeline run. Everything for a run lives under
// ['job', jobId] so a single invalidation refreshes all of it.
export const jobKeys = {
  all: ['job'] as const,
  run: (jobId: string) => ['job', jobId] as const,
  detail: (jobId: string) => ['job', jobId, 'detail'] as const,
  steps: (jobId: string) => ['job', jobId, 'steps'] as const,
  result: (jobId: string) => ['job', jobId, 'result'] as const,
  execution: (jobId: string) => ['job', jobId, 'execution'] as const,
}

// Which run queries are written to disk (see src/lib/queryClient.ts). The
// execution snapshot carries the full log and stays memory-only.
export const PERSISTED_JOB_PARTS = new Set(['detail', 'steps', 'result'])

const LIVE_STALE_MS = 5_000

// A finished run never changes again → cache it for good.
function detailStaleTime(detail: JobDetail | null | undefined): number {
  return detail && isTerminalJobStatus(detail.status) ? Infinity : LIVE_STALE_MS
}

function stepsStaleTime(steps: PipelineStepsResponse | null | undefined): number {
  const status = steps?.job?.status
  return status && isTerminalJobStatus(status) ? Infinity : LIVE_STALE_MS
}

// A result is final once a verdict is in and it is not waiting on approval;
// an approval-pending result can still change (approve/reject), so keep it short.
function resultStaleTime(result: JobResult | null | undefined): number {
  if (!result) return LIVE_STALE_MS
  const vd = result.verdictDetail
  if (vd?.overallStatus === 'pending' || vd?.verdict === 'block_pending_approval') return 15_000
  return Infinity
}

type Q<T> = { state: { data: T | undefined } }

function detailQueryOptions(token: string, jobId: string) {
  return {
    queryKey: jobKeys.detail(jobId),
    queryFn: () => fetchJobDetail(token, jobId),
    staleTime: (q: Q<JobDetail | null>) => detailStaleTime(q.state.data),
  }
}

function stepsQueryOptions(token: string, jobId: string) {
  return {
    queryKey: jobKeys.steps(jobId),
    queryFn: () => fetchPipelineSteps(token, jobId),
    staleTime: (q: Q<PipelineStepsResponse | null>) => stepsStaleTime(q.state.data),
  }
}

function resultQueryOptions(token: string, jobId: string) {
  return {
    queryKey: jobKeys.result(jobId),
    queryFn: () => fetchJobResult(token, jobId),
    staleTime: (q: Q<JobResult | null>) => resultStaleTime(q.state.data),
  }
}

export function useJobDetailQuery(token: string | null, jobId: string) {
  return useQuery({
    ...detailQueryOptions(token ?? '', jobId),
    enabled: !!token && !!jobId,
  })
}

export function useJobResultQuery(token: string | null, jobId: string) {
  return useQuery({
    ...resultQueryOptions(token ?? '', jobId),
    enabled: !!token && !!jobId,
  })
}

// ── Imperative cached reads (for code outside React render) ───────────────

/** Job detail through the cache: a finished run is fetched only once. */
export function getJobDetailCached(client: QueryClient, token: string, jobId: string) {
  return client.fetchQuery(detailQueryOptions(token, jobId))
}

/** Batch version — failed lookups are skipped, like fetchJobsByIds. */
export async function getJobDetailsCached(
  client: QueryClient,
  token: string,
  jobIds: string[],
): Promise<JobDetail[]> {
  const results = await Promise.all(
    jobIds.map((id) =>
      getJobDetailCached(client, token, id).catch((error: unknown) => {
        console.error(`[api] failed to fetch job ${id}:`, error)
        return null
      }),
    ),
  )
  return results.filter((job): job is JobDetail => job !== null)
}

export function getPipelineStepsCached(client: QueryClient, token: string, jobId: string) {
  return client.fetchQuery(stepsQueryOptions(token, jobId))
}

/** Seed the detail cache with data fetched elsewhere (e.g. the run page). */
export function primeJobDetail(client: QueryClient, job: JobDetail) {
  client.setQueryData(jobKeys.detail(job.jobId), job)
}

// ── Pipeline (run) page snapshot ──────────────────────────────────────────

/** Everything the pipeline page shows for a FINISHED run. */
export type ExecutionSnapshot = {
  job: JobDetail
  logs: LogEntry[]
  deployUrl: string | null
}

/** Same merge the live page does: steps endpoint wins over job detail. */
export function mergeJobWithSteps(base: JobDetail, steps: PipelineStepsResponse | null): JobDetail {
  if (!steps) return base
  if (isTerminalJobStatus(base.status) && steps.job && !isTerminalJobStatus(steps.job.status)) return base
  const summary = steps.job
  return {
    ...base,
    steps: steps.steps.length > 0 ? steps.steps : base.steps,
    ...(summary?.status ? { status: summary.status as JobDetail['status'] } : {}),
    ...(summary?.startedAt ? { startedAt: summary.startedAt } : {}),
    ...(summary?.completedAt ? { completedAt: summary.completedAt } : {}),
    ...(typeof summary?.durationSecs === 'number' ? { durationSecs: summary.durationSecs } : {}),
  }
}

async function fetchExecutionSnapshot(token: string, jobId: string): Promise<ExecutionSnapshot | null> {
  const [detail, steps, lines, deployment] = await Promise.all([
    fetchJobDetail(token, jobId),
    fetchPipelineSteps(token, jobId).catch(() => null),
    fetchPipelineLogs(token, jobId).catch(() => [] as string[]),
    fetchPipelineDeployment(token, jobId).catch(() => ({ url: null })),
  ])
  if (!detail) return null
  const job = mergeJobWithSteps(detail, steps)
  // Only finished runs are snapshotted; a live run must stream.
  if (!isTerminalJobStatus(job.status)) return null
  return { job, logs: mergeLogSnapshot([], lines, Date.now(), false), deployUrl: deployment.url }
}

export function getCachedExecution(client: QueryClient, jobId: string): ExecutionSnapshot | null {
  const snapshot = client.getQueryData<ExecutionSnapshot | null>(jobKeys.execution(jobId))
  return snapshot && isTerminalJobStatus(snapshot.job.status) ? snapshot : null
}

export function saveExecution(client: QueryClient, snapshot: ExecutionSnapshot) {
  client.setQueryData(jobKeys.execution(snapshot.job.jobId), snapshot)
  primeJobDetail(client, snapshot.job)
}

// ── Prefetch ──────────────────────────────────────────────────────────────

// Warm the cache before the user opens the result page (hover on a history
// row, or a run that just finished) so the page renders instantly.
export function prefetchJobResult(client: QueryClient, token: string | null, jobId: string) {
  if (!token || !jobId) return
  void client.prefetchQuery(detailQueryOptions(token, jobId))
  void client.prefetchQuery(resultQueryOptions(token, jobId))
}

/** Warm the pipeline page of a finished run (job, steps, logs, deploy URL). */
export function prefetchExecution(client: QueryClient, token: string | null, jobId: string) {
  if (!token || !jobId || getCachedExecution(client, jobId)) return
  void client.prefetchQuery({
    queryKey: jobKeys.execution(jobId),
    queryFn: () => fetchExecutionSnapshot(token, jobId),
    staleTime: Infinity,
  })
}

/** Both pages of a finished run in the history list. */
export function prefetchRun(client: QueryClient, token: string | null, jobId: string) {
  prefetchJobResult(client, token, jobId)
  prefetchExecution(client, token, jobId)
}

export function invalidateJob(client: QueryClient, jobId: string) {
  return client.invalidateQueries({ queryKey: jobKeys.run(jobId) })
}
