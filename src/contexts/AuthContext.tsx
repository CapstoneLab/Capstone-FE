import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { API_BASE_URL } from '@/lib/config'

export type User = {
  id: string | number | null
  githubId: string | number | null
  login: string
  name: string | null
  avatarUrl: string | null
  email: string | null
}

type AuthState = {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (token: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

const TOKEN_KEY = 'secupipeline:token'

function readBrowserToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeBrowserToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

function clearBrowserToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export function getAuthCacheKey(token: string | null, user: User | null): string {
  const login = user?.login?.trim().toLowerCase()
  if (login) return `user:${login}`
  return token ? token.slice(0, 16) : 'anonymous'
}

async function fetchMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[AuthContext] /auth/me failed:', res.status, text)
    throw new Error(`Failed to fetch user info (${res.status})`)
  }

  const data = await res.json()
  const login =
    data.github_login ?? data.githubLogin ?? data.login ?? data.username ?? ''
  const name = data.display_name ?? data.displayName ?? data.name ?? login ?? null

  return {
    id: data.id ?? null,
    githubId: data.github_id ?? data.githubId ?? null,
    login,
    name,
    avatarUrl: data.avatar_url ?? data.avatarUrl ?? data.profileImageUrl ?? null,
    email: data.email ?? null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => {
    try {
      return window.desktop?.auth?.getSavedToken ? null : readBrowserToken()
    } catch {
      return null
    }
  })
  const [isLoading, setIsLoading] = useState(() => {
    try {
      return !!readBrowserToken() || !!window.desktop?.auth?.getSavedToken
    } catch {
      return !!window.desktop?.auth?.getSavedToken
    }
  })

  const login = useCallback(async (newToken: string) => {
    setIsLoading(true)
    try {
      const userInfo = await fetchMe(newToken)
      if (window.desktop?.auth?.setSavedToken) {
        await window.desktop.auth.setSavedToken(newToken)
      } else {
        writeBrowserToken(newToken)
      }
      setToken(newToken)
      setUser(userInfo)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    clearBrowserToken()
    void window.desktop?.auth?.clearSavedToken?.()
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    if (token || !window.desktop?.auth?.getSavedToken) {
      if (!token) setIsLoading(false)
      return
    }

    let mounted = true

    window.desktop.auth
      .getSavedToken()
      .then((savedToken) => {
        if (!mounted) return
        if (savedToken) {
          setToken(savedToken)
        } else {
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (mounted) setIsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [token])

  useEffect(() => {
    if (!token || user) {
      return
    }

    let mounted = true

    fetchMe(token)
      .then((userInfo) => {
        if (mounted) {
          setUser(userInfo)
        }
      })
      .catch(() => {
        if (mounted) {
          clearBrowserToken()
          void window.desktop?.auth?.clearSavedToken?.()
          setToken(null)
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [token, user])

  useEffect(() => {
    const handleExpired = () => logout()
    window.addEventListener('secupipeline:auth-expired', handleExpired)
    return () => window.removeEventListener('secupipeline:auth-expired', handleExpired)
  }, [logout])

  const value = useMemo(
    () => ({ user, token, isLoading, login, logout }),
    [user, token, isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
