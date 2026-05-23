import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  CircleHelp,
  CodeXml,
  FileText,
  GitBranch,
  Hammer,
  Key,
  Layers,
  Lock,
  Network,
  Package,
  Play,
  Rocket,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { useLocation } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Card } from '@/components/ui/card'

type Section = {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
}

const sections: Section[] = [
  { id: 'intro', title: '소개', icon: FileText },
  { id: 'getting-started', title: '시작하기', icon: Play },
  { id: 'usage', title: '사용 가이드', icon: Layers },
  { id: 'security-checks', title: '보안 검사 항목', icon: Shield },
  { id: 'pipeline-steps', title: '파이프라인 단계', icon: Workflow },
  { id: 'scoring', title: '보안 점수 & 등급', icon: ShieldCheck },
  { id: 'troubleshooting', title: '자주 묻는 질문', icon: CircleHelp },
  { id: 'architecture', title: '아키텍처', icon: Network },
]

// Workflow icon shim (not in our import list)
function Workflow({ className }: { className?: string }) {
  return <Layers className={className} />
}

const vulnerabilityDocs = [
  {
    id: 'sql-injection',
    title: 'SQL Injection',
    icon: Bug,
    severity: 'critical' as const,
    summary: '사용자 입력이 SQL 쿼리에 직접 결합되어 데이터베이스가 조작당하는 취약점입니다.',
    risk: '인증 우회, 데이터 유출, 데이터 변조/삭제',
    example: `// 취약 코드
const user = db.query("SELECT * FROM users WHERE id = " + req.body.id)

// 안전 코드
const user = db.query("SELECT * FROM users WHERE id = ?", [req.body.id])`,
    mitigation: '파라미터 바인딩(Prepared Statement) 사용, ORM/쿼리 빌더 활용, 입력값 화이트리스트 검증',
  },
  {
    id: 'command-injection',
    title: 'Command Injection',
    icon: Terminal,
    severity: 'critical' as const,
    summary: '외부 명령 실행 함수에 검증되지 않은 입력이 들어가 시스템 명령이 실행되는 취약점입니다.',
    risk: '서버 장악, 임의 명령 실행, 데이터 탈취',
    example: `// 취약 코드
exec("ping " + req.query.host)

// 안전 코드
execFile("ping", [req.query.host])`,
    mitigation: 'shell=false 옵션 사용, 인자 배열 형태로 전달, 입력값을 명령어와 분리',
  },
  {
    id: 'xss',
    title: 'Cross-Site Scripting (XSS)',
    icon: CodeXml,
    severity: 'high' as const,
    summary: '검증되지 않은 사용자 입력이 브라우저에서 스크립트로 실행되는 취약점입니다.',
    risk: '세션 탈취, 피싱 사이트 유도, 키로깅, CSRF 토큰 우회',
    example: `// 취약 코드
element.innerHTML = userComment

// 안전 코드
element.textContent = userComment
// 또는 DOMPurify.sanitize(userComment)`,
    mitigation: 'innerHTML 대신 textContent 사용, 출력 인코딩, CSP 헤더 적용, 신뢰 가능한 HTML sanitizer 사용',
  },
  {
    id: 'hardcoded-secret',
    title: 'Hardcoded Secret',
    icon: Key,
    severity: 'high' as const,
    summary: 'API 키, 토큰, DB 비밀번호 같은 민감 정보가 소스코드에 그대로 박혀있는 경우입니다.',
    risk: '저장소 공개 시 즉시 자격증명 유출, 키 회전 비용 발생, 권한 남용',
    example: `// 취약 코드
const API_KEY = "sk_live_abc123def456"

// 안전 코드
const API_KEY = process.env.API_KEY`,
    mitigation: '환경 변수 / 시크릿 매니저 사용 (Vault, AWS Secrets Manager 등), .env 파일은 .gitignore 처리, 이미 노출된 키는 즉시 회전',
  },
  {
    id: 'path-traversal',
    title: 'Path Traversal',
    icon: Lock,
    severity: 'high' as const,
    summary: '파일 경로 입력에 `../` 같은 조작이 들어가 허용되지 않은 상위 디렉터리에 접근하는 취약점입니다.',
    risk: '시스템 파일 노출 (/etc/passwd 등), 소스코드 유출, 임의 파일 쓰기',
    example: `// 취약 코드
fs.readFile("./uploads/" + req.query.file)
// → ?file=../../etc/passwd

// 안전 코드
const safe = path.basename(req.query.file)
fs.readFile(path.join("./uploads/", safe))`,
    mitigation: 'path.basename() 으로 경로 분리 차단, 절대 경로 정규화 후 허용 디렉터리 prefix 검증, 화이트리스트 사용',
  },
  {
    id: 'insecure-deserialization',
    title: 'Insecure Deserialization',
    icon: ShieldAlert,
    severity: 'critical' as const,
    summary: '신뢰할 수 없는 직렬화 데이터를 역직렬화하면서 원격 코드 실행이나 객체 주입이 일어나는 취약점입니다.',
    risk: '원격 코드 실행(RCE), 권한 상승, 인증 우회',
    example: `# 취약 코드 (Python)
import pickle
data = pickle.loads(request.body)

# 안전 코드
import json
data = json.loads(request.body)`,
    mitigation: 'pickle 같은 임의 객체 직렬화 포맷 대신 JSON/Protobuf 사용, 신뢰 영역 외부의 데이터는 서명/검증 후 역직렬화',
  },
]

const pipelineSteps = [
  {
    id: 'clone',
    name: '레포지토리 클론',
    icon: GitBranch,
    description: '선택한 GitHub 레포지토리의 지정 브랜치를 우분투 러너에 클론합니다.',
    duration: '평균 5~15초',
  },
  {
    id: 'install',
    name: '의존성 설치',
    icon: Package,
    description: '`package.json`, `requirements.txt`, `pom.xml` 등을 감지해 의존성을 설치합니다.',
    duration: '평균 30초~2분',
  },
  {
    id: 'security-light',
    name: '경량 보안 검사',
    icon: Shield,
    description: 'Secret 스캔(gitleaks), 의존성 취약점(SCA), 라이선스 검사 등 빠르게 끝나는 검사를 먼저 수행합니다.',
    duration: '평균 20~40초',
  },
  {
    id: 'test',
    name: '테스트',
    icon: CheckCircle2,
    description: '프로젝트에 정의된 테스트(`npm test`, `pytest` 등)를 실행합니다.',
    duration: '프로젝트 의존',
  },
  {
    id: 'security-deep',
    name: '심화 보안 검사',
    icon: ShieldAlert,
    description: 'Semgrep 기반 SAST(정적 분석)를 수행합니다. 선택한 취약점 항목별 규칙셋만 적용되어 검사 범위가 결정됩니다.',
    duration: '평균 1~5분',
  },
  {
    id: 'build',
    name: '빌드',
    icon: Hammer,
    description: '프로덕션 빌드를 수행하고 산출물을 생성합니다 (`npm run build`, `docker build` 등).',
    duration: '평균 30초~3분',
  },
  {
    id: 'deploy',
    name: '배포',
    icon: Rocket,
    description: '배포 정책이 설정된 경우 산출물을 대상 환경으로 배포합니다. (선택)',
    duration: '평균 10~60초',
  },
]

const faqs = [
  {
    q: 'GitHub 토큰이 만료됐다는 메시지가 떠요',
    a: '백엔드 캐시에서 GitHub 액세스 토큰을 찾지 못한 경우입니다. SecuPipeline은 자동으로 로그인 페이지로 이동시키며, "GitHub로 계속하기" 버튼을 다시 누르면 즉시 복구됩니다.',
  },
  {
    q: '"이미 실행 중인 파이프라인이 있어요" 다이얼로그가 떴어요',
    a: '같은 레포/브랜치에 대해 파이프라인이 이미 돌고 있을 때 표시됩니다. "취소하고 새로 실행"을 누르면 기존 작업을 종료한 뒤 새 파이프라인이 시작됩니다.',
  },
  {
    q: '진행 중 파이프라인을 어떻게 멈추나요?',
    a: '파이프라인 진행 페이지 우측 하단의 "파이프라인 취소" 버튼을 누르면 즉시 종료됩니다. 이미 성공/실패/취소 상태로 끝난 작업은 취소할 수 없습니다.',
  },
  {
    q: '검사 항목을 매번 다시 선택해야 하나요?',
    a: '레포의 첫 실행에서는 모든 항목이 자동으로 실행됩니다. 이후 실행부터 원하는 항목만 선택할 수 있어요.',
  },
  {
    q: '보안 점수는 어떻게 계산되나요?',
    a: '100점에서 시작해 발견된 취약점 등급에 따라 감점합니다. 자세한 식은 "보안 점수 & 등급" 섹션을 참고하세요.',
  },
  {
    q: '파이프라인 결과 데이터는 어디에 저장되나요?',
    a: '백엔드 DB와 우분투 러너의 결과 JSON 파일에 저장됩니다. 대시보드에서 job을 삭제하면 두 곳 모두 cascade로 정리됩니다.',
  },
  {
    q: '왜 macOS/Linux 빌드는 없나요?',
    a: '현재는 Windows 데스크톱 앱(Electron) 전용입니다. 향후 Cross-platform 확장 계획에 포함되어 있습니다.',
  },
]

function SeverityBadge({ severity }: { severity: 'critical' | 'high' }) {
  const map = {
    critical: { label: 'Critical', color: '#EF4444', bg: '#450A0A' },
    high: { label: 'High', color: '#F59E0B', bg: '#451A03' },
  }
  const cfg = map[severity]
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ color: cfg.color, borderColor: cfg.color, backgroundColor: `${cfg.bg}80` }}
    >
      {cfg.label}
    </span>
  )
}

export function DocsPage() {
  const [activeId, setActiveId] = useState<string>('intro')
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return
    const id = hash.replace(/^#/, '')
    const target = document.getElementById(id)
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setActiveId(id)
      })
    }
  }, [hash])

  useEffect(() => {
    const triggerOffset = 140 // 헤더 + 여유 공간만큼 아래의 가상 라인
    let frame = 0

    function update() {
      let current = sections[0].id
      for (const { id } of sections) {
        const el = document.getElementById(id)
        if (!el) continue
        // getBoundingClientRect는 viewport 기준 — 어떤 스크롤 컨테이너든 동일하게 동작
        const top = el.getBoundingClientRect().top
        if (top - triggerOffset <= 0) {
          current = id
        } else {
          break
        }
      }
      setActiveId(current)
    }

    function onScroll() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }

    update()
    // scroll 이벤트는 bubble 하지 않지만 capture는 되므로,
    // document 에 capture 단계 리스너를 달면 어떤 스크롤 컨테이너든 모두 잡힌다.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <MainLayout>
      <section className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold text-white">문서</h1>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            SecuPipeline 사용 방법, 보안 검사 항목, 파이프라인 구조까지 한 페이지에서 확인하세요.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <nav className="space-y-1 rounded-xl border border-[#404040] bg-[#262626] p-2">
              {sections.map(({ id, title, icon: Icon }) => {
                const isActive = activeId === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => scrollTo(id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? 'bg-[#34D399]/10 text-[#34D399]'
                        : 'text-[#D1D5DB] hover:bg-[#1F1F1F]'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{title}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="space-y-12">
            <DocSection id="intro" title="소개" icon={FileText}>
              <p>
                <strong className="text-white">SecuPipeline</strong> 은 GitHub 레포지토리를 대상으로
                <span className="text-[#34D399]"> 보안 중심 CI/CD 파이프라인</span>을 실행하고 결과를
                한눈에 시각화하는 데스크톱 도구입니다. 한 번의 클릭으로 의존성 검사부터 SAST, 빌드,
                배포까지 7단계를 자동 수행하며, 발견된 취약점은 위험도별로 점수화되어 보고됩니다.
              </p>
              <ul className="mt-3 list-inside list-disc space-y-1.5 text-[#D1D5DB]">
                <li>GitHub OAuth 한 번으로 내 모든 레포지토리 연결</li>
                <li>6종의 핵심 보안 검사 항목을 선택 실행</li>
                <li>실시간 단계별 진행률 + 로그 스트리밍</li>
                <li>취약점 등급별 점수화 (0~100점) + 종합 판정 (passed/warning/failed)</li>
                <li>실행 이력 추적 및 재실행/삭제 지원</li>
              </ul>
            </DocSection>

            <DocSection id="getting-started" title="시작하기" icon={Play}>
              <ol className="space-y-4 text-[#D1D5DB]">
                <li>
                  <p className="font-semibold text-white">1. GitHub 로그인</p>
                  <p className="mt-1 text-sm">
                    로그인 화면에서 <strong>GitHub로 계속하기</strong>를 누르면 GitHub OAuth 창이
                    열립니다. 다음 권한이 요청됩니다:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 pl-1 text-sm text-[#9CA3AF]">
                    <li>프로필 정보 읽기</li>
                    <li>Repository 목록 읽기 (Public/Private)</li>
                    <li>코드 읽기 전용 접근 (수정 권한 없음)</li>
                    <li>Repository push 이벤트 감지</li>
                  </ul>
                </li>
                <li>
                  <p className="font-semibold text-white">2. 새 파이프라인 생성</p>
                  <p className="mt-1 text-sm">
                    좌측 상단 <strong>+ 새 파이프라인</strong> 메뉴 → 레포 검색 → 브랜치 선택 →
                    검사할 취약점 항목 선택 → <strong>파이프라인 실행</strong>.
                  </p>
                </li>
                <li>
                  <p className="font-semibold text-white">3. 진행 상황 확인</p>
                  <p className="mt-1 text-sm">
                    실행 후 자동으로 진행 페이지로 이동합니다. 단계별 상태와 실시간 로그를 확인할 수
                    있고, 종료되면 <strong>보안 분석 결과</strong> 버튼이 활성화됩니다.
                  </p>
                </li>
                <li>
                  <p className="font-semibold text-white">4. 결과 검토 & 이력 관리</p>
                  <p className="mt-1 text-sm">
                    대시보드에서 모든 실행 이력을 확인하고, 필요한 경우 재실행하거나 삭제할 수
                    있습니다.
                  </p>
                </li>
              </ol>
            </DocSection>

            <DocSection id="usage" title="사용 가이드" icon={Layers}>
              <div className="space-y-5">
                <SubSection title="파이프라인 시작하기">
                  <p>
                    새 파이프라인 페이지에서 레포를 선택하면 우측에 브랜치 드롭다운과 취약점 항목
                    리스트가 나타납니다. <strong>처음 실행하는 레포</strong>는 모든 항목이 자동으로
                    포함되며, 두 번째 실행부터는 원하는 항목만 골라 실행할 수 있어요.
                  </p>
                </SubSection>

                <SubSection title="진행 중 모니터링">
                  <p>
                    파이프라인은 2초 간격으로 백엔드를 폴링해 단계별 상태와 로그를 갱신합니다.
                    상단에는 종합 상태(<span className="text-[#F59E0B]">실행 중</span>{' '}
                    <span className="text-[#3ECF8E]">성공</span>{' '}
                    <span className="text-[#EF4444]">실패</span>{' '}
                    <span className="text-[#6B7280]">취소됨</span>)와 누적 실행 시간이 표시됩니다.
                  </p>
                </SubSection>

                <SubSection title="취소">
                  <p>
                    진행 중인 파이프라인은 우측 하단의 <strong>파이프라인 취소</strong> 버튼으로 즉시
                    종료할 수 있습니다. 내부적으로 우분투 러너에 SSH 접속해{' '}
                    <code className="rounded bg-[#1F1F1F] px-1.5 py-0.5 text-xs text-[#34D399]">
                      pkill -9 -f {'{job_id}'}
                    </code>{' '}
                    를 실행합니다. 이미 종료된 파이프라인은 취소할 수 없습니다.
                  </p>
                </SubSection>

                <SubSection title="삭제">
                  <p>
                    완전 삭제 시 DB의 job/steps/findings/summary 레코드와 우분투의 결과 JSON 파일이
                    모두 cascade로 제거됩니다. 진행 중이라면 자동으로 종료 후 삭제됩니다.
                  </p>
                </SubSection>

                <SubSection title="중복 실행 방지">
                  <p>
                    동일한 레포+브랜치 조합으로 이미 실행 중인 파이프라인이 있으면 새 실행을
                    거부합니다. 다이얼로그에서 <strong>"취소하고 새로 실행"</strong>을 선택하면
                    기존 작업을 종료하고 새로 시작합니다.
                  </p>
                </SubSection>
              </div>
            </DocSection>

            <DocSection id="security-checks" title="보안 검사 항목" icon={Shield}>
              <p className="text-sm text-[#9CA3AF]">
                현재 6종의 핵심 취약점을 검사합니다. 각 항목은 독립적으로 선택/해제할 수 있고,
                결과는 등급별(critical/high/medium/low)로 집계됩니다.
              </p>
              <div className="mt-4 space-y-4">
                {vulnerabilityDocs.map((vuln) => {
                  const Icon = vuln.icon
                  return (
                    <div
                      key={vuln.id}
                      className="rounded-xl border border-[#404040] bg-[#1F1F1F] p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-[#262626] p-2">
                          <Icon className="h-5 w-5 text-[#34D399]" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">{vuln.title}</h3>
                        <SeverityBadge severity={vuln.severity} />
                      </div>
                      <p className="mt-3 text-sm text-[#D1D5DB]">{vuln.summary}</p>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <DocFieldBox label="위험" icon={AlertTriangle}>
                          {vuln.risk}
                        </DocFieldBox>
                        <DocFieldBox label="대응" icon={CheckCircle2}>
                          {vuln.mitigation}
                        </DocFieldBox>
                      </div>

                      <details className="mt-3 rounded-lg border border-[#2F2F2F] bg-[#0F0F0F]">
                        <summary className="cursor-pointer px-3 py-2 text-xs text-[#9CA3AF] hover:text-[#34D399]">
                          코드 예시 보기
                        </summary>
                        <pre className="overflow-x-auto px-3 pb-3 text-xs leading-5 text-[#D1D5DB]">
                          <code>{vuln.example}</code>
                        </pre>
                      </details>
                    </div>
                  )
                })}
              </div>
            </DocSection>

            <DocSection id="pipeline-steps" title="파이프라인 단계" icon={Zap}>
              <p className="text-sm text-[#9CA3AF]">
                모든 파이프라인은 다음 7단계를 순서대로 실행합니다. 한 단계가 실패하면 이후 단계는
                건너뛸 수 있습니다.
              </p>
              <ol className="mt-4 space-y-3">
                {pipelineSteps.map((step, idx) => {
                  const Icon = step.icon
                  return (
                    <li
                      key={step.id}
                      className="flex gap-3 rounded-xl border border-[#404040] bg-[#1F1F1F] p-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#262626] text-sm font-bold text-[#34D399]">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-[#6B7280]" />
                          <p className="font-semibold text-white">{step.name}</p>
                          <span className="text-xs text-[#6B7280]">· {step.duration}</span>
                        </div>
                        <p className="mt-1 text-sm text-[#D1D5DB]">{step.description}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </DocSection>

            <DocSection id="scoring" title="보안 점수 & 등급" icon={ShieldCheck}>
              <SubSection title="점수 산정식">
                <p>
                  보안 점수는 <strong>100점에서 감점</strong>하는 방식으로 계산됩니다. 발견된
                  취약점의 등급별 가중치를 합산해 차감하며, 0점 미만으로는 떨어지지 않습니다.
                </p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-[#2F2F2F] bg-[#0F0F0F] p-3 text-xs leading-5 text-[#34D399]">
{`점수 = max(0, min(100, 100 - (
  critical × 15
  + high × 5
  + medium × 2
  + low × 0.5
)))`}
                </pre>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ScoreWeightCard label="Critical" weight="-15점" color="#EF4444" />
                  <ScoreWeightCard label="High" weight="-5점" color="#F59E0B" />
                  <ScoreWeightCard label="Medium" weight="-2점" color="#FACC15" />
                  <ScoreWeightCard label="Low" weight="-0.5점" color="#9CA3AF" />
                </div>
              </SubSection>

              <SubSection title="종합 판정 (Verdict)">
                <p>점수와 별개로 백엔드는 다음 3단계 종합 판정을 함께 부여합니다.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <VerdictCard
                    label="Passed"
                    color="#3ECF8E"
                    icon={CheckCircle2}
                    description="배포 가능. critical/high 없음."
                  />
                  <VerdictCard
                    label="Warning"
                    color="#F59E0B"
                    icon={AlertTriangle}
                    description="배포 가능하나 후속 조치 필요."
                  />
                  <VerdictCard
                    label="Failed"
                    color="#EF4444"
                    icon={XCircle}
                    description="배포 차단 권고. critical 존재 가능."
                  />
                </div>
              </SubSection>
            </DocSection>

            <DocSection id="troubleshooting" title="자주 묻는 질문" icon={CircleHelp}>
              <div className="space-y-3">
                {faqs.map((faq, idx) => (
                  <details
                    key={idx}
                    className="rounded-xl border border-[#404040] bg-[#1F1F1F] p-4 open:bg-[#1F1F1F]"
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-white hover:text-[#34D399]">
                      Q. {faq.q}
                    </summary>
                    <p className="mt-3 text-sm leading-6 text-[#D1D5DB]">A. {faq.a}</p>
                  </details>
                ))}
              </div>
            </DocSection>

            <DocSection id="architecture" title="아키텍처" icon={Network}>
              <p>
                SecuPipeline은 <strong>3티어 구조</strong>로 동작합니다. 프론트엔드는 백엔드 API만
                호출하며, 실제 검사 실행은 우분투 러너가 담당합니다.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-[#2F2F2F] bg-[#0F0F0F] p-4 text-xs leading-6 text-[#D1D5DB]">
{`┌─────────────────────┐   HTTPS    ┌────────────────────┐   HTTP/SSH   ┌──────────────────┐
│  Frontend (Electron)│ ─────────► │  Backend API Server│ ───────────► │  Ubuntu Runner   │
│  - React + Vite     │            │  - 인증/권한       │              │  - 검사 실행     │
│  - 2초 폴링         │            │  - DB 저장/조회   │              │  - 로그 생성     │
│  - 실시간 UI        │ ◄───────── │  - 응답 가공       │ ◄─────────── │  - 결과 JSON     │
└─────────────────────┘            └────────────────────┘              └──────────────────┘`}
              </pre>
              <div className="mt-4 space-y-3">
                <ArchPill
                  title="Frontend"
                  desc="Electron + React + Vite. localStorage 토큰 보관. 모든 API 요청은 /api-proxy 경유."
                />
                <ArchPill
                  title="Backend"
                  desc="REST API 8종 노출 (/api/repos, /api/pipelines, /api/jobs/{id} 등). DB에 job/steps/findings 저장."
                />
                <ArchPill
                  title="Ubuntu Runner"
                  desc="실제 git clone, 의존성 설치, 스캐너 실행을 수행. SSH로만 접근하며 외부 노출 금지."
                />
              </div>
              <p className="mt-4 text-xs text-[#6B7280]">
                전체 API 명세는 <code className="rounded bg-[#1F1F1F] px-1.5 py-0.5 text-[#34D399]">docs/backend-api-spec.md</code> 참고.
              </p>
            </DocSection>
          </div>
        </div>
      </section>
    </MainLayout>
  )
}

function DocSection({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="border-[#404040] bg-[#262626] p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-[#34D399]/10 p-2">
            <Icon className="h-5 w-5 text-[#34D399]" />
          </div>
          <h2 className="text-2xl font-bold text-white">{title}</h2>
        </div>
        <div className="text-sm leading-7 text-[#D1D5DB]">{children}</div>
      </Card>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold text-white">{title}</h3>
      <div className="text-sm leading-7 text-[#D1D5DB]">{children}</div>
    </div>
  )
}

function DocFieldBox({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[#2F2F2F] bg-[#0F0F0F] p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#9CA3AF]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-xs leading-5 text-[#D1D5DB]">{children}</p>
    </div>
  )
}

function ScoreWeightCard({
  label,
  weight,
  color,
}: {
  label: string
  weight: string
  color: string
}) {
  return (
    <div
      className="rounded-lg border bg-[#0F0F0F] px-3 py-2 text-center"
      style={{ borderColor: `${color}40` }}
    >
      <p className="text-xs" style={{ color }}>
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-white">{weight}</p>
    </div>
  )
}

function VerdictCard({
  label,
  color,
  icon: Icon,
  description,
}: {
  label: string
  color: string
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>
  description: string
}) {
  return (
    <div
      className="rounded-lg border bg-[#0F0F0F] p-3"
      style={{ borderColor: `${color}60` }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color }} />
        <p className="font-semibold" style={{ color }}>
          {label}
        </p>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#D1D5DB]">{description}</p>
    </div>
  )
}

function ArchPill({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-[#2F2F2F] bg-[#0F0F0F] p-3">
      <p className="text-sm font-semibold text-[#34D399]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[#D1D5DB]">{desc}</p>
    </div>
  )
}
