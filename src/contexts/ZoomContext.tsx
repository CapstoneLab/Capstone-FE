import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type ZoomContextValue = {
  /** Current zoom factor (1 = 100%). */
  zoom: number
  /** Step the zoom one increment up (capped at MAX_ZOOM). */
  zoomIn: () => void
  /** Step the zoom one increment down (capped at MIN_ZOOM). */
  zoomOut: () => void
  /** Jump straight back to 100%. */
  resetZoom: () => void
  /** Set an explicit factor — clamped into [MIN_ZOOM, MAX_ZOOM]. */
  setZoom: (next: number) => void
  canZoomIn: boolean
  canZoomOut: boolean
}

const ZoomContext = createContext<ZoomContextValue | null>(null)

const STORAGE_KEY = 'secupipeline:zoom'
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2
const STEP = 0.1

function clamp(value: number): number {
  // Round to 2 decimals so repeated stepping never drifts (e.g. 0.30000004).
  const rounded = Math.round(value * 100) / 100
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rounded))
}

function readStoredZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = Number.parseFloat(raw)
      if (Number.isFinite(parsed)) return clamp(parsed)
    }
  } catch {
    // ignore
  }
  return 1
}

export function ZoomProvider({ children }: { children: ReactNode }) {
  const [zoom, setZoomState] = useState<number>(() => readStoredZoom())

  // CSS `zoom` scales the whole layout like the browser's native zoom. We apply
  // it to #root (the app wrapper) rather than <body>: the layout uses
  // `html, body, #root { height: 100% }`, so zooming <body> would paint it at
  // only `zoom × 100vh` and leave a dead band below. Counter-sizing #root to
  // `100 / zoom` % means after the zoom multiply it lands back at exactly the
  // full viewport (e.g. at 60% → 166.7% × 0.6 = 100%), so content always fills
  // the screen. The fixed ZoomControl lives inside #root and cancels this with
  // an inverse `zoom`, keeping itself a constant size.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.getElementById('root')
    if (!root) return
    root.style.zoom = String(zoom)
    root.style.width = `${100 / zoom}%`
    root.style.height = `${100 / zoom}%`
  }, [zoom])

  const setZoom = useCallback((next: number) => {
    const clamped = clamp(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped))
    } catch {
      // ignore storage errors
    }
    setZoomState(clamped)
  }, [])

  const zoomIn = useCallback(() => setZoom(zoom + STEP), [zoom, setZoom])
  const zoomOut = useCallback(() => setZoom(zoom - STEP), [zoom, setZoom])
  const resetZoom = useCallback(() => setZoom(1), [setZoom])

  const value = useMemo<ZoomContextValue>(
    () => ({
      zoom,
      zoomIn,
      zoomOut,
      resetZoom,
      setZoom,
      canZoomIn: zoom < MAX_ZOOM,
      canZoomOut: zoom > MIN_ZOOM,
    }),
    [zoom, zoomIn, zoomOut, resetZoom, setZoom],
  )

  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>
}

export function useZoom(): ZoomContextValue {
  const ctx = useContext(ZoomContext)
  if (!ctx) {
    throw new Error('useZoom must be used within ZoomProvider')
  }
  return ctx
}
