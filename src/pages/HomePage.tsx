import { useEffect, useMemo } from 'react'
import {
  ArrowRight,
  Bug,
  FileBarChart2,
  FolderOpen,
  GitBranch,
  Layers3,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import DecryptedText from '@/components/visual/DecryptedText'
import ShapeGrid from '@/components/visual/ShapeGrid'
import { useLanguage } from '@/contexts/LanguageContext'
import { useTheme } from '@/contexts/ThemeContext'

export function HomePage() {
  const { t, locale } = useLanguage()
  const { resolvedTheme } = useTheme()
  const isKo = locale === 'ko'
  const headline = `${t('home.hero.line1')}\n${t('home.hero.line2')}`
  const shapeGrid = resolvedTheme === 'dark'
    ? {
        borderColor: 'rgba(56, 189, 248, 0.22)',
        hoverFillColor: 'rgba(52, 211, 153, 0.15)',
        layerClass: 'home-shape-grid-layer--dark',
      }
    : {
        borderColor: 'rgba(6, 95, 70, 0.13)',
        hoverFillColor: 'rgba(45, 212, 191, 0.16)',
        layerClass: 'home-shape-grid-layer--light',
      }

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.scroll-reveal'))
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.16, rootMargin: '0px 0px -8% 0px' },
    )

    items.forEach((item) => observer.observe(item))

    return () => observer.disconnect()
  }, [])

  const copy = useMemo(
    () => ({
      eyebrow: isKo ? 'Secure CI/CD Desktop' : 'Secure CI/CD Desktop',
      scanLabel: isKo ? '실시간 보안 게이트' : 'Live Security Gate',
      flowTitle: isKo ? 'Repository부터 리포트까지, 한 화면씩 진행합니다' : 'From repository to report, one clear step at a time',
      flowDesc: isKo
        ? '가져오기, 분석, 취약점 탐지, 결과 리포트를 분리된 섹션으로 보여주어 처음 쓰는 사람도 흐름을 바로 이해할 수 있습니다.'
        : 'Import, analyze, detect, and report are separated into focused sections so the workflow stays easy to follow.',
      insightTitle: isKo ? '보안 결과를 바로 판단할 수 있게' : 'Security decisions at a glance',
      insightDesc: isKo
        ? '검사 로그와 핵심 지표를 함께 보여주고, 치명도에 따라 배포 가능 여부를 즉시 판단합니다.'
        : 'Scan logs and key metrics live together, with deployment decisions surfaced by severity.',
    }),
    [isKo],
  )
  const features = [
    {
      title: t('home.feature.import.title'),
      desc: t('home.feature.import.desc'),
      image:
        'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1100&q=80',
      icon: FolderOpen,
      tone: 'text-[#22D3EE]',
    },
    {
      title: t('home.feature.analysis.title'),
      desc: t('home.feature.analysis.desc'),
      image:
        'https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&w=1100&q=80',
      icon: SearchCheck,
      tone: 'text-[#34D399]',
    },
    {
      title: t('home.feature.detect.title'),
      desc: t('home.feature.detect.desc'),
      image:
        'https://images.unsplash.com/photo-1562813733-b31f71025d54?auto=format&fit=crop&w=1100&q=80',
      icon: Bug,
      tone: 'text-[#F59E0B]',
    },
    {
      title: t('home.feature.report.title'),
      desc: t('home.feature.report.desc'),
      image:
        'https://images.unsplash.com/photo-1551281044-8b7a6f8359f5?auto=format&fit=crop&w=1100&q=80',
      icon: FileBarChart2,
      tone: 'text-[#A78BFA]',
    },
  ]
  const quickStats = [
    { value: '12,345', label: t('home.stats.projects'), icon: GitBranch },
    { value: '8,000+', label: t('home.stats.vulnerabilities'), icon: Bug },
    { value: '3m 47s', label: t('home.stats.averageTime'), icon: FileBarChart2 },
  ]
  const scanRows = [
    ['Install', 'Dependencies installed successfully', 'ok'],
    ['Test', '143 tests passed, 0 failed', 'ok'],
    ['Build', 'Production build compiled', 'ok'],
    ['Security scan', '3 vulnerabilities found (1 critical)', 'warn'],
    ['Security Gate', 'Deploy blocked until critical issues are fixed', 'block'],
  ] as const

  return (
    <MainLayout>
      <section className="home-section home-hero-section relative flex min-h-[calc(100vh-36px)] flex-col justify-center overflow-hidden px-6 py-16">
        <div className={`home-shape-grid-layer pointer-events-none absolute inset-0 ${shapeGrid.layerClass}`} aria-hidden="true">
          <ShapeGrid
            speed={0.38}
            squareSize={44}
            direction="diagonal"
            borderColor={shapeGrid.borderColor}
            hoverFillColor={shapeGrid.hoverFillColor}
            shape="square"
            hoverTrailAmount={0}
          />
        </div>
        <div className="home-hero-fade-block pointer-events-none absolute inset-x-0 bottom-0" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-10 text-center">
          <div className="flex w-full max-w-6xl flex-col items-center">
            <div className="home-chip inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-sm">
              <ShieldCheck className="h-4 w-4" />
              {copy.eyebrow}
            </div>
            <h1 className="home-text-primary mt-6 min-h-[174px] max-w-6xl text-center text-5xl font-extrabold leading-[1.08] md:min-h-[180px] md:text-7xl">
              <DecryptedText
                text={headline}
                speed={70}
                maxIterations={16}
                sequential
                revealDirection="start"
                characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
                animateOn="view"
                className="home-decrypted-text"
                encryptedClassName="home-decrypted-text--encrypted"
                parentClassName="home-hero-decrypted"
              />
            </h1>
            <p className="home-text-secondary mt-6 max-w-2xl text-base leading-7 md:text-lg">
              {t('home.subcopy')}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="border border-[#34D399] bg-[#34D399] text-[#04130d] shadow-[0_18px_40px_rgba(52,211,153,0.22)] hover:bg-[#6EE7B7]"
              >
                <Link to="/auth">
                  {t('common.start')} <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="home-secondary-button">
                <Link to="/docs">{t('common.docs')}</Link>
              </Button>
            </div>
          </div>

          <Card className="home-card scroll-reveal w-full max-w-6xl overflow-hidden shadow-xl shadow-gray-900/10">
            <div className="home-card-header flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#F87171]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FBBF24]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#34D399]" />
              </div>
              <span className="font-mono text-xs text-[#047857]">secupipeline / secure-ci</span>
            </div>
            <div className="home-terminal-body overflow-x-auto p-6 font-mono text-sm">
              <div className="min-w-[760px] space-y-3 text-left">
              {scanRows.map(([step, message, state]) => (
                <div key={step} className="home-terminal-row flex items-start gap-4 whitespace-nowrap">
                  <span className={state === 'ok' ? 'text-[#34D399]' : state === 'warn' ? 'text-[#FBBF24]' : 'text-[#FB7185]'}>
                    {state === 'ok' ? 'OK' : state === 'warn' ? '!' : 'X'}
                  </span>
                  <span className="home-terminal-step w-32 shrink-0">{step}</span>
                  <span className="home-terminal-message">{message}</span>
                </div>
              ))}
              <div className="home-terminal-step pt-5">Pipeline finished in 3m 25s</div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="home-section flex min-h-[calc(100vh-36px)] flex-col justify-center px-6 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
          <div className="scroll-reveal max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#047857]">{copy.scanLabel}</p>
            <h2 className="home-text-primary mt-4 text-4xl font-extrabold leading-tight md:text-6xl">{copy.insightTitle}</h2>
            <p className="home-text-secondary mt-5 max-w-xl text-base leading-8">{copy.insightDesc}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {quickStats.map((item, index) => (
              <Card
                key={item.label}
                className="home-card scroll-reveal p-5 text-center shadow-sm"
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#047857]">
                  <item.icon className="h-6 w-6" />
                </div>
                <p className="home-text-primary text-4xl font-extrabold">{item.value}</p>
                <p className="home-text-secondary mt-2 text-sm">{item.label}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section flex min-h-[calc(100vh-36px)] flex-col justify-center px-6 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-9">
          <div className="scroll-reveal max-w-3xl">
            <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[#22D3EE]">
              <Layers3 className="h-4 w-4" />
              Workflow
            </p>
            <h2 className="home-text-primary mt-4 text-4xl font-extrabold leading-tight md:text-6xl">{copy.flowTitle}</h2>
            <p className="home-text-secondary mt-5 text-base leading-8">{copy.flowDesc}</p>
          </div>
          <div className="mt-9 grid gap-4 lg:grid-cols-4">
            {features.map((item, index) => {
              const Icon = item.icon
              return (
                <Card
                  key={item.title}
                  className="home-card scroll-reveal overflow-hidden shadow-sm"
                  style={{ transitionDelay: `${index * 80}ms` }}
                >
                  <img src={item.image} alt={item.title} className="h-36 w-full object-cover" />
                  <div className="p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <Icon className={`h-7 w-7 ${item.tone}`} />
                      <span className="font-mono text-xs text-[#9CA3AF]">0{index + 1}</span>
                    </div>
                    <h3 className="home-text-primary text-xl font-bold">{item.title}</h3>
                    <p className="home-text-secondary mt-3 text-sm leading-6">{item.desc}</p>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      </section>

    </MainLayout>
  )
}
