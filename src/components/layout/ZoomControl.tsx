import { Minus, Plus } from 'lucide-react'
import { useZoom } from '@/contexts/ZoomContext'

/**
 * Fixed bottom-right "− 100% +" control that scales the whole app via CSS zoom.
 *
 * The page zoom is applied to <body>; this control lives inside <body> too, so
 * it carries an inverse `zoom` (1 / current) that cancels the body zoom and
 * keeps the control itself a constant size — it never shrinks out of reach.
 */
export function ZoomControl() {
  const { zoom, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut } = useZoom()

  return (
    <div
      // Inverse zoom neutralises the body zoom so the control stays 100%.
      style={{
        zoom: 1 / zoom,
        background: 'var(--app-bg-elevated)',
        borderColor: 'var(--app-border)',
        color: 'var(--app-text-primary)',
      }}
      className="fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-full border p-1 shadow-lg"
      role="group"
      aria-label="화면 비율 조절"
    >
      <button
        type="button"
        onClick={zoomOut}
        disabled={!canZoomOut}
        aria-label="축소"
        title="축소"
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--app-surface-strong)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={resetZoom}
        aria-label="비율 100%로 초기화"
        title="100%로 초기화"
        className="min-w-[3.25rem] rounded-full px-2 py-0.5 text-center text-[13px] font-semibold tabular-nums transition-colors hover:bg-[color:var(--app-surface-strong)]"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={zoomIn}
        disabled={!canZoomIn}
        aria-label="확대"
        title="확대"
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--app-surface-strong)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
