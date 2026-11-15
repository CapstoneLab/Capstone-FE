// Start-latency measurement for a pipeline run, split into the phases the
// backend asked for:
//   click → start API response → progress screen shown → first stage started
// Each run's marks are kept in localStorage (last 20 runs) so they can be read
// from the installed app, and every completed phase is logged to the console.

export type StartPhase = 'apiResponse' | 'screenShown' | 'firstStage'

export type StartTiming = {
  jobId: string
  clickedAt: number
  apiResponse?: number
  screenShown?: number
  firstStage?: number
}

const STORAGE_KEY = 'secupipeline:start-timings'
const MAX_ENTRIES = 20

let pendingClickAt: number | null = null

function readAll(): StartTiming[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as StartTiming[]) : []
  } catch {
    return []
  }
}

function writeAll(entries: StartTiming[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // storage unavailable — measurement is best-effort
  }
}

/** Call on the "파이프라인 실행" click, before the start request. */
export function markStartClicked() {
  pendingClickAt = Date.now()
}

/** Call when the start API returned a job id. */
export function markStartResponse(jobId: string) {
  if (pendingClickAt === null || !jobId) return
  const now = Date.now()
  writeAll([...readAll().filter((e) => e.jobId !== jobId), { jobId, clickedAt: pendingClickAt, apiResponse: now }])
  console.info(`[start-timing] ${jobId} API 응답 ${now - pendingClickAt}ms`)
  pendingClickAt = null
}

/** Records a later phase once; ignored for runs not started from this device. */
export function markStartPhase(jobId: string, phase: Exclude<StartPhase, 'apiResponse'>) {
  const entries = readAll()
  const entry = entries.find((e) => e.jobId === jobId)
  if (!entry || entry[phase] !== undefined) return
  entry[phase] = Date.now()
  writeAll(entries)
  console.info(`[start-timing] ${jobId} ${phase === 'screenShown' ? '진행 화면 표시' : '첫 단계 시작'} ${entry[phase]! - entry.clickedAt}ms`)
}

export function getStartTiming(jobId: string): StartTiming | null {
  return readAll().find((e) => e.jobId === jobId) ?? null
}

/** Milliseconds from the click to each phase (undefined = not reached yet). */
export function startTimingDurations(timing: StartTiming) {
  const since = (at?: number) => (at === undefined ? undefined : Math.max(0, at - timing.clickedAt))
  return {
    apiResponse: since(timing.apiResponse),
    screenShown: since(timing.screenShown),
    firstStage: since(timing.firstStage),
  }
}
