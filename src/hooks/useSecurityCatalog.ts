import { useQuery } from '@tanstack/react-query'
import { fetchSecurityCatalog } from '@/lib/api'
import { securityCheckCatalog, type SecurityCheckItem } from '@/data/securityCatalog'

// The server catalog (GET /api/security/catalog) is the single source of truth
// for which checks exist and how many there are. The bundled list is only an
// offline fallback — mixing the two showed "n/14" against a 16-item server.
export function useSecurityCatalog(token: string | null) {
  const query = useQuery({
    queryKey: ['security-catalog'],
    queryFn: () => fetchSecurityCatalog(token!),
    enabled: !!token,
    staleTime: 60 * 60_000,
  })
  const serverItems = query.data ?? []
  const items: SecurityCheckItem[] = serverItems.length > 0 ? serverItems : securityCheckCatalog
  return {
    items,
    /** True once the list comes from the server rather than the fallback. */
    fromServer: serverItems.length > 0,
    isLoading: query.isPending && !!token,
    error: query.error,
  }
}
