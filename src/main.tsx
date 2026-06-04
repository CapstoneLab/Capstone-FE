import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ZoomProvider } from '@/contexts/ZoomContext'
import { ZoomControl } from '@/components/layout/ZoomControl'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ZoomProvider>
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
        <ZoomControl />
      </ZoomProvider>
    </ThemeProvider>
  </StrictMode>,
)
