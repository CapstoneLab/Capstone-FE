import { Clock3, CodeXml, FlaskConical, GitBranch, Hammer, Package, Rocket, Shield, ShieldAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type StageItem = {
  id: string
  title: string
  time: string
  status: '성공' | '실패'
  icon: ComponentType<{ className?: string }>
  logs: string[]
}

type LocationState = {
  repoName?: string
  branch?: string
}

const stages: StageItem[] = [
  {
    id: '1',
    title: '레포지토리 클론',
    time: '10s',
    status: '성공',
    icon: GitBranch,
    logs: ['git clone https://github.com/myuser/web-app', 'checkout main(default)', 'clone completed'],
  },
  {
    id: '2',
    title: '의존성 설치',
    time: '20s',
    status: '성공',
    icon: Package,
    logs: ['npm ci', 'dependencies restored', 'security advisory check skipped (fast mode)'],
  },
  {
    id: '3',
    title: '경량 보안 검사',
    time: '14s',
    status: '성공',
    icon: Shield,
    logs: ['lint security preset started', '0 high severity issues', 'result cached'],
  },
  {
    id: '4',
    title: '테스트',
    time: '28s',
    status: '성공',
    icon: FlaskConical,
    logs: ['unit tests started', '143 passed, 0 failed', 'coverage 87%'],
  },
  {
    id: '5',
    title: '심화 보안 검사',
    time: '22s',
    status: '성공',
    icon: ShieldAlert,
    logs: ['SAST deep profile', 'dependency graph scan', '0 critical vulnerabilities'],
  },
  {
    id: '6',
    title: '빌드',
    time: '31s',
    status: '성공',
    icon: Hammer,
    logs: ['vite build', 'bundle optimization', 'build artifact generated'],
  },
  {
    id: '7',
    title: '배포',
    time: '18s',
    status: '성공',
    icon: Rocket,
    logs: ['release package upload', 'integrity verification', 'deployment completed'],
  },
]

function parseDurationToSeconds(duration: string) {
  const minuteMatch = duration.match(/(\d+)m/)
  const secondMatch = duration.match(/(\d+)s/)
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0
  const seconds = secondMatch ? Number(secondMatch[1]) : 0
  return minutes * 60 + seconds
}

function formatTotalDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function PipelineProcessPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const locationState = (state ?? {}) as LocationState

  const repoName = locationState.repoName ?? 'myuser/web-app'
  const branch = locationState.branch ?? 'main(default)'
  const totalDurationSeconds = stages.reduce((sum, stage) => sum + parseDurationToSeconds(stage.time), 0)
  const successCount = stages.filter((stage) => stage.status === '성공').length

  return (
    <MainLayout>
      <section className="w-full space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[28px] font-bold text-white">
              <CodeXml className="h-7 w-7 text-[#34D399]" />
              {repoName}
            </div>
            <p className="inline-flex items-center gap-2 text-[14px] text-[#878787]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" /> {formatTotalDuration(totalDurationSeconds)}
            </p>
          </div>
          <p className="text-[14px] text-[#6B7280]">브랜치 {branch} · Run #643033</p>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[24px] font-bold text-white">진행 과정</p>
            <p className="text-[14px] text-[#878787]">
              {successCount}/{stages.length} 파이프라인 통과
            </p>
          </div>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
          >
            {stages.map((stage) => (
              <div key={stage.id} className="h-2 rounded-full bg-[#404040]">
                <div
                  className={`h-full w-full rounded-full ${stage.status === '성공' ? 'bg-[#3ECF8E]' : 'bg-[#EF4444]'}`}
                />
              </div>
            ))}
          </div>
        </Card>

        <Accordion type="single" collapsible className="space-y-3">
          {stages.map((stage) => {
            const Icon = stage.icon
            return (
              <AccordionItem
                key={stage.id}
                value={stage.id}
                className={`rounded-2xl border bg-[#262626] p-4 ${
                  stage.status === '성공' ? 'border-[#3ECF8E]' : 'border-[#EF4444]'
                }`}
              >
                <AccordionTrigger className="py-0 hover:no-underline">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full text-[#3ECF8E]">
                      <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current" aria-hidden="true">
                        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10Z" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-[#6B7280]" />
                      <div className="flex flex-col gap-1">
                        <p className="text-[20px] font-semibold text-white">{stage.title}</p>
                        <div className="flex items-center gap-3 text-[14px]">
                          <span className="inline-flex items-center gap-1 text-[#6B7280]">
                            <Clock3 className="h-4 w-4" /> {stage.time}
                          </span>
                          <span className="text-[#3ECF8E]">{stage.status}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-3">
                  <div className="rounded-md border border-[#404040] bg-[#1E1E1E] p-3 text-xs text-[#A1A1A1]">
                    {stage.logs.map((line) => (
                      <p key={line} className="font-mono leading-6">
                        {line}
                      </p>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>

        <div className="flex justify-end pt-1">
          <Button
            onClick={() =>
              navigate('/pipeline/result', {
                state: { repoName, branch },
              })
            }
            className="shadow-none"
          >
            보안 분석 결과
          </Button>
        </div>
      </section>
    </MainLayout>
  )
}
