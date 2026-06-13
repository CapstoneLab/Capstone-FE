import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Download, FileClock, Play } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/LanguageContext'
import { Footer } from './Footer'

type MainLayoutProps = PropsWithChildren<{
  /** Live elapsed-time label for the pipeline progress sticky-header chip
   *  (e.g. "3m 40s"). Passed by PipelineProcessPage so it isn't hardcoded. */
  pipelineElapsed?: string
  /** Opens the 결과 다운로드 modal. Passed by the result page so the sticky-
   *  header download button triggers the same dialog as the in-page one. */
  onResultDownload?: () => void
}>

export function MainLayout({ children, pipelineElapsed, onResultDownload }: MainLayoutProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [showPageHeader, setShowPageHeader] = useState(false)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const pageMeta = useMemo(() => {
    if (pathname.startsWith('/dashboard')) {
      return {
        title: t('layout.dashboard.title'),
        description: t('layout.dashboard.description'),
      }
    }
    if (pathname.startsWith('/repository') || pathname.startsWith('/dashboard/repository/')) {
      return {
        title: t('layout.repository.title'),
        description: t('layout.repository.description'),
      }
    }
    if (pathname.startsWith('/pipeline/new')) {
      return {
        title: t('layout.pipelineNew.title'),
        description: t('layout.pipelineNew.description'),
      }
    }
    if (pathname.startsWith('/pipeline/progress')) {
      return {
        title: t('layout.pipelineProgress.title'),
        description: t('layout.pipelineProgress.description'),
      }
    }
    if (pathname.startsWith('/pipeline/result')) {
      return {
        title: t('layout.pipelineResult.title'),
        description: t('layout.pipelineResult.description'),
      }
    }
    if (pathname.startsWith('/docs')) {
      return {
        title: t('layout.docs.title'),
        description: t('layout.docs.description'),
      }
    }
    if (pathname.startsWith('/auth')) {
      return {
        title: t('layout.auth.title'),
        description: t('layout.auth.description'),
      }
    }
    return null
  }, [pathname, t])

  useEffect(() => {
    const target = scrollContainerRef.current
    if (!target) {
      return
    }

    const onScroll = () => {
      setShowPageHeader(target.scrollTop > 100)
    }

    onScroll()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [pathname])

  useEffect(() => {
    const target = scrollContainerRef.current
    if (!target) {
      return
    }

    const updateScrollbarWidth = () => {
      setScrollbarWidth(Math.max(0, target.offsetWidth - target.clientWidth))
    }

    updateScrollbarWidth()
    const observer = new ResizeObserver(updateScrollbarWidth)
    observer.observe(target)
    window.addEventListener('resize', updateScrollbarWidth)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateScrollbarWidth)
    }
  }, [pathname])

  const shouldShowScrollHeader = pathname !== '/' && !!pageMeta && showPageHeader
  const isHome = pathname === '/'

  const pageHeaderRight = useMemo(() => {
    if (pathname.startsWith('/dashboard')) {
      return (
        <Button
          type="button"
          onClick={() => navigate('/pipeline/new')}
          className="h-9 bg-emerald-400 px-3 text-xs font-semibold text-[#111827] shadow-none hover:bg-emerald-300"
        >
          <Play className="mr-1 h-3.5 w-3.5" />{t('common.newPipeline')}
        </Button>
      )
    }

    if (pathname.startsWith('/pipeline/progress')) {
      return (
        <div className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-600/75 bg-[#242424] px-3 text-xs text-gray-200">
          <Clock3 className="h-3.5 w-3.5 text-emerald-300" />{t('common.runningTime')} {pipelineElapsed || '-'}
        </div>
      )
    }

    if (pathname.startsWith('/pipeline/result')) {
      return (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/approvals')}
            className="h-9 border-[#404040] bg-transparent px-3 text-xs text-[#D1D5DB] hover:bg-[#262626]"
          >
            <FileClock className="mr-1.5 h-3.5 w-3.5" />{t('common.auditLog')}
          </Button>
          <Button
            type="button"
            onClick={onResultDownload}
            className="h-9 border border-[#34D399] bg-[#34D399] px-3 text-xs font-semibold text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
          >
          <Download className="mr-1.5 h-3.5 w-3.5" />{t('common.downloadResult')}
          </Button>
        </div>
      )
    }

    return null
  }, [navigate, pathname, pipelineElapsed, onResultDownload, t])

  return (
    <div className="relative h-full overflow-hidden bg-[#1E1E1E] text-gray-50">
      <div
        className={`absolute left-0 right-0 top-0 z-40 transition-all duration-200 ${
          shouldShowScrollHeader
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
        style={{ right: `${scrollbarWidth}px` }}
      >
        <div className="border-b border-gray-600/75 bg-[#1E1E1E] px-6 py-3">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-white">{pageMeta?.title}</p>
              <p className="text-xs text-[#6B7280]">{pageMeta?.description}</p>
            </div>
            {pageHeaderRight}
          </div>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex h-full flex-col overflow-y-auto overflow-x-hidden"
      >
        <main className={`relative w-full flex-1 ${isHome ? 'mx-0 max-w-none px-0 pb-0 pt-0' : 'mx-auto max-w-6xl px-6 pb-10 pt-6'}`}>{children}</main>
        <Footer />
      </div>
    </div>
  )
}
