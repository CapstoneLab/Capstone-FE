import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ApprovalPage } from '@/pages/ApprovalPage'
import { AuditLogPage } from '@/pages/AuditLogPage'
import { AuthPage } from '@/pages/AuthPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DocsPage } from '@/pages/DocsPage'
import { HomePage } from '@/pages/HomePage'
import { NewPipelinePage } from '@/pages/NewPipelinePage'
import { PipelineProcessPage } from '@/pages/PipelineProcessPage'
import { PipelineProgressPage } from '@/pages/PipelineProgressPage'
import { RepositoryDetailPage } from '@/pages/RepositoryDetailPage'
import { useAuth } from '@/contexts/AuthContext'
import { NativeFrameBar } from '@/components/layout/NativeFrameBar'
import { useEffect, useState } from 'react'

function AuthCallback() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [callbackToken] = useState(() => new URL(window.location.href).searchParams.get('token'))
  const [error, setError] = useState<string | null>(() =>
    callbackToken ? null : '인증 토큰이 없습니다. 다시 로그인해 주세요.',
  )

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('token')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)

    if (!callbackToken) return

    let cancelled = false
    login(callbackToken)
      .then(() => {
        if (!cancelled) navigate('/dashboard', { replace: true })
      })
      .catch(() => {
        if (!cancelled) setError('로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.')
      })
    return () => { cancelled = true }
  }, [callbackToken, login, navigate])

  return <div className="flex h-full items-center justify-center text-sm text-gray-300">{error ?? 'GitHub 로그인을 확인하는 중입니다...'}</div>
}

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// Page-level transition applies only below the native titlebar.
const pageVariants = {
  initial: { opacity: 0, y: -24, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 24, scale: 0.99 },
}

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="h-full origin-top"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

function App() {
  const location = useLocation()
  return (
    <div className="relative h-full overflow-hidden bg-[#1E1E1E] text-gray-50">
      <NativeFrameBar />
      <div className="mt-9 h-[calc(100%-36px)] overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname}>
            <Route
              path="/"
              element={
                <PageTransition>
                  <AuthRedirect>
                    <HomePage />
                  </AuthRedirect>
                </PageTransition>
              }
            />
            <Route
              path="/auth"
              element={
                <PageTransition>
                  <AuthRedirect>
                    <AuthPage />
                  </AuthRedirect>
                </PageTransition>
              }
            />
            <Route path="/auth/callback" element={<PageTransition><AuthCallback /></PageTransition>} />
            <Route path="/docs" element={<PageTransition><DocsPage /></PageTransition>} />
            <Route path="/dashboard" element={<PageTransition><DashboardPage /></PageTransition>} />
            <Route path="/repository" element={<PageTransition><RepositoryDetailPage /></PageTransition>} />
            <Route path="/repository/:repoId" element={<PageTransition><RepositoryDetailPage /></PageTransition>} />
            <Route
              path="/dashboard/repository/:repoId"
              element={<PageTransition><RepositoryDetailPage /></PageTransition>}
            />
            <Route path="/pipeline/new" element={<PageTransition><NewPipelinePage /></PageTransition>} />
            <Route path="/pipeline/progress" element={<PageTransition><PipelineProcessPage /></PageTransition>} />
            <Route path="/pipeline/result" element={<PageTransition><PipelineProgressPage /></PageTransition>} />
            <Route path="/pipeline/approval" element={<PageTransition><ApprovalPage /></PageTransition>} />
            <Route path="/approvals" element={<PageTransition><AuditLogPage /></PageTransition>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </div>
    </div>
  )
}

export default App
