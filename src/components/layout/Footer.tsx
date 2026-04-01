import { Link } from 'react-router-dom'
import { GitHubIcon } from '@/components/ui/github-icon'

export function Footer() {
  return (
    <footer className="border-t border-gray-600/70 bg-gray-800/60">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-3xl font-bold text-gray-50">
              <span className="text-green-400">Secu</span>Pipeline
            </p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-gray-200">
              자체 보안 CI/CD 자동화 데스크탑 앱으로 레포지토리 보안 분석부터 파이프라인 실행 결과까지
              한 번에 관리합니다.
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
            <h4 className="font-semibold text-gray-50">문서</h4>
            <ul className="mt-3 space-y-2 text-sm text-gray-200">
              <li>
                <Link to="/docs" className="hover:text-green-300">
                  시작 가이드
                </Link>
              </li>
              <li>
                <Link to="/docs" className="hover:text-green-300">
                  API 권한 안내
                </Link>
              </li>
              <li>
                <Link to="/docs" className="hover:text-green-300">
                  보안 스캔 정책
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-gray-50">지원</h4>
            <ul className="mt-3 space-y-2 text-sm text-gray-200">
              <li>
                <Link to="/docs" className="hover:text-green-300">
                  개인정보처리방침
                </Link>
              </li>
              <li>
                <Link to="/docs" className="hover:text-green-300">
                  이용약관
                </Link>
              </li>
              <li>
                <a href="mailto:support@secupipeline.dev" className="hover:text-green-300">
                  지원 문의
                </a>
              </li>
            </ul>
          </div>
        </div>
        <hr className="my-8 border-gray-500/70" />
        <p className="text-xs text-gray-300">© 2026 SecuPipeline. All rights reserved.</p>
      </div>
    </footer>
  )
}
