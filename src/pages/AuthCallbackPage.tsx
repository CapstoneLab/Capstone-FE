import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { parseAuthCallbackUrl } from '@/lib/auth'

type AuthCallbackLocationState = {
  callbackUrl?: unknown
}

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, logout } = useAuth()
  const desktopCallbackUrl = (location.state as AuthCallbackLocationState | null)?.callbackUrl
  const callback = useMemo(
    () =>
      parseAuthCallbackUrl(
        typeof desktopCallbackUrl === 'string' ? desktopCallbackUrl : window.location.href,
      ),
    [desktopCallbackUrl],
  )
  const [loginFailure, setLoginFailure] = useState<{
    token: string
    message: string
  } | null>(null)
  const error = callback.token
    ? loginFailure?.token === callback.token
      ? loginFailure.message
      : null
    : callback.error || '인증 토큰이 없습니다. 다시 로그인해 주세요.'

  useLayoutEffect(() => {
    // Desktop callbacks arrive over IPC and never enter the renderer address bar.
    if (typeof desktopCallbackUrl === 'string') return
    window.history.replaceState({}, document.title, callback.sanitizedUrl)
  }, [callback.sanitizedUrl, desktopCallbackUrl])

  useEffect(() => {
    if (!callback.token) return

    let cancelled = false

    login(callback.token)
      .then(() => {
        if (!cancelled) navigate('/dashboard', { replace: true })
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        logout()
        setLoginFailure({
          token: callback.token!,
          message: reason instanceof Error ? reason.message : '로그인 정보를 확인하지 못했습니다.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [callback.token, login, logout, navigate])

  return (
    <section className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <p className={`text-sm ${error ? 'text-red-300' : 'text-gray-300'}`}>
          {error ?? 'GitHub 로그인 정보를 확인하는 중입니다...'}
        </p>
        {error ? (
          <Button className="mt-4" type="button" onClick={() => navigate('/auth', { replace: true })}>
            로그인 페이지로 돌아가기
          </Button>
        ) : null}
      </div>
    </section>
  )
}
