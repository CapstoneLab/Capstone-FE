import { API_BASE_URL, githubLoginUrl } from '@/lib/config'

export type AuthUser = {
  id: string | number | null
  githubId: string | number | null
  login: string
  name: string | null
  avatarUrl: string | null
  email: string | null
}

type UnknownRecord = Record<string, unknown>

export class AuthRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthRequestError'
    this.status = status
  }
}

function readableDetail(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  return value
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return ''
      const record = issue as UnknownRecord
      return typeof record.msg === 'string' ? record.msg : ''
    })
    .filter(Boolean)
    .join(', ')
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) return ''

  try {
    const payload = JSON.parse(text) as UnknownRecord
    if (typeof payload.message === 'string') return payload.message
    return readableDetail(payload.detail)
  } catch {
    return text
  }
}

export async function fetchCurrentUser(
  token: string,
  options: {
    fetcher?: typeof fetch
    onUnauthorized?: () => void
  } = {},
): Promise<AuthUser> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${API_BASE_URL}/auth/me`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const detail = await readErrorMessage(response)
    if (response.status === 401) options.onUnauthorized?.()
    throw new AuthRequestError(
      detail || (response.status === 401 ? '로그인 세션이 만료되었습니다.' : '사용자 정보를 확인하지 못했습니다.'),
      response.status,
    )
  }

  const data = (await response.json()) as UnknownRecord
  const login =
    (data.github_login as string | undefined) ??
    (data.githubLogin as string | undefined) ??
    (data.login as string | undefined) ??
    (data.username as string | undefined) ??
    ''
  const name = (
    (data.display_name as string | null | undefined) ??
    (data.displayName as string | null | undefined) ??
    (data.name as string | null | undefined) ??
    login
  ) || null

  return {
    id: (data.id as string | number | undefined) ?? null,
    githubId:
      (data.github_id as string | number | undefined) ??
      (data.githubId as string | number | undefined) ??
      null,
    login,
    name,
    avatarUrl:
      (data.avatar_url as string | null | undefined) ??
      (data.avatarUrl as string | null | undefined) ??
      (data.profileImageUrl as string | null | undefined) ??
      null,
    email: (data.email as string | null | undefined) ?? null,
  }
}

export type AuthCallbackData = {
  token: string | null
  error: string | null
  sanitizedUrl: string
}

export function parseAuthCallbackUrl(href: string): AuthCallbackData {
  const url = new URL(href)
  const token =
    url.searchParams.get('token')?.trim() ||
    url.searchParams.get('access_token')?.trim() ||
    url.searchParams.get('jwt')?.trim() ||
    null
  const error =
    url.searchParams.get('message') ||
    url.searchParams.get('detail') ||
    url.searchParams.get('error_description') ||
    url.searchParams.get('error') ||
    null

  url.searchParams.delete('token')
  url.searchParams.delete('access_token')
  url.searchParams.delete('jwt')

  return {
    token,
    error,
    sanitizedUrl: `${url.pathname}${url.search}${url.hash}`,
  }
}

export function beginGithubLogin(assign: (url: string) => void = (url) => window.location.assign(url)) {
  assign(githubLoginUrl)
}
