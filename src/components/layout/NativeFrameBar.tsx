import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  LogIn,
  House,
  Loader2,
  Minus,
  Square,
  UserRound,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

function withVersionPrefix(version: string | null | undefined) {
  if (!version) {
    return 'v0.0.0'
  }

  return version.startsWith('v') ? version : `v${version}`
}

function normalizeUpdaterErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return '업데이트 확인 중 오류가 발생했습니다.'
  }

  return error.message.replace(/^Error invoking remote method\s+'[^']+':\s*/i, '').trim()
}

export function NativeFrameBar() {
  const navigate = useNavigate()
  const [isMaximized, setIsMaximized] = useState(false)
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false)
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState({
    appName: 'SecuPipeline',
    version: '0.0.0',
  })
  const [releaseInfo, setReleaseInfo] = useState<DesktopReleaseInfo | null>(null)

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

  useEffect(() => {
    let mounted = true

    window.desktop?.appInfo
      ?.get?.()
      .then((info) => {
        if (!mounted || !info) {
          return
        }

        setAppInfo({
          appName: info.appName || 'SecuPipeline',
          version: info.version || '0.0.0',
        })
      })
      .catch(() => {
        if (!mounted) {
          return
        }

        setAppInfo({
          appName: 'SecuPipeline',
          version: '0.0.0',
        })
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true)
    setUpdateError(null)

    try {
      const info = await window.desktop?.updater?.checkForUpdates?.()

      if (!info) {
        throw new Error('업데이트 정보를 가져오지 못했습니다.')
      }

      setReleaseInfo(info)
      setIsProfileDialogOpen(false)
      setIsUpdateDialogOpen(true)
    } catch (error) {
      setReleaseInfo(null)
      setUpdateError(normalizeUpdaterErrorMessage(error))
      setIsProfileDialogOpen(false)
      setIsUpdateDialogOpen(true)
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const handleInstallUpdate = async () => {
    if (!releaseInfo?.installerUrl) {
      setUpdateError('설치 가능한 EXE 파일을 찾지 못했습니다.')
      return
    }

    setIsInstallingUpdate(true)
    setUpdateError(null)

    try {
      await window.desktop?.updater?.downloadAndInstall?.(releaseInfo.installerUrl, releaseInfo.latestVersion)
    } catch (error) {
      setUpdateError(normalizeUpdaterErrorMessage(error))
      setIsInstallingUpdate(false)
    }
  }

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
          <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label="프로필"
                className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-300 transition-colors hover:bg-[#2F2F2F] hover:text-white active:bg-[#3A3A3A]"
              >
                <UserRound className="h-4 w-4" />
              </button>
            </DialogTrigger>

            <DialogContent className="left-auto right-3 top-13.5 w-[min(92vw,320px)] translate-x-0 translate-y-0 border-gray-600/70 bg-[#222222] p-0">
              <div className="border-b border-gray-700/80 px-4 py-3">
                <DialogHeader>
                  <DialogTitle className="text-base">프로필</DialogTitle>
                </DialogHeader>
              </div>

              <div className="space-y-3 px-4 py-3">
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-700/70 bg-[#1C1C1C] px-3 py-4">
                  <img src="/default-profile.svg" alt="기본 프로필" className="h-16 w-16 rounded-full" />
                  <p className="text-center text-sm font-semibold text-gray-100">
                    비로그인 상태입니다. 로그인이 필요합니다.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full justify-center bg-emerald-400 px-3 text-xs font-semibold text-[#111827] shadow-none hover:bg-emerald-300"
                  onClick={() => {
                    setIsProfileDialogOpen(false)
                    navigate('/auth')
                  }}
                >
                  <LogIn className="mr-1.5 h-4 w-4" />로그인
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full justify-center border-gray-600 bg-[#2A2A2A] text-gray-100 hover:bg-[#333333]"
                  onClick={handleCheckUpdates}
                  disabled={isCheckingUpdate}
                >
                  {isCheckingUpdate ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />업데이트 확인 중...
                    </>
                  ) : (
                    '앱 업데이트 확인'
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

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

      <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
        <DialogContent className="w-[min(92vw,460px)] border-gray-600/75 bg-[#202020]">
          <DialogHeader className="items-center text-center">
            <DialogTitle>앱 업데이트 확인</DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex flex-col items-center text-center">
            <img src="/favicon.svg" alt="앱 아이콘" className="h-10 w-10" />
            <p className="mt-3 text-base font-semibold text-white">{releaseInfo?.appName || appInfo.appName}</p>
            <p className="mt-1 text-xs text-gray-300">
              현재 앱 버전 {withVersionPrefix(releaseInfo?.currentVersion || appInfo.version)}
            </p>
            {releaseInfo?.latestVersion && (
              <p className="mt-1 text-xs text-gray-400">
                최신 릴리즈 버전 {withVersionPrefix(releaseInfo.latestVersion)}
              </p>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-gray-700/80 bg-[#171717] p-4">
            <p className="mb-3 text-center text-xs font-semibold tracking-wide text-gray-400">업데이트 확인</p>
            {updateError ? (
              <p className="text-center text-sm text-red-300">{updateError}</p>
            ) : releaseInfo?.hasUpdate ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-center text-sm text-amber-200">
                  신규 버전 {withVersionPrefix(releaseInfo.latestVersion)}이(가) 있습니다.
                </p>
                <Button
                  type="button"
                  className="h-9 bg-emerald-400 px-4 text-xs font-semibold text-[#111827] hover:bg-emerald-300"
                  onClick={handleInstallUpdate}
                  disabled={isInstallingUpdate}
                >
                  {isInstallingUpdate ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />다운로드 중...
                    </>
                  ) : (
                    <>
                      <Download className="mr-1.5 h-4 w-4" />업데이트 하기
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <p className="text-center text-sm text-emerald-300">
                {releaseInfo?.statusMessage || '최신 버전입니다.'}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" className="h-9 px-3 text-xs text-gray-200">
                닫기
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
