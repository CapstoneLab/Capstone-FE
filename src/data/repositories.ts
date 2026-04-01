export type PipelineStatus = 'success' | 'failed' | 'pending'

export type RepositorySourceInfo = {
  branch: string
  commitMessage: string
  pushedBy: string
  pushedAt: string
}

export type RepositoryItem = {
  id: string
  name: string
  visibility: 'Public' | 'Private'
  description: string
  updatedAt: string
  stars: number
  language: string
  branches: string[]
  detectEnabled: boolean
  repositoryUrl: string
  domainUrl: string
  pipelineStatus: PipelineStatus
  source: RepositorySourceInfo
}

export const repositorySeed: RepositoryItem[] = [
  {
    id: '1',
    name: 'myuser/web-app',
    visibility: 'Public',
    description: 'React 기반 프론트엔드 웹 애플리케이션',
    updatedAt: '2026-03-29T11:00:00',
    stars: 12,
    language: 'TypeScript',
    branches: ['main', 'develop', 'feature/login'],
    detectEnabled: true,
    repositoryUrl: 'https://github.com/myuser/web-app',
    domainUrl: 'ec2-3-39-24-101.ap-northeast-2.compute.amazonaws.com',
    pipelineStatus: 'success',
    source: {
      branch: 'feature/login',
      commitMessage: 'feat: add oauth login flow and token refresh handling',
      pushedBy: 'myuser',
      pushedAt: '2026-03-31T15:22:00',
    },
  },
  {
    id: '2',
    name: 'myuser/api-server',
    visibility: 'Public',
    description: '보안 검사 API 서버',
    updatedAt: '2026-03-30T08:40:00',
    stars: 8,
    language: 'TypeScript',
    branches: ['main', 'develop', 'feature/login', 'release/v1'],
    detectEnabled: true,
    repositoryUrl: 'https://github.com/myuser/api-server',
    domainUrl: 'ec2-54-180-11-245.ap-northeast-2.compute.amazonaws.com',
    pipelineStatus: 'pending',
    source: {
      branch: 'develop',
      commitMessage: 'chore: bump dependency scanner and normalize report schema',
      pushedBy: 'secu-bot',
      pushedAt: '2026-03-30T10:11:00',
    },
  },
]

export function getRepositoryById(repoId: string) {
  return repositorySeed.find((repo) => repo.id === repoId) ?? null
}
