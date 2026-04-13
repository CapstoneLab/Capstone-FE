import type { RepositoryItem } from '@/data/repositories'

const API_BASE =
  window.location.protocol === 'file:'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api-proxy'

type UnknownRecord = Record<string, unknown>

function pick<T = unknown>(obj: UnknownRecord, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null) {
      return value as T
    }
  }
  return undefined
}

function mapRepo(raw: UnknownRecord): RepositoryItem {
  const isPrivate = pick<boolean>(raw, 'private', 'isPrivate', 'visibility_private')
  const visibilityField = pick<string>(raw, 'visibility')
  const visibility: 'Public' | 'Private' =
    visibilityField === 'private' || isPrivate === true ? 'Private' : 'Public'

  const fullName = pick<string>(raw, 'full_name', 'fullName', 'name') ?? ''
  const defaultBranch = pick<string>(raw, 'default_branch', 'defaultBranch')
  const updatedAt =
    pick<string>(raw, 'updated_at', 'updatedAt', 'pushed_at', 'pushedAt') ?? ''
  const htmlUrl = pick<string>(raw, 'html_url', 'htmlUrl', 'url') ?? ''
  const rawId = pick<string | number>(raw, 'id', 'repo_id', 'repoId')

  return {
    id: rawId !== undefined ? String(rawId) : fullName,
    name: fullName,
    visibility,
    description: pick<string>(raw, 'description') ?? '',
    updatedAt,
    stars: pick<number>(raw, 'stargazers_count', 'stars', 'stargazersCount') ?? 0,
    language: pick<string>(raw, 'language') ?? '',
    branches: defaultBranch ? [defaultBranch] : [],
    detectEnabled: false,
    repositoryUrl: htmlUrl,
    domainUrl: '',
    pipelineStatus: 'pending',
    source: {
      branch: defaultBranch ?? '',
      commitMessage: '',
      pushedBy: pick<string>(raw, 'pushed_by', 'pushedBy') ?? '',
      pushedAt: pick<string>(raw, 'pushed_at', 'pushedAt') ?? updatedAt,
    },
  }
}

function extractList(data: unknown): UnknownRecord[] {
  if (Array.isArray(data)) return data as UnknownRecord[]
  const record = (data ?? {}) as UnknownRecord
  if (Array.isArray(record.repos)) return record.repos as UnknownRecord[]
  if (Array.isArray(record.items)) return record.items as UnknownRecord[]
  if (Array.isArray(record.branches)) return record.branches as UnknownRecord[]
  return []
}

export async function fetchRepos(token: string): Promise<RepositoryItem[]> {
  const res = await fetch(`${API_BASE}/api/repos`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[api] /repos failed:', res.status, text)
    throw new Error(`Failed to fetch repos (${res.status})`)
  }

  return extractList(await res.json()).map(mapRepo)
}

export async function fetchBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<string[]> {
  const res = await fetch(
    `${API_BASE}/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    console.error('[api] /branches failed:', res.status)
    return []
  }

  return extractList(await res.json())
    .map((item) => pick<string>(item, 'name', 'branch') ?? '')
    .filter(Boolean)
}

const REPO_CACHE_PREFIX = 'secupipeline:repos:'

export function getCachedRepos(key: string): RepositoryItem[] | null {
  try {
    const raw = localStorage.getItem(REPO_CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { repos?: RepositoryItem[] }
    return Array.isArray(parsed.repos) ? parsed.repos : null
  } catch {
    return null
  }
}

export function setCachedRepos(key: string, repos: RepositoryItem[]): void {
  try {
    localStorage.setItem(
      REPO_CACHE_PREFIX + key,
      JSON.stringify({ timestamp: Date.now(), repos }),
    )
  } catch {
    // storage quota or unavailable — ignore
  }
}

export async function fetchReposWithBranches(token: string): Promise<RepositoryItem[]> {
  const repos = await fetchRepos(token)
  const enriched = await Promise.all(
    repos.map(async (repo) => {
      const [owner, name] = repo.name.split('/')
      if (!owner || !name) return repo
      const branches = await fetchBranches(token, owner, name)
      if (branches.length === 0) return repo
      const defaultBranch = repo.source.branch
      const ordered = defaultBranch
        ? [defaultBranch, ...branches.filter((b) => b !== defaultBranch)]
        : branches
      return { ...repo, branches: ordered }
    }),
  )
  return enriched
}
