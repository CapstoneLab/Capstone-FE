import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchCurrentUser, type AuthUser } from '@/lib/auth'

export type User = AuthUser

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

function clearPersistedToken(): void {
  clearBrowserToken()
  void window.desktop?.auth?.clearSavedToken?.()
}

export function getAuthCacheKey(token: string | null, user: User | null): string {
  const login = user?.login?.trim().toLowerCase()
  if (login) return `user:${login}`
  return token ? token.slice(0, 16) : 'anonymous'
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
      const userInfo = await fetchCurrentUser(newToken, {
        onUnauthorized: clearPersistedToken,
      })
      if (window.desktop?.auth?.setSavedToken) {
        await window.desktop.auth.setSavedToken(newToken)
      } else {
        writeBrowserToken(newToken)
      }
      setToken(newToken)
      setUser(userInfo)
    } catch (error) {
      clearPersistedToken()
      setToken(null)
      setUser(null)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    clearPersistedToken()
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

    fetchCurrentUser(token, { onUnauthorized: clearPersistedToken })
      .then((userInfo) => {
        if (mounted) {
          setUser(userInfo)
        }
      })
      .catch(() => {
        if (mounted) {
          clearPersistedToken()
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
