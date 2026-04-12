import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

const API_BASE =
  window.location.protocol === 'file:'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api-proxy'

type User = {
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

  return {
    login: data.login ?? data.username ?? data.githubLogin ?? '',
    name: data.name ?? data.login ?? data.username ?? data.githubLogin ?? null,
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
      return !!localStorage.getItem(TOKEN_KEY)
    } catch {
      return false
    }
  })

  const login = useCallback(async (newToken: string) => {
    setIsLoading(true)
    try {
      const userInfo = await fetchMe(newToken)
      localStorage.setItem(TOKEN_KEY, newToken)
      setToken(newToken)
      setUser(userInfo)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }, [])

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
