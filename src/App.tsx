import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthPage } from '@/pages/AuthPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DocsPage } from '@/pages/DocsPage'
import { HomePage } from '@/pages/HomePage'
import { NewPipelinePage } from '@/pages/NewPipelinePage'
import { PipelineProcessPage } from '@/pages/PipelineProcessPage'
import { PipelineProgressPage } from '@/pages/PipelineProgressPage'
import { RepositoryDetailPage } from '@/pages/RepositoryDetailPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/auth" element={<AuthPage />} />
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
