import { useState } from 'react'
import { Braces, FileText, Loader2, Printer, Sheet } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { runExport, type ReportData, type ReportFormat } from '@/lib/reportExport'

type Option = {
  format: ReportFormat
  label: string
  ext: string
  desc: string
  icon: typeof FileText
  accent: string
}

const OPTIONS: Option[] = [
  {
    format: 'pdf',
    label: '커스텀 보고서',
    ext: 'PDF',
    desc: '자체 양식의 인쇄용 보고서 — 인쇄 창에서 PDF로 저장',
    icon: Printer,
    accent: '#34D399',
  },
  {
    format: 'csv',
    label: 'CSV',
    ext: 'CSV',
    desc: '탐지 항목 표 — 모든 스프레드시트에서 열람',
    icon: FileText,
    accent: '#60A5FA',
  },
  {
    format: 'xlsx',
    label: 'Excel',
    ext: 'XLSX',
    desc: '요약 · 탐지 항목 2개 시트 워크북',
    icon: Sheet,
    accent: '#34D399',
  },
  {
    format: 'json',
    label: 'JSON',
    ext: 'JSON',
    desc: '구조화 데이터 — 프로그램 연동용',
    icon: Braces,
    accent: '#FBBF24',
  },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: ReportData
}

export function ResultDownloadDialog({ open, onOpenChange, data }: Props) {
  const [busy, setBusy] = useState<ReportFormat | null>(null)

  async function handlePick(format: ReportFormat) {
    if (busy) return
    setBusy(format)
    try {
      await runExport(format, data)
      // The print dialog (pdf) stays open on its own; close the modal either way.
      onOpenChange(false)
    } catch (err) {
      console.error('[download] export failed:', err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,460px)] border-[#404040] bg-[#242424] text-gray-50">
        <DialogHeader>
          <DialogTitle>결과 다운로드</DialogTitle>
          <DialogDescription>
            원하는 형식을 선택하세요. {data.repoName || data.jobId}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-2">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon
            const isBusy = busy === opt.format
            return (
              <button
                key={opt.format}
                type="button"
                disabled={busy !== null}
                onClick={() => handlePick(opt.format)}
                className="flex items-center gap-3 rounded-xl border border-[#404040] bg-[#1E1E1E] px-3.5 py-3 text-left transition-colors hover:border-[#34D399]/60 hover:bg-[#2A2A2A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${opt.accent}1A`, color: opt.accent }}
                >
                  {isBusy ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <Icon className="h-4.5 w-4.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[14px] font-semibold text-white">{opt.label}</span>
                    <span className="rounded bg-[#404040] px-1.5 py-px text-[10px] font-medium text-[#D1D5DB]">
                      {opt.ext}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] text-[#9CA3AF]">{opt.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
