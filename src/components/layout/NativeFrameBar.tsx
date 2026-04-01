import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, House, Minus, Square, Copy, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function NativeFrameBar() {
  const navigate = useNavigate()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let mounted = true

    window.desktop?.window?.isMaximized?.().then((value) => {
      if (mounted) {
        setIsMaximized(Boolean(value))
      }
    })

    const unsubscribe = window.desktop?.window?.onMaximizedChange?.((value) => {
      setIsMaximized(Boolean(value))
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  return (
    <div className="fixed left-0 right-0 top-0 z-50 border-b border-gray-600/75 bg-[#1E1E1E] [-webkit-app-region:drag]">
      <div className="relative flex h-9 w-full items-center justify-between px-3">
        <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
          <button
            type="button"
            aria-label="홈"
            onClick={() => navigate('/')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-200 hover:bg-gray-700/70"
          >
            <House className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="뒤로"
            onClick={() => navigate(-1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-200 hover:bg-gray-700/70"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="앞으로"
            onClick={() => navigate(1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-200 hover:bg-gray-700/70"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          <img src="/favicon.svg" alt="앱 아이콘" className="h-4 w-4" />
          <p className="text-sm font-semibold text-gray-100">SecuPipeline</p>
        </div>

        <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
          <button
            type="button"
            aria-label="최소화"
            onClick={() => window.desktop?.window?.minimize?.()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-300 transition-colors hover:bg-[#2F2F2F] hover:text-white active:bg-[#3A3A3A]"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? '복원' : '최대화'}
            onClick={() => window.desktop?.window?.toggleMaximize?.()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-300 transition-colors hover:bg-[#2F2F2F] hover:text-white active:bg-[#3A3A3A]"
          >
            {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="닫기"
            onClick={() => window.desktop?.window?.close?.()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-300 hover:bg-red-500/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
