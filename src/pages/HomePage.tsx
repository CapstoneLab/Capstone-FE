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
import { useLanguage } from '@/contexts/LanguageContext'

export function HomePage() {
  const { t } = useLanguage()
  const features = [
    {
      title: t('home.feature.import.title'),
      desc: t('home.feature.import.desc'),
      image:
        'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=900&q=80',
      icon: FolderOpen,
    },
    {
      title: t('home.feature.analysis.title'),
      desc: t('home.feature.analysis.desc'),
      image:
        'https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&w=900&q=80',
      icon: SearchCheck,
    },
    {
      title: t('home.feature.detect.title'),
      desc: t('home.feature.detect.desc'),
      image:
        'https://images.unsplash.com/photo-1562813733-b31f71025d54?auto=format&fit=crop&w=900&q=80',
      icon: Bug,
    },
    {
      title: t('home.feature.report.title'),
      desc: t('home.feature.report.desc'),
      image:
        'https://images.unsplash.com/photo-1551281044-8b7a6f8359f5?auto=format&fit=crop&w=900&q=80',
      icon: FileBarChart2,
    },
  ]
  const quickStats = [
    { value: '12,345', label: t('home.stats.projects'), icon: GitBranch },
    { value: '8,000+', label: t('home.stats.vulnerabilities'), icon: Bug },
    { value: '3m 47s', label: t('home.stats.averageTime'), icon: FileBarChart2 },
  ]

  return (
    <MainLayout>
      <section className="animate-[fade-up_520ms_ease-out] pt-12 text-center md:pt-20">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-green-700/70 bg-green-900/45 px-4 py-1.5 text-xs text-green-200">
          <ShieldCheck className="h-4 w-4" /> {t('home.badge')}
        </div>
        <h1 className="mt-5 text-4xl font-extrabold leading-tight md:text-6xl">
          <span className="block">{t('home.hero.line1')}</span>
          <span className="block text-green-300">{t('home.hero.line2')}</span>
        </h1>
        <div className="mt-8 flex justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="border border-[#3ECF8E] bg-[#059669] text-white shadow-none hover:bg-[#047857]"
          >
            <Link to="/auth">
              {t('common.start')} <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/docs">{t('common.docs')}</Link>
          </Button>
        </div>
        <p className="mt-5 text-sm text-gray-200">
          {t('home.subcopy')}
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
{t('home.terminal')}
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
                    {t('common.learnMore')} <ExternalLink className="h-5 w-5 text-current" />
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
          {t('home.ctaNote')}
        </p>
      </Card>
    </MainLayout>
  )
}
