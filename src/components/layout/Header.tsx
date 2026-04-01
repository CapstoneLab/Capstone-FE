import { Link } from 'react-router-dom'
import { GitHubIcon } from '@/components/ui/github-icon'

export function Header() {
  return (
    <header className="fixed left-0 right-0 top-9 z-40 border-b border-gray-600/75 bg-[#1E1E1E]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="text-2xl font-extrabold tracking-tight text-gray-50 md:text-3xl">
          <span className="text-green-400">Secu</span>Pipeline
        </Link>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer"
            className="grid h-9 w-9 place-items-center rounded-xl border border-gray-500 bg-gray-700/70 text-gray-50 hover:border-green-400 hover:text-green-300"
            aria-label="GitHub"
          >
            <GitHubIcon className="h-4 w-4" />
          </a>
          <img
            src="https://i.pravatar.cc/64?img=12"
            alt="프로필"
            className="h-9 w-9 rounded-full border border-gray-400/80 object-cover"
          />
        </div>
      </div>
    </header>
  )
}
