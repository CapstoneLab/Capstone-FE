import { CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GitHubIcon } from '@/components/ui/github-icon'
import { useAuth } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import appLogo from '@/assets/app-logo.png'

const GITHUB_LOGIN_URL = `${import.meta.env.VITE_API_BASE_URL}/auth/github/login`

export function AuthPage() {
  const navigate = useNavigate()
  const { login, user } = useAuth()
  const { t } = useLanguage()
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const permissions = [
    {
      text: t('auth.permission.profile'),
      subText: t('auth.permission.profileSub'),
    },
    {
      text: t('auth.permission.repos'),
      subText: t('auth.permission.reposSub'),
    },
    {
      text: t('auth.permission.code'),
      subText: t('auth.permission.codeSub'),
    },
    {
      text: t('auth.permission.events'),
      subText: t('auth.permission.eventsSub'),
    },
  ]

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, navigate])

  useEffect(() => {
    const unsubscribe = window.desktop?.auth?.onAuthToken?.((token) => {
      login(token)
        .then(() => navigate('/dashboard', { replace: true }))
        .catch((err) => {
          console.error('[AuthPage] login failed:', err)
          setStatus(t('auth.loginFailed', {
            message: err instanceof Error ? err.message : t('auth.unknownError'),
          }))
        })
        .finally(() => setIsPending(false))
    })

    return () => {
      unsubscribe?.()
    }
  }, [login, navigate, t])

  const onSignIn = async () => {
    setIsPending(true)
    setStatus(null)
    try {
      const startGithubLogin = window.desktop?.auth?.startGithubLogin
      if (typeof startGithubLogin === 'function') {
        const result = await startGithubLogin(GITHUB_LOGIN_URL)
        if (result?.token) {
          await login(result.token)
          navigate('/dashboard', { replace: true })
        } else {
          setIsPending(false)
        }
      } else {
        window.location.href = GITHUB_LOGIN_URL
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? t('auth.openFailedWithMessage', { message: error.message })
          : t('auth.openFailed'),
      )
      setIsPending(false)
    }
  }

  return (
    <section className="auth-section flex min-h-full items-center justify-center">
      <main className="mx-auto flex min-h-full w-full max-w-6xl items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <Card className="auth-card p-4 text-center shadow-sm">
            <img
              src={appLogo}
              alt="Secupipeline"
              className="mx-auto aspect-square h-28 w-28 rounded-2xl object-cover"
            />
            <h1 className="auth-text-primary mt-4 text-4xl font-extrabold">{t('auth.title')}</h1>
            <p className="auth-text-secondary mt-2 text-sm">{t('auth.subtitle')}</p>

            <Button
              onClick={onSignIn}
              disabled={isPending}
              className="mt-5 w-full bg-white text-[#202020] shadow-none hover:bg-gray-100 disabled:opacity-70"
              size="lg"
            >
              <GitHubIcon className="mr-2 h-4 w-4" />
              {isPending ? t('auth.signingIn') : t('auth.continueWithGithub')}
            </Button>
            {status && <p className="auth-text-secondary mt-3 text-xs">{status}</p>}
          </Card>

          <Card className="auth-card mt-5 p-4 shadow-sm">
            <p className="auth-text-secondary text-sm font-semibold">{t('auth.permissionsTitle')}</p>
            <ul className="mt-3 space-y-3">
              {permissions.map((item) => (
                <li key={item.text} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34D399]" />
                  <div>
                    <p className="auth-text-primary text-base leading-none">{item.text}</p>
                    <p className="auth-text-secondary mt-1 text-[10px]">{item.subText}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <p className="auth-text-secondary mt-6 text-center text-xs">
            {t('auth.termsPrefix')}{' '}
            <a href="#" className="font-semibold text-[#34D399] underline underline-offset-2">
              {t('auth.privacy')}
            </a>
            {t('auth.termsSuffix')}
          </p>
        </div>
      </main>
    </section>
  )
}
