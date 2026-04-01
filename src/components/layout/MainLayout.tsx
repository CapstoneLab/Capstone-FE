import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Download, Play } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Footer } from './Footer'
import { NativeFrameBar } from './NativeFrameBar'

export function MainLayout({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [showPageHeader, setShowPageHeader] = useState(false)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const pageMeta = useMemo(() => {
    if (pathname.startsWith('/dashboard')) {
      return {
        title: '대시보드',
        description: '레포지토리를 관리하고 파이프라인 실행 결과를 확인하세요',
      }
    }
    if (pathname.startsWith('/repository') || pathname.startsWith('/dashboard/repository/')) {
      return {
        title: '레포지토리 상세',
        description: '레포지토리 배포 정보, 파이프라인 상태, 브랜치 구성을 확인하세요',
      }
    }
    if (pathname.startsWith('/pipeline/new')) {
      return {
        title: '새 파이프라인',
        description: 'GitHub 레포지토리를 선택하고 파이프라인 실행을 시작하세요',
      }
    }
    if (pathname.startsWith('/pipeline/progress')) {
      return {
        title: '파이프라인 진행',
        description: '각 단계별 실행 로그와 진행 상태를 확인하세요',
      }
    }
    if (pathname.startsWith('/pipeline/result')) {
      return {
        title: '보안 분석 결과',
        description: '보안 점수와 취약점 분석 결과를 확인하세요',
      }
    }
    if (pathname.startsWith('/docs')) {
      return {
        title: '문서',
        description: '시작 가이드와 보안 분석 문서를 확인하세요',
      }
    }
    if (pathname.startsWith('/auth')) {
      return {
        title: '로그인',
        description: 'GitHub 계정 연동으로 빠르게 시작하세요',
      }
    }
    return null
  }, [pathname])

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

  const pageHeaderRight = useMemo(() => {
    if (pathname.startsWith('/dashboard')) {
      return (
        <Button
          type="button"
          onClick={() => navigate('/pipeline/new')}
          className="h-9 bg-emerald-400 px-3 text-xs font-semibold text-[#111827] shadow-none hover:bg-emerald-300"
        >
          <Play className="mr-1 h-3.5 w-3.5" />새 파이프라인
        </Button>
      )
    }

    if (pathname.startsWith('/pipeline/progress')) {
      return (
        <div className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-600/75 bg-[#242424] px-3 text-xs text-gray-200">
          <Clock3 className="h-3.5 w-3.5 text-emerald-300" />실행 시간 3m 40s
        </div>
      )
    }

    if (pathname.startsWith('/pipeline/result')) {
      return (
        <Button
          type="button"
          variant="ghost"
          className="h-9 border border-[#3ECF8E] bg-[#065F46]/30 px-3 text-xs text-[#A7F3D0] hover:bg-[#065F46]/50"
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />결과 다운로드
        </Button>
      )
    }

    return null
  }, [navigate, pathname])

  return (
    <div className="relative h-screen overflow-hidden bg-[#1E1E1E] text-gray-50">
      <NativeFrameBar />

      <div
        className={`fixed left-0 right-0 top-9 z-40 transition-all duration-200 ${
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
        className="mt-9 flex h-[calc(100vh-36px)] flex-col overflow-y-auto overflow-x-hidden"
      >
        <main className="relative mx-auto w-full max-w-6xl flex-1 px-6 pb-10 pt-6">{children}</main>
        <Footer />
      </div>
    </div>
  )
}
