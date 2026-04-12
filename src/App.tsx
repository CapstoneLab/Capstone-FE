import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthPage } from '@/pages/AuthPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DocsPage } from '@/pages/DocsPage'
import { HomePage } from '@/pages/HomePage'
import { NewPipelinePage } from '@/pages/NewPipelinePage'
import { PipelineProcessPage } from '@/pages/PipelineProcessPage'
import { PipelineProgressPage } from '@/pages/PipelineProgressPage'
import { RepositoryDetailPage } from '@/pages/RepositoryDetailPage'
import { useAuth } from '@/contexts/AuthContext'

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthRedirect><HomePage /></AuthRedirect>} />
      <Route path="/auth" element={<AuthRedirect><AuthPage /></AuthRedirect>} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/repository" element={<RepositoryDetailPage />} />
      <Route path="/repository/:repoId" element={<RepositoryDetailPage />} />
      <Route path="/dashboard/repository/:repoId" element={<RepositoryDetailPage />} />
      <Route path="/pipeline/new" element={<NewPipelinePage />} />
      <Route path="/pipeline/progress" element={<PipelineProcessPage />} />
      <Route path="/pipeline/result" element={<PipelineProgressPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
