import { CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GitHubIcon } from '@/components/ui/github-icon'
import { useAuth } from '@/contexts/AuthContext'
import { useLanguage } from '@/contexts/LanguageContext'
import appLogo from '@/assets/logo.png'

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
    <section className="min-h-full bg-[#1E1E1E] text-white">
      <main className="mx-auto flex min-h-full w-full max-w-6xl items-center justify-center px-6 pb-10 pt-14">
        <div className="w-full max-w-md">
          <Card className="border-gray-500/80 bg-[#242424] p-4 text-center">
            <img
              src={appLogo}
              alt="Secupipeline"
              className="mx-auto aspect-square h-28 w-28 rounded-2xl object-cover"
            />
            <h1 className="mt-4 text-4xl font-extrabold text-white">{t('auth.title')}</h1>
            <p className="mt-2 text-sm text-[#6B7280]">{t('auth.subtitle')}</p>

            <Button
              onClick={onSignIn}
              disabled={isPending}
              className="mt-5 w-full bg-white text-[#202020] shadow-none hover:bg-gray-100 disabled:opacity-70"
              size="lg"
            >
              <GitHubIcon className="mr-2 h-4 w-4" />
              {isPending ? t('auth.signingIn') : t('auth.continueWithGithub')}
            </Button>
            {status && <p className="mt-3 text-xs text-[#6B7280]">{status}</p>}
          </Card>

          <Card className="mt-5 border-gray-500/70 bg-[#242424] p-4">
            <p className="text-sm font-semibold text-[#6B7280]">{t('auth.permissionsTitle')}</p>
            <ul className="mt-3 space-y-3">
              {permissions.map((item) => (
                <li key={item.text} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34D399]" />
                  <div>
                    <p className="text-base leading-none text-white">{item.text}</p>
                    <p className="mt-1 text-[10px] text-[#6B7280]">{item.subText}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <p className="mt-6 text-center text-xs text-[#6B7280]">
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
