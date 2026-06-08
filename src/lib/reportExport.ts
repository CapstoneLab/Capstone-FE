// Security-result export helpers — turns a scan result into downloadable
// artifacts. Four formats are offered from the 결과 다운로드 modal:
//   • JSON  — the structured report object, for programmatic use
//   • CSV   — a flat findings table, opens in any spreadsheet
//   • XLSX  — a two-sheet workbook (요약 / 탐지 항목) via SheetJS (lazy-loaded)
//   • 커스텀 보고서 — a branded, printable HTML document (→ PDF via 인쇄)
// None of these hit the network; everything is generated from the data the
// 결과 페이지 already holds.

import type { SecurityFinding, SecuritySeverity, VerdictKind } from '@/lib/api'

export type ReportData = {
  jobId: string
  repoName: string
  repoUrl: string
  branch: string
  completedAt: string | null
  verdict: VerdictKind | null
  /** Pre-localized gate label (e.g. "통과"/"차단"). */
  verdictLabel: string
  score: number | null
  /** e.g. "82.0/100 (검사 항목 9개 기준)" — printed as-is. */
  scoreLabel: string | null
  counts: Record<SecuritySeverity, number>
  inScopeFindings: SecurityFinding[]
  outOfScopeFindings: SecurityFinding[]
  /** CWE/policy keys selected for this run. */
  selectedItems: string[]
}

const SEVERITY_ORDER: { key: SecuritySeverity; label: string }[] = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
]

const SEVERITY_COLOR: Record<SecuritySeverity, string> = {
  critical: '#EF4444',
  high: '#F97316',
  medium: '#EAB308',
  low: '#22C55E',
}

// ----- shared helpers --------------------------------------------------------

function sanitize(part: string): string {
  return (part || 'report').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60)
}

/** Stable base filename, e.g. "security-report_owner_repo_ab12cd". */
function baseName(data: ReportData): string {
  const repo = sanitize(data.repoName.split('/').pop() || data.repoName)
  const id = sanitize(data.jobId).slice(0, 8)
  return `security-report_${repo}_${id}`
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function severityLabel(sev: SecuritySeverity): string {
  return SEVERITY_ORDER.find((s) => s.key === sev)?.label ?? sev
}

/** Flat row shape shared by the CSV and XLSX findings tables. */
type FindingRow = {
  검사범위: string
  심각도: string
  항목: string
  CWE: string
  제목: string
  파일: string
  라인: string
  스캐너: string
  룰ID: string
  설명: string
}

function toRows(data: ReportData): FindingRow[] {
  const map = (f: SecurityFinding, inScope: boolean): FindingRow => ({
    검사범위: inScope ? '범위 내' : '범위 밖',
    심각도: severityLabel(f.severity),
    항목: f.policyItem || '정책 항목 외',
    CWE: f.cwe || '',
    제목: f.title || '',
    파일: f.filePath || '',
    라인: f.lineNumber != null ? String(f.lineNumber) : '',
    스캐너: f.scanner || '',
    룰ID: f.ruleId || '',
    설명: (f.description || '').replace(/\s+/g, ' ').trim(),
  })
  return [
    ...data.inScopeFindings.map((f) => map(f, true)),
    ...data.outOfScopeFindings.map((f) => map(f, false)),
  ]
}

function summaryPairs(data: ReportData): [string, string][] {
  return [
    ['저장소', data.repoName],
    ['브랜치', data.branch || '-'],
    ['Job ID', data.jobId],
    ['완료 시각', data.completedAt || '-'],
    ['배포 판정', data.verdictLabel || '-'],
    ['보안 점수', data.scoreLabel || (data.score != null ? `${data.score}/100` : '-')],
    ['Critical', String(data.counts.critical ?? 0)],
    ['High', String(data.counts.high ?? 0)],
    ['Medium', String(data.counts.medium ?? 0)],
    ['Low', String(data.counts.low ?? 0)],
    ['범위 내 탐지', String(data.inScopeFindings.length)],
    ['범위 밖 탐지', String(data.outOfScopeFindings.length)],
    ['선택 검사 항목', data.selectedItems.length ? data.selectedItems.join(', ') : '전체'],
  ]
}

// ----- JSON ------------------------------------------------------------------

export function downloadJSON(data: ReportData): void {
  const payload = {
    meta: {
      jobId: data.jobId,
      repoName: data.repoName,
      repoUrl: data.repoUrl,
      branch: data.branch,
      completedAt: data.completedAt,
      generatedBy: 'Secupipeline',
    },
    verdict: { kind: data.verdict, label: data.verdictLabel },
    score: { value: data.score, label: data.scoreLabel },
    counts: data.counts,
    selectedItems: data.selectedItems,
    findings: {
      inScope: data.inScopeFindings,
      outOfScope: data.outOfScopeFindings,
    },
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  triggerDownload(`${baseName(data)}.json`, blob)
}

// ----- CSV -------------------------------------------------------------------

function csvCell(value: string): string {
  // Quote when the cell contains a comma, quote or newline; double inner quotes.
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function downloadCSV(data: ReportData): void {
  const rows = toRows(data)
  const headers = rows.length
    ? Object.keys(rows[0])
    : ['검사범위', '심각도', '항목', 'CWE', '제목', '파일', '라인', '스캐너', '룰ID', '설명']
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvCell(String((r as Record<string, string>)[h] ?? ''))).join(',')),
  ]
  // Prepend a UTF-8 BOM so Excel reads Korean text correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  triggerDownload(`${baseName(data)}.csv`, blob)
}

// ----- XLSX (SheetJS, lazy-loaded) -------------------------------------------

export async function downloadXLSX(data: ReportData): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['항목', '값'],
    ...summaryPairs(data),
  ])
  summarySheet['!cols'] = [{ wch: 16 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, summarySheet, '요약')

  const rows = toRows(data)
  const findingsSheet = XLSX.utils.json_to_sheet(rows, {
    header: ['검사범위', '심각도', '항목', 'CWE', '제목', '파일', '라인', '스캐너', '룰ID', '설명'],
  })
  findingsSheet['!cols'] = [
    { wch: 9 }, { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 34 },
    { wch: 30 }, { wch: 7 }, { wch: 12 }, { wch: 24 }, { wch: 50 },
  ]
  XLSX.utils.book_append_sheet(wb, findingsSheet, '탐지 항목')

  XLSX.writeFile(wb, `${baseName(data)}.xlsx`)
}

// ----- 커스텀 보고서 (printable HTML → PDF) -----------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function findingRowsHtml(findings: SecurityFinding[], inScope: boolean): string {
  if (findings.length === 0) {
    return `<tr><td colspan="6" class="empty">${inScope ? '범위 내' : '범위 밖'} 탐지 항목이 없습니다.</td></tr>`
  }
  return findings
    .map((f) => {
      const color = SEVERITY_COLOR[f.severity] ?? '#6B7280'
      const loc = [escapeHtml(f.filePath || ''), f.lineNumber != null ? `:${f.lineNumber}` : ''].join('')
      return `<tr>
        <td><span class="sev" style="background:${color}">${escapeHtml(severityLabel(f.severity))}</span></td>
        <td>${escapeHtml(f.policyItem || '정책 항목 외')}</td>
        <td>${escapeHtml(f.cwe || '-')}</td>
        <td><strong>${escapeHtml(f.title || '-')}</strong><div class="desc">${escapeHtml((f.description || '').slice(0, 240))}</div></td>
        <td class="mono">${loc || '-'}</td>
        <td class="mono">${escapeHtml(f.scanner || '-')}</td>
      </tr>`
    })
    .join('')
}

function findingRowsHtmlCompact(findings: SecurityFinding[], inScope: boolean): string {
  if (findings.length === 0) {
    return `<tr><td colspan="6" class="empty">${inScope ? '범위 내' : '범위 밖'} 탐지 항목이 없습니다.</td></tr>`
  }
  return findings
    .map((f) => {
      const color = SEVERITY_COLOR[f.severity] ?? '#6B7280'
      const loc = [escapeHtml(f.filePath || ''), f.lineNumber != null ? `:${f.lineNumber}` : ''].join('')
      const policy = escapeHtml(f.policyItem || '정책 항목 외')
      const cwe = escapeHtml(f.cwe || '-')
      return `<tr>
        <td><span class="sev" style="background:${color}">${escapeHtml(severityLabel(f.severity))}</span></td>
        <td colspan="3">
          <strong>${escapeHtml(f.title || '-')}</strong>
          <div class="chips"><span>${policy}</span><span>${cwe}</span></div>
          <div class="desc">${escapeHtml((f.description || '').slice(0, 260))}</div>
        </td>
        <td class="mono">${loc || '-'}</td>
        <td class="mono">${escapeHtml(f.scanner || '-')}</td>
      </tr>`
    })
    .join('')
}

void findingRowsHtml

function buildReportHtml(data: ReportData): string {
  const generatedAt = data.completedAt || ''
  const verdictColor =
    data.verdict === 'pass' ? '#16A34A'
      : data.verdict === 'warn' ? '#CA8A04'
        : data.verdict === 'block_pending_approval' ? '#EA580C'
          : data.verdict === 'block' ? '#DC2626'
            : '#6B7280'
  const sevCards = SEVERITY_ORDER.map(
    (s) => `<div class="card">
      <div class="card-n" style="color:${SEVERITY_COLOR[s.key]}">${data.counts[s.key] ?? 0}</div>
      <div class="card-l">${s.label}</div>
    </div>`,
  ).join('')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(baseName(data))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard', -apple-system, 'Segoe UI', sans-serif; color: #111827; margin: 0; padding: 32px 36px; background: #fff; }
  h1 { font-size: 22px; margin: 0; }
  .brand { display: flex; align-items: center; gap: 8px; color: #149362; font-weight: 800; font-size: 14px; letter-spacing: .02em; }
  .sub { color: #6B7280; font-size: 12px; margin-top: 4px; }
  .verdict { display: inline-block; margin-top: 14px; padding: 8px 16px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 14px; background: ${verdictColor}; }
  .score { font-size: 13px; color: #374151; margin-top: 10px; }
  .meta { margin-top: 18px; border-top: 1px solid #E5E7EB; border-bottom: 1px solid #E5E7EB; padding: 12px 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; }
  .meta div { font-size: 12px; color: #374151; }
  .meta b { color: #111827; }
  .cards { display: flex; gap: 12px; margin: 20px 0; }
  .card { flex: 1; border: 1px solid #E5E7EB; border-radius: 12px; padding: 14px; text-align: center; }
  .card-n { font-size: 26px; font-weight: 800; }
  .card-l { font-size: 12px; color: #6B7280; margin-top: 2px; }
  h2 { font-size: 14px; margin: 22px 0 8px; padding-left: 8px; border-left: 3px solid #149362; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
  col.severity { width: 88px; }
  col.title { width: auto; }
  col.location { width: 28%; }
  col.scanner { width: 76px; }
  th:nth-child(1), td:nth-child(1) { width: 88px; }
  th:nth-child(5), td:nth-child(5) { width: 28%; }
  th:nth-child(6), td:nth-child(6) { width: 76px; }
  th { text-align: left; background: #F3F4F6; color: #374151; padding: 7px 8px; border-bottom: 1px solid #D1D5DB; font-weight: 700; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  td { padding: 8px 8px; border-bottom: 1px solid #EEF0F2; vertical-align: top; overflow-wrap: anywhere; }
  .sev { display: inline-block; padding: 1px 8px; border-radius: 999px; color: #fff; font-size: 10.5px; font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .chips span { display: inline-block; border: 1px solid #E5E7EB; border-radius: 999px; padding: 1px 6px; color: #4B5563; font-size: 9.8px; }
  .desc { color: #6B7280; font-size: 10.5px; margin-top: 3px; line-height: 1.4; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9.5px; color: #374151; line-height: 1.35; overflow-wrap: anywhere; word-break: normal; }
  .empty { text-align: center; color: #9CA3AF; padding: 16px; }
  .foot { margin-top: 28px; color: #9CA3AF; font-size: 10.5px; text-align: center; }
  @media print { body { padding: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>
  <div class="brand">🛡 Secupipeline 보안 분석 보고서</div>
  <h1 style="margin-top:6px">${escapeHtml(data.repoName || data.jobId)}</h1>
  <div class="sub">브랜치 ${escapeHtml(data.branch || '-')} · Job ID ${escapeHtml(data.jobId)}${generatedAt ? ` · ${escapeHtml(generatedAt)}` : ''}</div>
  <div><span class="verdict">${escapeHtml(data.verdictLabel || '판정 없음')}</span></div>
  <div class="score">보안 점수: <b>${escapeHtml(data.scoreLabel || (data.score != null ? `${data.score}/100` : '-'))}</b></div>

  <div class="cards">${sevCards}</div>

  <div class="meta">
    <div><b>선택 검사 항목</b> · ${data.selectedItems.length ? escapeHtml(data.selectedItems.join(', ')) : '전체'}</div>
    <div><b>범위 내 / 밖 탐지</b> · ${data.inScopeFindings.length} / ${data.outOfScopeFindings.length}</div>
  </div>

  <h2>검사 범위 내 탐지 항목 (${data.inScopeFindings.length})</h2>
  <table>
    <thead><tr><th>심각도</th><th>항목</th><th>CWE</th><th>제목 / 설명</th><th>위치</th><th>스캐너</th></tr></thead>
    <tbody>${findingRowsHtmlCompact(data.inScopeFindings, true)}</tbody>
  </table>

  <h2>검사 범위 밖 탐지 항목 (${data.outOfScopeFindings.length})</h2>
  <table>
    <thead><tr><th>심각도</th><th>항목</th><th>CWE</th><th>제목 / 설명</th><th>위치</th><th>스캐너</th></tr></thead>
    <tbody>${findingRowsHtmlCompact(data.outOfScopeFindings, false)}</tbody>
  </table>

  <div class="foot">본 보고서는 Secupipeline에서 자동 생성되었습니다.</div>
</body>
</html>`
}

/**
 * Produce the branded report as a PDF.
 *
 * In Electron we hand the HTML to the main process (`desktop.report.savePdf`),
 * which renders it with `printToPDF` and prompts for a save location — the
 * desktop print dialog has no preview, so this gives a real, openable PDF
 * instead. In a plain browser we fall back to rendering into a hidden iframe
 * and calling print() (browsers DO show a print preview there).
 */
export async function openPrintableReport(data: ReportData): Promise<void> {
  const html = buildReportHtml(data)
  const savePdf = window.desktop?.report?.savePdf
  if (typeof savePdf === 'function') {
    try {
      const res = await savePdf(html, `${baseName(data)}.pdf`)
      // Done (saved) or the user cancelled the save dialog — either way, no
      // need for the browser fallback. Only fall through on an actual error.
      if (res?.ok || res?.canceled) return
      console.error('[report] savePdf failed:', res?.error)
    } catch (err) {
      console.error('[report] savePdf threw, falling back to print:', err)
    }
  }

  printReportViaIframe(html)
}

/** Browser fallback: render into a hidden iframe and open the print dialog. */
function printReportViaIframe(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'
  document.body.appendChild(iframe)

  const cleanup = () => {
    // Defer removal so the print job can read the document first.
    setTimeout(() => iframe.remove(), 1000)
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      cleanup()
      return
    }
    win.focus()
    win.print()
    // Most engines fire focus back on the opener once the dialog closes.
    win.onafterprint = cleanup
    // Fallback cleanup in case onafterprint never fires.
    setTimeout(cleanup, 60_000)
  }

  const doc = iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
}

export type ReportFormat = 'pdf' | 'csv' | 'xlsx' | 'json'

export async function runExport(format: ReportFormat, data: ReportData): Promise<void> {
  switch (format) {
    case 'json':
      return downloadJSON(data)
    case 'csv':
      return downloadCSV(data)
    case 'xlsx':
      return downloadXLSX(data)
    case 'pdf':
      return openPrintableReport(data)
  }
}
