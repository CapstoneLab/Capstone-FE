import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthExpiredError,
  fetchPipelineHistory,
  fetchRepositoryWebhookStatuses,
  isWebhookTrigger,
  setRepositoryWebhook,
} from '@/lib/api'

describe('pipeline history API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends filters and bearer token and maps the paginated response', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              job_id: 'job-1',
              repo_url: 'https://github.com/owner/repository',
              branch: 'main',
              trigger_source: 'manual',
              status: 'running',
              latest_step_name: 'test',
              completed_steps: 3,
              total_steps: 6,
              progress_percent: 50,
              created_at: '2026-08-31T12:00:00+00:00',
              duration_secs: null,
            },
          ],
          total: 24,
          limit: 20,
          offset: 0,
          has_more: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetcher)

    const result = await fetchPipelineHistory('test-jwt', {
      status: 'running',
      repo: 'Capstone',
      limit: 20,
      offset: 0,
    })

    expect(fetcher).toHaveBeenCalledWith(
      'https://112.186.136.153/api/pipelines/history?status=running&repo=Capstone&limit=20&offset=0',
      {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer test-jwt',
        },
      },
    )
    expect(result).toMatchObject({
      total: 24,
      hasMore: true,
      items: [
        {
          jobId: 'job-1',
          status: 'running',
          latestStepName: 'test',
          completedSteps: 3,
          totalSteps: 6,
          progressPercent: 50,
        },
      ],
    })
  })

  it('registers a push webhook for a repository', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          enabled: true,
          events: ['push'],
          url: 'https://example.test/hook',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetcher)

    await expect(setRepositoryWebhook('test-jwt', 'owner/repository', true)).resolves.toEqual({
      enabled: true,
      events: ['push'],
      url: 'https://example.test/hook',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://112.186.136.153/api/repos/owner/repository/webhook',
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer test-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, events: ['push'] }),
      },
    )
  })

  it('surfaces the backend detail and a permission hint on 403', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'Resource not accessible by integration' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const error = await setRepositoryWebhook('test-jwt', 'owner/repository', true).catch(
      (e: unknown) => e as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('(403) Resource not accessible by integration')
    expect((error as Error).message).toContain('admin:repo_hook')
  })

  it('looks up webhook state per repository: on, 404 → off, other errors → unknown', async () => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/a/on/')) return json({ enabled: true, events: ['push'], url: 'h' })
        if (url.includes('/a/none/')) return json({ detail: 'not found' }, 404)
        return json({ detail: 'GitHub API failed' }, 502)
      }),
    )

    const statuses = await fetchRepositoryWebhookStatuses('jwt', ['a/on', 'a/none', 'a/broken'], 2)

    expect(statuses.get('a/on')).toMatchObject({ state: 'on', webhook: { events: ['push'] } })
    expect(statuses.get('a/none')).toMatchObject({ state: 'off' })
    expect(statuses.get('a/broken')).toMatchObject({ state: 'unknown' })
  })

  it('aborts the webhook status lookup when the session expired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    // 401 handling dispatches a global auth-expired event on window.
    vi.stubGlobal('window', new EventTarget())
    await expect(fetchRepositoryWebhookStatuses('jwt', ['a/b'])).rejects.toBeInstanceOf(
      AuthExpiredError,
    )
  })

  it('recognises webhook-triggered pipelines', () => {
    expect(isWebhookTrigger('webhook')).toBe(true)
    expect(isWebhookTrigger('github-push')).toBe(true)
    expect(isWebhookTrigger('manual')).toBe(false)
    expect(isWebhookTrigger(undefined)).toBe(false)
  })
})
