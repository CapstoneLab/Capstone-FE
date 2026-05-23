import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  CodeXml,
  FlaskConical,
  GitBranch,
  Hammer,
  Loader2,
  Package,
  Rocket,
  Shield,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import {
  cancelPipeline,
  fetchJobDetail,
  fetchPipelineLogs,
  type JobDetail,
  type JobStep,
} from '@/lib/api'

type LocationState = {
  jobId?: string
  repoName?: string
  branch?: string
}

const POLL_INTERVAL_MS = 2000

const TERMINAL_JOB_STATUSES = new Set(['success', 'failed', 'cancelled'])

const stepIconMap: { match: RegExp; icon: ComponentType<{ className?: string }> }[] = [
  { match: /clone|checkout|git|레포|클론/i, icon: GitBranch },
  { match: /install|deps|dependen|npm|pip|pnpm|yarn|의존성|설치/i, icon: Package },
  { match: /deep|deep-scan|sast-deep|심화/i, icon: ShieldAlert },
  { match: /scan|secret|gitleaks|semgrep|sast|security|보안|검사/i, icon: Shield },
  { match: /test|lint|coverage|테스트/i, icon: FlaskConical },
  { match: /build|compile|bundle|빌드/i, icon: Hammer },
  { match: /deploy|release|publish|배포/i, icon: Rocket },
]

const PLACEHOLDER_STEPS: JobStep[] = [
  { stepId: 'ph-clone', stepName: '레포지토리 클론', stepType: 'clone', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-install', stepName: '의존성 설치', stepType: 'install', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-scan-light', stepName: '경량 보안 검사', stepType: 'security-light', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-test', stepName: '테스트', stepType: 'test', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-scan-deep', stepName: '심화 보안 검사', stepType: 'security-deep', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-build', stepName: '빌드', stepType: 'build', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
  { stepId: 'ph-deploy', stepName: '배포', stepType: 'deploy', status: 'pending', errorMessage: null, startedAt: null, endedAt: null, durationSecs: null },
]

function iconForStep(step: JobStep): ComponentType<{ className?: string }> {
  const haystack = `${step.stepName} ${step.stepType}`
  for (const entry of stepIconMap) {
    if (entry.match.test(haystack)) return entry.icon
  }
  return ShieldAlert
}

function formatDuration(totalSeconds: number) {
  if (!totalSeconds || totalSeconds < 0) return '0s'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function statusColor(status: JobStep['status']): string {
  switch (status) {
    case 'success':
      return '#3ECF8E'
    case 'failed':
      return '#EF4444'
    case 'running':
      return '#F59E0B'
    case 'skipped':
      return '#6B7280'
    default:
      return '#404040'
  }
}

function statusLabel(status: JobStep['status']): string {
  switch (status) {
    case 'success':
      return '성공'
    case 'failed':
      return '실패'
    case 'running':
      return '진행 중'
    case 'skipped':
      return '건너뜀'
    default:
      return '대기'
  }
}

function StepStatusIcon({ status }: { status: JobStep['status'] }) {
  if (status === 'success') return <CheckCircle2 className="h-7 w-7 text-[#3ECF8E]" />
  if (status === 'failed') return <XCircle className="h-7 w-7 text-[#EF4444]" />
  if (status === 'running') return <Loader2 className="h-7 w-7 animate-spin text-[#F59E0B]" />
  return <CircleDashed className="h-7 w-7 text-[#6B7280]" />
}

function jobStatusBadge(status: string): { label: string; dotColor: string } {
  switch (status) {
    case 'success':
      return { label: '성공', dotColor: '#3ECF8E' }
    case 'failed':
      return { label: '실패', dotColor: '#EF4444' }
    case 'cancelled':
      return { label: '취소됨', dotColor: '#6B7280' }
    case 'running':
      return { label: '실행 중', dotColor: '#F59E0B' }
    case 'queued':
      return { label: '대기 중', dotColor: '#6B7280' }
    default:
      return { label: status || '-', dotColor: '#6B7280' }
  }
}

export function PipelineProcessPage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState
  const jobId = locationState.jobId ?? ''

  const [job, setJob] = useState<JobDetail | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [, setIsInitialLoading] = useState(true)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isCancelling, setIsCancelling] = useState(false)

  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const lastLogCount = useRef(0)
  const startedAtMsRef = useRef<number | null>(null)

  useEffect(() => {
    if (!jobId || !token) {
      setIsInitialLoading(false)
      return
    }

    let cancelled = false
    let timer: number | null = null

    async function tick() {
      let isTerminal = false
      try {
        const [nextJob, nextLogs] = await Promise.all([
          fetchJobDetail(token!, jobId),
          fetchPipelineLogs(token!, jobId),
        ])
        if (cancelled) return
        console.log(
          '[pipeline-poll]',
          'status:', nextJob?.status,
          'steps:', nextJob?.steps?.length ?? 0,
          'logs:', nextLogs.length,
          'startedAt:', nextJob?.startedAt,
          'raw:', nextJob,
        )
        if (nextJob) {
          setJob(nextJob)
          isTerminal = TERMINAL_JOB_STATUSES.has(nextJob.status)
        }
        setLogs(nextLogs)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : '파이프라인 상태를 가져오지 못했습니다.',
        )
      } finally {
        if (!cancelled) {
          setIsInitialLoading(false)
          if (!isTerminal) {
            timer = window.setTimeout(tick, POLL_INTERVAL_MS)
          }
        }
      }
    }

    tick()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [jobId, token])

  useEffect(() => {
    if (!logContainerRef.current) return
    if (logs.length === lastLogCount.current) return
    lastLogCount.current = logs.length
    const el = logContainerRef.current
    el.scrollTop = el.scrollHeight
  }, [logs])

  const repoName = job?.repoName || locationState.repoName || ''
  const branch = job?.branch || locationState.branch || ''
  const apiSteps = job?.steps ?? []
  const jobStatus = job?.status ?? 'queued'
  const jobBadge = jobStatusBadge(jobStatus)
  const isTerminal = TERMINAL_JOB_STATUSES.has(jobStatus)

  const hasJobStarted = !!(
    job?.startedAt ||
    (jobStatus && jobStatus !== 'queued') ||
    apiSteps.some((s) => s.status !== 'pending') ||
    logs.length > 0
  )

  useEffect(() => {
    // Priority 1: backend's authoritative startedAt — set every time it changes
    if (job?.startedAt) {
      const ms = Date.parse(job.startedAt)
      if (!Number.isNaN(ms)) {
        startedAtMsRef.current = ms
      }
    } else if (hasJobStarted && startedAtMsRef.current === null) {
      // Priority 2: started but backend hasn't told us when → use now as fallback (once)
      startedAtMsRef.current = Date.now()
    }

    if (!hasJobStarted) {
      setElapsedSec(0)
      return
    }

    const start = startedAtMsRef.current
    if (start === null) return

    if (isTerminal) {
      if (job?.durationSecs && job.durationSecs > 0) {
        setElapsedSec(job.durationSecs)
      } else {
        setElapsedSec(Math.max(0, Math.round((Date.now() - start) / 1000)))
      }
      return
    }

    // Immediately seed once so we don't show 0 for a tick when refreshing mid-run
    setElapsedSec(Math.max(0, Math.round((Date.now() - start) / 1000)))

    const id = window.setInterval(() => {
      const s = startedAtMsRef.current
      if (s === null) return
      setElapsedSec(Math.max(0, Math.round((Date.now() - s) / 1000)))
    }, 1000)
    return () => window.clearInterval(id)
  }, [hasJobStarted, isTerminal, job?.startedAt, job?.durationSecs])

  const stepLogsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const line of logs) {
      const match = line.match(/^\[([^.\]]+)(?:\.log)?\]/)
      const key = match ? match[1] : '__general__'
      const list = map.get(key) ?? []
      list.push(line)
      map.set(key, list)
    }
    return map
  }, [logs])

  const findLogsForStep = (step: JobStep): string[] => {
    if (step.stepName && stepLogsMap.has(step.stepName)) return stepLogsMap.get(step.stepName)!
    if (step.stepType && stepLogsMap.has(step.stepType)) return stepLogsMap.get(step.stepType)!
    const stepIcon = iconForStep(step)
    for (const [logKey, lines] of stepLogsMap) {
      if (logKey === '__general__') continue
      const proxy: JobStep = { ...step, stepName: logKey, stepType: logKey }
      if (iconForStep(proxy) === stepIcon) return lines
    }
    return []
  }

  async function handleCancel() {
    if (!token || !jobId || isCancelling) return
    const ok = window.confirm('실행 중인 파이프라인을 취소할까요? 진행 중인 작업은 즉시 종료됩니다.')
    if (!ok) return
    setIsCancelling(true)
    try {
      await cancelPipeline(token, jobId)
      const refreshed = await fetchJobDetail(token, jobId)
      if (refreshed) setJob(refreshed)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '파이프라인 취소에 실패했습니다.')
    } finally {
      setIsCancelling(false)
    }
  }

  const steps: JobStep[] = useMemo(() => {
    const usedApi = new Set<number>()
    const merged: JobStep[] = PLACEHOLDER_STEPS.map((placeholder) => {
      const placeholderIcon = iconForStep(placeholder)
      const apiIdx = apiSteps.findIndex((api, i) => {
        if (usedApi.has(i)) return false
        if (api.stepType && placeholder.stepType && api.stepType === placeholder.stepType) return true
        if (api.stepName && placeholder.stepName && api.stepName === placeholder.stepName) return true
        return iconForStep(api) === placeholderIcon
      })
      if (apiIdx >= 0) {
        usedApi.add(apiIdx)
        return { ...apiSteps[apiIdx], stepName: apiSteps[apiIdx].stepName || placeholder.stepName }
      }
      // No API step yet — keep placeholder, but flip to 'running' if logs already arrived for it
      const matchedLogs = findLogsForStep(placeholder)
      if (matchedLogs.length > 0 && placeholder.status === 'pending') {
        return { ...placeholder, status: 'running' as const }
      }
      return placeholder
    })
    // Append unmatched API steps (extras the backend reports beyond our 7-step template)
    apiSteps.forEach((api, i) => {
      if (!usedApi.has(i)) merged.push(api)
    })
    return merged
    // findLogsForStep depends on stepLogsMap which depends on logs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiSteps, stepLogsMap])
  const successCount = steps.filter((step) => step.status === 'success').length

  if (!jobId) {
    return (
      <MainLayout>
        <Card className="p-6 text-center text-[#FCA5A5]">
          job_id가 전달되지 않았습니다. 새 파이프라인을 다시 실행해 주세요.
        </Card>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => navigate('/pipeline/new')}>새 파이프라인</Button>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[28px] font-bold text-white">
              <CodeXml className="h-7 w-7 text-[#34D399]" />
              {repoName || jobId}
            </div>
            <p className="inline-flex items-center gap-2 text-[14px] text-[#878787]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: jobBadge.dotColor }} />
              {jobBadge.label} · {formatDuration(elapsedSec)}
            </p>
          </div>
          <p className="text-[14px] text-[#6B7280]">
            브랜치 {branch || '-'} · Job {jobId.slice(0, 8)}
          </p>
        </div>

        {error ? (
          <Card className="border-[#7F1D1D] bg-[#450A0A]/40 p-3 text-center text-sm text-[#FCA5A5]">
            {error}
          </Card>
        ) : null}

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[24px] font-bold text-white">진행 과정</p>
            <p className="text-[14px] text-[#878787]">
              {successCount}/{steps.length} 단계 통과
            </p>
          </div>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          >
            {steps.map((step) => (
              <div key={step.stepId || step.stepName} className="h-2 rounded-full bg-[#404040]">
                <div
                  className="h-full w-full rounded-full"
                  style={{ backgroundColor: statusColor(step.status) }}
                />
              </div>
            ))}
          </div>
        </Card>

        <Accordion type="single" collapsible className="space-y-3">
          {steps.map((step, idx) => {
            const Icon = iconForStep(step)
            const key = step.stepId || `${step.stepName}-${idx}`
            const borderColor =
              step.status === 'success'
                ? 'border-[#3ECF8E]'
                : step.status === 'failed'
                  ? 'border-[#EF4444]'
                  : step.status === 'running'
                    ? 'border-[#F59E0B]'
                    : 'border-[#404040]'
            const matchedLogs = findLogsForStep(step)
            const duration = step.durationSecs ?? 0

            return (
              <AccordionItem
                key={key}
                value={key}
                className={`rounded-2xl border bg-[#262626] p-4 ${borderColor}`}
              >
                <AccordionTrigger className="py-0 hover:no-underline">
                  <div className="flex items-center gap-3">
                    <StepStatusIcon status={step.status} />
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-[#6B7280]" />
                      <div className="flex flex-col gap-1">
                        <p className="text-[20px] font-semibold text-white">
                          {step.stepName || '(unnamed)'}
                        </p>
                        <div className="flex items-center gap-3 text-[14px]">
                          <span className="inline-flex items-center gap-1 text-[#6B7280]">
                            <Clock3 className="h-4 w-4" /> {formatDuration(duration)}
                          </span>
                          <span style={{ color: statusColor(step.status) }}>
                            {statusLabel(step.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-3">
                  {step.errorMessage ? (
                    <p className="mb-2 rounded-md border border-[#7F1D1D] bg-[#450A0A]/40 p-2 text-xs text-[#FCA5A5]">
                      {step.errorMessage}
                    </p>
                  ) : null}
                  <div className="rounded-md border border-[#404040] bg-[#1E1E1E] p-3 text-xs text-[#A1A1A1]">
                    {matchedLogs.length === 0 ? (
                      <p className="font-mono text-[#6B7280]">로그 없음</p>
                    ) : (
                      matchedLogs.map((line, lineIdx) => (
                        <p key={lineIdx} className="font-mono leading-6 break-all">
                          {line}
                        </p>
                      ))
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[16px] font-semibold text-white">실시간 로그</p>
            <p className="text-[12px] text-[#6B7280]">{logs.length} 줄</p>
          </div>
          <div
            ref={logContainerRef}
            className="max-h-96 overflow-y-auto rounded-md border border-[#404040] bg-[#0F0F0F] p-3 text-xs text-[#D1D5DB]"
          >
            {logs.length === 0 ? (
              <p className="font-mono text-[#6B7280]">로그를 기다리는 중...</p>
            ) : (
              logs.map((line, idx) => (
                <p key={idx} className="font-mono leading-5 break-all">
                  {line}
                </p>
              ))
            )}
          </div>
        </Card>

        <div className="flex justify-end gap-2 pt-1">
          {!isTerminal ? (
            <Button
              onClick={handleCancel}
              disabled={isCancelling}
              className="border border-[#7F1D1D] bg-transparent text-[#FCA5A5] shadow-none hover:bg-[#450A0A]/40"
            >
              {isCancelling ? '취소 중...' : '파이프라인 취소'}
            </Button>
          ) : null}
          <Button
            onClick={() =>
              navigate('/pipeline/result', {
                state: { jobId, repoName, branch },
              })
            }
            disabled={!isTerminal}
            className="shadow-none"
          >
            보안 분석 결과
          </Button>
        </div>
      </section>
    </MainLayout>
  )
}
