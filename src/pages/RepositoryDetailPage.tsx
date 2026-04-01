import dayjs from 'dayjs'
import 'dayjs/locale/ko'
import relativeTime from 'dayjs/plugin/relativeTime'
import { ArrowUpRight, CheckCircle2, CircleEllipsis, GitBranch, Globe, XCircle } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { getRepositoryById, repositorySeed } from '@/data/repositories'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GitHubIcon } from '@/components/ui/github-icon'

dayjs.extend(relativeTime)
dayjs.locale('ko')

const pipelineStatusMeta = {
  success: {
    label: '성공',
    className: 'border-[#3ECF8E] bg-[#065F46] text-[#6EE7B7]',
    icon: CheckCircle2,
  },
  failed: {
    label: '실패',
    className: 'border-[#F87171] bg-[#7F1D1D] text-[#FCA5A5]',
    icon: XCircle,
  },
  pending: {
    label: '보류',
    className: 'border-[#F59E0B] bg-[#78350F] text-[#FCD34D]',
    icon: CircleEllipsis,
  },
} as const

export function RepositoryDetailPage() {
  const { state } = useLocation()
  const { repoId: paramRepoId = '' } = useParams()

  const locationState = (state ?? {}) as { repoId?: string }
  const resolvedRepoId = locationState.repoId ?? paramRepoId ?? repositorySeed[0]?.id ?? ''
  const repo = getRepositoryById(resolvedRepoId) ?? repositorySeed[0] ?? null

  if (!repo) {
    return (
      <MainLayout>
        <Card className="border-[#404040] bg-[#262626] p-6">
          <p className="text-[20px] font-bold text-white">레포지토리를 찾을 수 없습니다.</p>
          <p className="mt-2 text-[14px] text-[#9CA3AF]">요청하신 상세 정보가 존재하지 않습니다.</p>
          <Button asChild className="mt-4 w-fit shadow-none">
            <Link to="/dashboard">대시보드로 돌아가기</Link>
          </Button>
        </Card>
      </MainLayout>
    )
  }

  const status = pipelineStatusMeta[repo.pipelineStatus]
  const StatusIcon = status.icon

  return (
    <MainLayout>
      <section className="space-y-4">
        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[28px] font-bold text-white">{repo.name}</h1>
                <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">{repo.visibility}</Badge>
              </div>
              <p className="mt-2 text-[14px] text-[#9CA3AF]">{repo.description}</p>
              <p className="mt-2 text-[12px] text-[#6B7280]">최근 업데이트: {dayjs(repo.updatedAt).fromNow()}</p>
            </div>

            <Button asChild variant="outline" className="w-fit border-[#3ECF8E] text-[#D1FAE5] hover:bg-[#065F46]/45">
              <a href={repo.repositoryUrl} target="_blank" rel="noreferrer">
                <GitHubIcon className="mr-1.5 h-4 w-4" /> 해당 실제 레포지토리 이동
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="text-[16px] font-semibold text-white">도메인 주소</p>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="inline-flex items-center gap-2 text-[14px] text-[#D1D5DB]">
                <Globe className="h-4 w-4 text-[#34D399]" />
                {repo.domainUrl}
              </p>
              <p className="mt-2 text-[12px] text-[#6B7280]">Amazon EC2 배포 엔드포인트</p>
            </div>
          </Card>

          <Card className="border-[#404040] bg-[#262626] p-4">
            <p className="text-[16px] font-semibold text-white">파이프라인 최근 상태</p>
            <div className="mt-3 rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <Badge className={`inline-flex items-center gap-1.5 ${status.className}`}>
                <StatusIcon className="h-3.5 w-3.5" /> {status.label}
              </Badge>
              <p className="mt-2 text-[12px] text-[#9CA3AF]">
                최근 실행 브랜치 기준 파이프라인 상태입니다.
              </p>
            </div>
          </Card>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="text-[16px] font-semibold text-white">소스</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">브랜치</p>
              <p className="mt-1 text-[14px] font-semibold text-[#E5E7EB]">{repo.source.branch}</p>
            </div>
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3 md:col-span-2">
              <p className="text-[12px] text-[#6B7280]">커밋 메시지</p>
              <p className="mt-1 text-[14px] text-[#E5E7EB]">{repo.source.commitMessage}</p>
            </div>
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
              <p className="text-[12px] text-[#6B7280]">푸시 사용자</p>
              <p className="mt-1 text-[14px] text-[#E5E7EB]">{repo.source.pushedBy}</p>
            </div>
            <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3 md:col-span-2">
              <p className="text-[12px] text-[#6B7280]">푸시 시각</p>
              <p className="mt-1 text-[14px] text-[#E5E7EB]">{dayjs(repo.source.pushedAt).format('YYYY-MM-DD HH:mm')}</p>
            </div>
          </div>
        </Card>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <p className="inline-flex items-center gap-2 text-[16px] font-semibold text-white">
            <GitBranch className="h-4 w-4 text-[#34D399]" /> 브랜치 목록
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {repo.branches.map((branch) => (
              <Badge
                key={branch}
                className={`rounded-full px-3 py-1 text-[12px] ${
                  branch === 'main'
                    ? 'border-[#6EE7B7] bg-[#065F46] text-[#6EE7B7]'
                    : 'border-white/20 bg-[#3A3A3A] text-[#9CA3AF]'
                }`}
              >
                {branch}
              </Badge>
            ))}
          </div>
        </Card>
      </section>
    </MainLayout>
  )
}
