import { GitBranch, Play, Search, SquareMousePointer, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout/MainLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/contexts/AuthContext'
import { fetchReposWithBranches, getCachedRepos, setCachedRepos } from '@/lib/api'
import { getLanguageColor } from '@/lib/languageColors'
import type { RepositoryItem } from '@/data/repositories'

const vulnerabilityCheckOptions = [
  {
    id: 'sql-injection',
    title: 'SQL Injection',
    description: '사용자 입력이 쿼리에 직접 결합되어 데이터베이스 조작이 가능한지 검사합니다.',
  },
  {
    id: 'command-injection',
    title: 'Command Injection',
    description: '외부 명령 실행 구문에 악의적 입력이 주입되어 시스템 명령이 실행되는지 확인합니다.',
  },
  {
    id: 'xss',
    title: 'Cross-Site Scripting (XSS)',
    description: '검증되지 않은 스크립트가 브라우저에서 실행되어 세션 탈취 위험이 있는지 탐지합니다.',
  },
  {
    id: 'hardcoded-secret',
    title: 'Hardcoded Secret',
    description: '소스코드에 API 키, 토큰, 비밀번호 같은 민감 정보가 하드코딩되어 있는지 탐지합니다.',
  },
  {
    id: 'path-traversal',
    title: 'Path Traversal',
    description: '파일 경로 조작으로 허용되지 않은 상위 디렉터리에 접근 가능한지 점검합니다.',
  },
  {
    id: 'insecure-deserialization',
    title: 'Insecure Deserialization',
    description: '신뢰할 수 없는 직렬화 데이터 역직렬화 과정에서 원격 코드 실행 위험을 분석합니다.',
  },
] as const

export function NewPipelinePage() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const cacheKey = token ? token.slice(0, 16) : 'anonymous'
  const [search, setSearch] = useState('')
  const [repos, setRepos] = useState<RepositoryItem[]>(
    () => (token ? (getCachedRepos(cacheKey) ?? []) : []),
  )
  const [isReposLoading, setIsReposLoading] = useState(
    () => !!token && !getCachedRepos(cacheKey),
  )
  const [reposError, setReposError] = useState<string | null>(null)
  const [selectedRepoId, setSelectedRepoId] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [selectedVulnerabilityIds, setSelectedVulnerabilityIds] = useState<string[]>([
    'sql-injection',
    'command-injection',
    'hardcoded-secret',
  ])

  useEffect(() => {
    if (!token) {
      setRepos([])
      return
    }

    let mounted = true
    setReposError(null)

    fetchReposWithBranches(token)
      .then((list) => {
        if (mounted) {
          setRepos(list)
          setCachedRepos(cacheKey, list)
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setReposError(
            error instanceof Error ? error.message : '레포지토리를 불러오지 못했습니다.',
          )
        }
      })
      .finally(() => {
        if (mounted) {
          setIsReposLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [token, cacheKey])

  const filteredRepos = useMemo(() => {
    return repos.filter((repo) => {
      return `${repo.name} ${repo.description}`.toLowerCase().includes(search.toLowerCase())
    })
  }, [repos, search])

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null

  useEffect(() => {
    if (repos.length === 0) return
    if (!selectedRepoId || !repos.some((repo) => repo.id === selectedRepoId)) {
      const first = repos[0]
      setSelectedRepoId(first.id)
      setSelectedBranch(first.branches[0] ?? '')
    }
  }, [repos, selectedRepoId])

  const toggleVulnerabilityOption = (optionId: string, checked: boolean | 'indeterminate') => {
    setSelectedVulnerabilityIds((prev) => {
      if (checked) {
        return prev.includes(optionId) ? prev : [...prev, optionId]
      }
      return prev.filter((id) => id !== optionId)
    })
  }

  const selectedVulnerabilityTitles = vulnerabilityCheckOptions
    .filter((option) => selectedVulnerabilityIds.includes(option.id))
    .map((option) => option.title)

  return (
    <MainLayout>
      <section className="w-full space-y-5">
        <div>
          <h1 className="text-5xl font-extrabold text-white md:text-4xl">새 파이프라인</h1>
          <p className="mt-2 text-sm text-[#6B7280]">
            GitHub 레포지토리를 선택하고 파이프라인을 실행해보세요
          </p>
        </div>

        <Card className="border-[#404040] bg-[#262626] p-4">
          <div className="flex items-center gap-2 text-[24px] font-bold text-white">
            <SquareMousePointer className="h-6 w-6 text-[#34D399]" /> 레포지토리 선택
          </div>

          <label className="relative mt-4 block">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#6B7280]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="레포지토리 검색..."
              className="pl-10"
            />
          </label>

          {isReposLoading && repos.length === 0 ? (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-16 animate-pulse rounded-lg border border-[#2F2F2F] bg-[#1E1E1E]"
                />
              ))}
            </div>
          ) : reposError ? (
            <p className="mt-4 rounded-lg border border-[#404040] bg-[#1E1E1E] p-4 text-center text-sm text-[#FCA5A5]">
              {reposError}
            </p>
          ) : filteredRepos.length === 0 ? (
            <p className="mt-4 rounded-lg border border-[#404040] bg-[#1E1E1E] p-4 text-center text-sm text-[#9CA3AF]">
              표시할 레포지토리가 없습니다.
            </p>
          ) : (
          <RadioGroup
            className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-2"
            value={selectedRepoId}
            onValueChange={(value) => {
              setSelectedRepoId(value)
              const nextRepo = repos.find((repo) => repo.id === value)
              if (nextRepo?.branches[0]) {
                setSelectedBranch(nextRepo.branches[0])
              }
            }}
          >
            {filteredRepos.map((repo) => (
              <label
                key={repo.id}
                htmlFor={`repo-${repo.id}`}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-3 hover:bg-white/3"
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem id={`repo-${repo.id}`} value={repo.id} />

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[18px] font-bold text-white">{repo.name}</p>
                      <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">
                        {repo.visibility}
                      </Badge>
                      <span className="inline-flex items-center gap-2 text-[12px] text-[#6B7280]">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: getLanguageColor(repo.language) }}
                        />
                        {repo.language}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-[#6B7280]">{repo.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[12px] text-[#6B7280]">
                  <span className="inline-flex items-center gap-1">
                    <GitBranch className="h-3.5 w-3.5" /> {repo.branches.length}개
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5" /> {repo.stars}
                  </span>
                </div>
              </label>
            ))}
          </RadioGroup>
          )}
        </Card>

        {selectedRepo ? (
          <Card className="border-[#404040] bg-[#262626] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[18px] font-bold text-white">{selectedRepo.name}</p>
                  <Badge className="border-white/15 bg-[#3A3A3A] text-[#9CA3AF]">
                    {selectedRepo.visibility}
                  </Badge>
                </div>
                <p className="mt-2 text-[12px] text-[#6B7280]">{selectedRepo.description}</p>
              </div>

              <div className="w-full md:w-52">
                <p className="inline-flex items-center gap-1 text-[12px] text-[#6B7280]">
                  <GitBranch className="h-4 w-4" /> 실행 브랜치
                </p>
                <div className="mt-2">
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger>
                      <SelectValue placeholder="브랜치 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedRepo.branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <hr className="my-4 border-[#404040]" />

            <div className="space-y-3">
              <div className="rounded-lg border border-[#404040] bg-[#1E1E1E] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-[#D1D5DB]">취약점 검사 항목 선택</p>
                  <p className="text-[12px] text-[#6B7280]">{selectedVulnerabilityIds.length}개 선택</p>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {vulnerabilityCheckOptions.map((option) => (
                    <label
                      key={option.id}
                      htmlFor={option.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-[#2F2F2F] bg-[#171717] p-2.5 hover:border-[#3ECF8E]/50"
                    >
                      <Checkbox
                        id={option.id}
                        checked={selectedVulnerabilityIds.includes(option.id)}
                        onCheckedChange={(checked) => toggleVulnerabilityOption(option.id, checked)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-[13px] font-semibold text-[#E5E7EB]">{option.title}</p>
                        <p className="mt-1 text-[12px] leading-5 text-[#9CA3AF]">{option.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            취소
          </Button>
          <Button
            onClick={() =>
              navigate('/pipeline/progress', {
                state: {
                  repoName: selectedRepo?.name ?? 'myuser/web-app',
                  branch: selectedBranch,
                  selectedChecks: selectedVulnerabilityTitles,
                },
              })
            }
            className="bg-[#34D399] text-[#0B1B14] shadow-none hover:bg-[#28C48A]"
            disabled={!selectedRepo}
          >
            <Play className="mr-1 h-4 w-4" /> 파이프라인 실행
          </Button>
        </div>
      </section>
    </MainLayout>
  )
}
