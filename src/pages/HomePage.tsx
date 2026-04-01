import {
  ArrowRight,
  BadgeCheck,
  Bug,
  ExternalLink,
  FileBarChart2,
  FolderOpen,
  GitBranch,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const features = [
  {
    title: 'Repository 가져오기',
    desc: 'GitHub Repository를 입력하거나 Import하여 분석을 시작할 수 있습니다.',
    image:
      'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=900&q=80',
    icon: FolderOpen,
  },
  {
    title: '자동 보안 분석',
    desc: '정적 코드 분석 도구와 사용자 정의 규칙을 이용해 소스코드를 자동으로 분석합니다.',
    image:
      'https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&w=900&q=80',
    icon: SearchCheck,
  },
  {
    title: '취약 코드 탐지',
    desc: 'SQL Injection, Command Injection, 하드코딩된 비밀번호 등 다양한 보안 취약 코드를 탐지합니다.',
    image:
      'https://images.unsplash.com/photo-1562813733-b31f71025d54?auto=format&fit=crop&w=900&q=80',
    icon: Bug,
  },
  {
    title: '분석 리포트 제공',
    desc: '취약점 유형, 위험도, 코드 위치 등을 포함한 분석 결과 리포트를 제공합니다.',
    image:
      'https://images.unsplash.com/photo-1551281044-8b7a6f8359f5?auto=format&fit=crop&w=900&q=80',
    icon: FileBarChart2,
  },
]

const quickStats = [
  { value: '12,345', label: '분석된 프로젝트', icon: GitBranch },
  { value: '8,000+', label: '탐지된 취약점', icon: Bug },
  { value: '3m 47s', label: '평균 분석 시간', icon: FileBarChart2 },
]

export function HomePage() {
  return (
    <MainLayout>
      <section className="animate-[fade-up_520ms_ease-out] pt-12 text-center md:pt-20">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-green-700/70 bg-green-900/45 px-4 py-1.5 text-xs text-green-200">
          <ShieldCheck className="h-4 w-4" /> 자체 보안 CI/CD 데스크탑 앱
        </div>
        <h1 className="mt-5 text-4xl font-extrabold leading-tight md:text-6xl">
          <span className="block">해커보다</span>
          <span className="block text-green-300">취약점을 먼저 발견해보세요</span>
        </h1>
        <div className="mt-8 flex justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="border border-[#3ECF8E] bg-[#059669] text-white shadow-none hover:bg-[#047857]"
          >
            <Link to="/auth">
              시작하기 <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/docs">문서 보기</Link>
          </Button>
        </div>
        <p className="mt-5 text-sm text-gray-200">
          복잡한 설정 없이 바로 시작 · GitHub와 연동 · 전 과정이 무료
        </p>
      </section>

      <Card className="animate-[fade-up_640ms_ease-out] mt-12 w-full overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-500/60 bg-gray-900/90 px-4 py-2 text-left text-xs text-gray-200">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
          </div>
          <span className="font-mono">secupipeline / secure-ci</span>
        </div>
        <pre className="overflow-x-auto bg-[linear-gradient(105deg,#0a1011,#0c1714_45%,#0e1c17)] p-5 font-mono text-left text-sm leading-7 text-green-100">
{`✓ Install  - Dependencies installed successfully
✓ Test     - 143 tests passed, 0 failed
✓ Build    - Production build compiled
⚠ Security scan - 3 vulnerabilities found (1 critical)
✗ Security Gate - Deploy blocked, fix critical issues first.

Pipeline finished in 3m 25s`}
        </pre>
      </Card>

      <section className="animate-[fade-up_760ms_ease-out] mt-12 grid w-full grid-cols-1 gap-4 text-center sm:grid-cols-3">
        {quickStats.map((item) => (
          <Card key={item.label} className="border-[#262626] bg-[#262626] p-4">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-900/70 text-green-400">
              <item.icon className="h-6 w-6" />
            </div>
            <p className="text-4xl font-extrabold text-white">{item.value}</p>
            <p className="mt-2 text-sm text-[#6B7280]">{item.label}</p>
          </Card>
        ))}
      </section>

      <section className="mt-20 space-y-16">
        {features.map((item, idx) => {
          const Icon = item.icon
          const reversed = idx % 2 === 1
          return (
            <div
              key={item.title}
              className={`grid items-center gap-8 md:grid-cols-2 ${reversed ? 'md:[&>*:first-child]:order-2' : ''}`}
            >
              <img
                src={item.image}
                alt={item.title}
                className="h-56 w-full rounded-2xl border border-gray-500/70 object-cover shadow-2xl"
              />
              <div>
                <Icon className="mb-3 h-12.5 w-12.5 text-green-300" />
                <h3 className="text-[32px] font-bold leading-tight text-white">{item.title}</h3>
                <p className="mt-3 max-w-md text-[18px] leading-8 text-[#6B7280]">{item.desc}</p>
                <Button
                  asChild
                  variant="ghost"
                  className="mt-3 h-auto px-0 py-0 text-[20px] text-[#34D399]! hover:bg-transparent hover:text-[#34D399]!"
                >
                  <Link
                    to="/docs"
                    className="inline-flex items-center gap-1 text-[#34D399]! hover:text-[#34D399]! visited:text-[#34D399]! active:text-[#34D399]!"
                  >
                    자세히 보기 <ExternalLink className="h-5 w-5 text-current" />
                  </Link>
                </Button>
              </div>
            </div>
          )
        })}
      </section>

      <Card className="mt-16 p-4 text-center">
        <BadgeCheck className="mx-auto h-6 w-6 text-green-300" />
        <p className="mt-3 text-sm text-gray-100">
          로컬에서 시작하고, GitHub와 연동해 레포지토리 단위로 보안 탐지를 자동화하세요.
        </p>
      </Card>
    </MainLayout>
  )
}
