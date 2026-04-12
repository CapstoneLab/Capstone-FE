import { CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NativeFrameBar } from '@/components/layout/NativeFrameBar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GitHubIcon } from '@/components/ui/github-icon'
import { useAuth } from '@/contexts/AuthContext'

const GITHUB_LOGIN_URL = `${import.meta.env.VITE_API_BASE_URL}/auth/github/login`

const permissions = [
  {
    text: '프로필 정보 읽기',
    subText: '이름, 이메일, 프로필 사진',
  },
  {
    text: 'Repository 목록 읽기',
    subText: 'Public/Private 리포지토리 접근',
  },
  {
    text: '코드 읽기 전용 접근',
    subText: '코드 분석을 위한 읽기 권한 (수정 없음)',
  },
  {
    text: 'Repository 이벤트 감지',
    subText: 'push 발생 시 자동 보안 분석 실행',
  },
]

export function AuthPage() {
  const navigate = useNavigate()
  const { login, user } = useAuth()
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

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
          setStatus(`로그인에 실패했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`)
        })
        .finally(() => setIsPending(false))
    })

    return () => {
      unsubscribe?.()
    }
  }, [login, navigate])

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
          ? `로그인 창을 열지 못했습니다: ${error.message}`
          : '로그인 창을 열지 못했습니다.',
      )
      setIsPending(false)
    }
  }

  return (
    <section className="min-h-screen bg-[#1E1E1E] text-white">
      <NativeFrameBar />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 pb-10 pt-14">
        <div className="w-full max-w-md">
          <Card className="border-gray-500/80 bg-[#242424] p-4 text-center">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-[#5A5A5A]" />
            <h1 className="mt-4 text-4xl font-extrabold text-white">로그인</h1>
            <p className="mt-2 text-sm text-[#6B7280]">GitHub 계정으로 간편하게 시작하세요</p>

            <Button
              onClick={onSignIn}
              disabled={isPending}
              className="mt-5 w-full bg-white text-[#202020] shadow-none hover:bg-gray-100 disabled:opacity-70"
              size="lg"
            >
              <GitHubIcon className="mr-2 h-4 w-4" />
              {isPending ? 'GitHub 로그인 중...' : 'GitHub로 계속하기'}
            </Button>
            {status && <p className="mt-3 text-xs text-[#6B7280]">{status}</p>}
          </Card>

          <Card className="mt-5 border-gray-500/70 bg-[#242424] p-4">
            <p className="text-sm font-semibold text-[#6B7280]">GitHub 연동 시 요청하는 권한</p>
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
            로그인하면{' '}
            <a href="#" className="font-semibold text-[#34D399] underline underline-offset-2">
              개인정보처리방침
            </a>
            에 동의하는 것으로 간주됩니다.
          </p>
        </div>
      </main>
    </section>
  )
}
