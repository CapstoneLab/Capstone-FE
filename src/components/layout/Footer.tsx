import { Link } from 'react-router-dom'
import { GitHubIcon } from '@/components/ui/github-icon'
import { useLanguage } from '@/contexts/LanguageContext'

export function Footer() {
  const { t } = useLanguage()

  return (
    <footer className="app-footer relative z-20 border-t">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-3xl font-bold text-gray-50">
              <span className="text-green-400">Secu</span>Pipeline
            </p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-gray-200">
              {t('footer.description')}
            </p>
            <a
              href="https://github.com/"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-500 bg-gray-700/70 text-gray-50 hover:border-green-400 hover:text-green-300"
            >
              <GitHubIcon className="h-5 w-5" />
            </a>
          </div>

          <div>
            <h4 className="font-semibold text-gray-50">{t('footer.docs')}</h4>
            <ul className="mt-3 space-y-2 text-sm text-gray-200">
              <li>
                <Link to="/docs#getting-started" className="hover:text-green-300">
                  {t('footer.gettingStarted')}
                </Link>
              </li>
              <li>
                <Link to="/docs#usage" className="hover:text-green-300">
                  {t('footer.usage')}
                </Link>
              </li>
              <li>
                <Link to="/docs#security-checks" className="hover:text-green-300">
                  {t('footer.securityChecks')}
                </Link>
              </li>
              <li>
                <Link to="/docs#pipeline-steps" className="hover:text-green-300">
                  {t('footer.pipelineSteps')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-gray-50">{t('footer.support')}</h4>
            <ul className="mt-3 space-y-2 text-sm text-gray-200">
              <li>
                <Link to="/docs#scoring" className="hover:text-green-300">
                  {t('footer.scoring')}
                </Link>
              </li>
              <li>
                <Link to="/docs#troubleshooting" className="hover:text-green-300">
                  {t('footer.faq')}
                </Link>
              </li>
              <li>
                <Link to="/docs#architecture" className="hover:text-green-300">
                  {t('footer.architecture')}
                </Link>
              </li>
              <li>
                <a href="mailto:support@secupipeline.dev" className="hover:text-green-300">
                  {t('footer.contact')}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <hr className="my-8 border-gray-500/70" />
        <p className="text-xs text-gray-300">{t('footer.rights')}</p>
      </div>
    </footer>
  )
}
