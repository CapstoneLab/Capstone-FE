import type { StartPipelineResponse } from '@/lib/api'

// A pipeline start request that was sent on the "파이프라인 실행" click and is
// still in flight. The new-pipeline page fires the request and moves to the
// progress page at once; the progress page picks the request up from here and
// switches to the real execution as soon as the backend returns its job id.
// (Router state cannot carry a Promise, so it carries this id instead.)

const pending = new Map<string, Promise<StartPipelineResponse>>()

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

export function registerPendingStart(request: Promise<StartPipelineResponse>): string {
  const id = newId()
  pending.set(id, request)
  // Keep it long enough for a slow response and a remount, then let it go.
  const cleanup = () => window.setTimeout(() => pending.delete(id), 5 * 60_000)
  request.then(cleanup, cleanup)
  return id
}

export function getPendingStart(id: string | undefined | null): Promise<StartPipelineResponse> | null {
  return id ? pending.get(id) ?? null : null
}
