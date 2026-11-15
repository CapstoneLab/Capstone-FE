import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { removeOldestQuery, type PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { PERSISTED_JOB_PARTS } from '@/hooks/useJobQueries'

// Single app-wide query cache. Results of finished pipeline runs never change,
// so most job queries are cached for a long time (see src/hooks/useJobQueries.ts);
// these are only the defaults for everything else.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Must be ≥ the persister maxAge or restored entries get collected.
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      // Electron focus changes would otherwise refetch every visible query.
      refetchOnWindowFocus: false,
    },
  },
})

// Survive app restarts: run detail/steps/result go to localStorage, so the
// dashboard's recent status and the result page are instant on next launch.
// When storage is full the oldest query is dropped and the write retried.
const persister =
  typeof window !== 'undefined'
    ? createSyncStoragePersister({
        storage: window.localStorage,
        key: 'secupipeline:query-cache',
        throttleTime: 2_000,
        retry: removeOldestQuery,
      })
    : undefined

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> | null = persister
  ? {
      persister,
      maxAge: 24 * 60 * 60_000,
      // Bump when cached data shapes change so stale shapes are discarded.
      buster: 'v1',
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' &&
          query.state.data != null &&
          ((query.queryKey[0] === 'job' && PERSISTED_JOB_PARTS.has(String(query.queryKey[2]))) ||
            // Repository page "최근 파이프라인 상태" card.
            query.queryKey[0] === 'repo-latest-run'),
      },
    }
  : null
