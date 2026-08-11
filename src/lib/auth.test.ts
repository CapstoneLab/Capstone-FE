import { describe, expect, it, vi } from 'vitest'
import {
  beginGithubLogin,
  fetchCurrentUser,
  parseAuthCallbackUrl,
} from '@/lib/auth'

describe('GitHub OAuth', () => {
  it('starts login with a full-page navigation to the backend', () => {
    const assign = vi.fn()

    beginGithubLogin(assign)

    expect(assign).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledWith('https://112.186.136.153/auth/github/login')
  })

  it('reads the callback token and removes it from the sanitized URL', () => {
    const callback = parseAuthCallbackUrl(
      'https://pwd.kr/auth/callback?token=header.payload.signature&source=github#done',
    )

    expect(callback.token).toBe('header.payload.signature')
    expect(callback.sanitizedUrl).toBe('/auth/callback?source=github#done')
    expect(callback.sanitizedUrl).not.toContain('token')
  })

  it('returns a useful error when the callback has no token', () => {
    const callback = parseAuthCallbackUrl(
      'https://pwd.kr/auth/callback?detail=GitHub%20authorization%20failed',
    )

    expect(callback.token).toBeNull()
    expect(callback.error).toBe('GitHub authorization failed')
  })
})

describe('/auth/me', () => {
  it('sends the JWT and maps a successful user response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: 7,
      github_id: 42,
      github_login: 'capstone-user',
      display_name: 'Capstone User',
      avatar_url: 'https://avatars.example/user.png',
      email: 'user@example.com',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const user = await fetchCurrentUser('test-jwt', {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(fetcher).toHaveBeenCalledWith('https://112.186.136.153/auth/me', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer test-jwt',
      },
    })
    expect(user).toMatchObject({
      id: 7,
      githubId: 42,
      login: 'capstone-user',
      name: 'Capstone User',
    })
  })

  it('reports backend detail and invokes unauthorized cleanup on 401', async () => {
    const onUnauthorized = vi.fn()
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'JWT has expired' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ))

    const request = fetchCurrentUser('expired-jwt', {
      fetcher: fetcher as unknown as typeof fetch,
      onUnauthorized,
    })

    await expect(request).rejects.toMatchObject({
      name: 'AuthRequestError',
      status: 401,
      message: 'JWT has expired',
    })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
