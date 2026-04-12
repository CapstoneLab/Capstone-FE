import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/contexts/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.protocol === 'file:' ? (
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
)
