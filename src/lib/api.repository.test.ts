import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLatestRepoHistory, fetchJobDetail, getRepoExternalUrl, normalizeWebUrl, setRepoDomainUrl, setRepoExternalUrl } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('repository run discovery', () => {
  it('finds webhook runs without local IDs and skips substring matches across pages', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ job_id: 'wrong', repo_url: 'https://github.com/owner/repo-copy' }], limit: 100, has_more: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ job_id: 'webhook', repo_url: 'https://github.com/Owner/Repo.git', status: 'running', trigger_source: 'webhook' }], has_more: false })))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchLatestRepoHistory('token', 'owner/repo')).toMatchObject({ jobId: 'webhook', triggerSource: 'webhook', status: 'running' })
    expect(fetcher.mock.calls[1][0]).toContain('offset=100')
  })

  it('queries successful history separately even when the latest run failed', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], has_more: false })))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchLatestRepoHistory('token', 'owner/repo', 'success')).toBeNull()
    expect(fetcher.mock.calls[0][0]).toContain('status=success&repo=owner%2Frepo')
  })

  it('preserves the backend failure reason and stage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: { job_id: 'failed', status: 'failed', error_message: 'Tests failed', latest_step_name: 'test' }, steps: [{ step_type: 'test', status: 'failed', error_message: 'Assertion failed' }] }))))
    expect(await fetchJobDetail('token', 'failed')).toMatchObject({ status: 'failed', errorMessage: 'Tests failed', steps: [{ stepType: 'test', errorMessage: 'Assertion failed' }] })
  })
})

describe('external deployment URLs', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    [' https://example.com ', 'https://example.com/'],
    ['//example.com/path', 'https://example.com/path'],
    ['http://localhost:8080', 'http://localhost:8080/'],
    ['javascript:alert(1)', ''], ['data:text/html,test', ''], ['https://user:pass@example.com', ''], ['bad url', ''], ['', ''],
  ])('normalizes %s safely', (input, expected) => expect(normalizeWebUrl(input)).toBe(expected))

  it('keeps external URLs separate from service URLs and scopes them to account and repository', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    setRepoDomainUrl('user', 'owner/repo', 'https://service.example.com')
    expect(getRepoExternalUrl('user', 'owner/repo')).toBe('')
    setRepoExternalUrl('user', 'owner/repo', 'external.example.com')
    expect(getRepoExternalUrl('user', 'owner/repo')).toBe('https://external.example.com/')
    expect(getRepoExternalUrl('another-user', 'owner/repo')).toBe('')
    expect(() => setRepoExternalUrl('user', 'owner/repo', 'javascript:alert(1)')).toThrow()
    setRepoExternalUrl('user', 'owner/repo', '')
    expect(getRepoExternalUrl('user', 'owner/repo')).toBe('')
  })
})

describe('server deployment settings', () => {
  it('loads server settings including a cleared preference', async () => {
    const { fetchRepoDeploymentSettings } = await import('./api')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ external_url: null, configured: true, homepage: 'https://homepage.example/' }))))
    expect(await fetchRepoDeploymentSettings('jwt', 'owner', 'repo')).toEqual({ externalUrl: '', configured: true, homepage: 'https://homepage.example/' })
  })

  it('persists normalized URLs and clears with null', async () => {
    const { saveRepoDeploymentSettings } = await import('./api')
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => new Response(init.body as string))
    vi.stubGlobal('fetch', fetcher)
    expect(await saveRepoDeploymentSettings('jwt', 'owner', 'repo', 'example.com')).toBe('https://example.com/')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '{"external_url":"https://example.com/"}', headers: { Authorization: 'Bearer jwt' } })
    expect(await saveRepoDeploymentSettings('jwt', 'owner', 'repo', '')).toBe('')
    expect(fetcher.mock.calls[1][1].body).toBe('{"external_url":null}')
  })

  it('does not report successful persistence when the server rejects it', async () => {
    const { saveRepoDeploymentSettings } = await import('./api')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    await expect(saveRepoDeploymentSettings('jwt', 'owner', 'repo', 'example.com')).rejects.toThrow('500')
  })

  it('fetches private repository metadata through authenticated backend endpoints', async () => {
    const { fetchGithubRepoExtras } = await import('./api')
    const fetcher = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/branches') ? { branches: [{ name: 'main' }] } : { homepage: 'https://private.example/' })))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchGithubRepoExtras('owner', 'private', 'jwt')).toMatchObject({ branches: ['main'], homepageUrl: 'https://private.example/' })
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).not.toContain('api.github.com')
      expect(init.headers.Authorization).toBe('Bearer jwt')
    }
  })
})
