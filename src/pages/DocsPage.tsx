import { FileText, ShieldCheck, Workflow } from 'lucide-react'
import { MainLayout } from '@/components/layout/MainLayout'
import { Card } from '@/components/ui/card'

const docs = [
  {
    title: '시작 가이드',
    description: 'GitHub 연동부터 첫 파이프라인 실행까지 빠르게 진행하는 흐름을 제공합니다.',
    icon: FileText,
  },
  {
    title: '보안 스캔 규칙',
    description: '취약점 등급, 보안 게이트 조건, 실패 처리 정책을 관리합니다.',
    icon: ShieldCheck,
  },
  {
    title: '파이프라인 운영',
    description: '실행 결과 조회, 재실행, 로그 추적 등 운영 기능을 설명합니다.',
    icon: Workflow,
  },
]

export function DocsPage() {
  return (
    <MainLayout>
      <section className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold">문서</h1>
          <p className="mt-2 text-gray-200">SecuPipeline 사용을 위한 핵심 문서를 확인하세요.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {docs.map((item) => {
            const Icon = item.icon
            return (
              <Card key={item.title} className="p-5">
                <Icon className="h-5 w-5 text-green-300" />
                <h2 className="mt-3 text-xl font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-gray-100">{item.description}</p>
              </Card>
            )
          })}
        </div>
      </section>
    </MainLayout>
  )
}
