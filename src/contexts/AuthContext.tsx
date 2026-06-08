import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const API_BASE =
  window.location.protocol === 'file:'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api-proxy'

export type User = {
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

export function getAuthCacheKey(token: string | null, user: User | null): string {
  const login = user?.login?.trim().toLowerCase()
  if (login) return `user:${login}`
  return token ? token.slice(0, 16) : 'anonymous'
}

async function fetchMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[AuthContext] /auth/me failed:', res.status, text)
    throw new Error(`Failed to fetch user info (${res.status})`)
  }

  const data = await res.json()
  console.log('[AuthContext] /auth/me response:', data)

  const login =
    data.github_login ?? data.githubLogin ?? data.login ?? data.username ?? ''
  const name = data.display_name ?? data.displayName ?? data.name ?? login ?? null

  return {
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
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  })
  const [isLoading, setIsLoading] = useState(() => {
    try {
      return !!localStorage.getItem(TOKEN_KEY) || !!window.desktop?.auth?.getSavedToken
    } catch {
      return !!window.desktop?.auth?.getSavedToken
    }
  })

  const login = useCallback(async (newToken: string) => {
    setIsLoading(true)
    try {
      const userInfo = await fetchMe(newToken)
      localStorage.setItem(TOKEN_KEY, newToken)
      await window.desktop?.auth?.setSavedToken?.(newToken)
      setToken(newToken)
      setUser(userInfo)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
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
          localStorage.setItem(TOKEN_KEY, savedToken)
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
          localStorage.removeItem(TOKEN_KEY)
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
