import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPipelineHistory } from '@/lib/api'

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
})
