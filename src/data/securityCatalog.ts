// The fixed 16-item security check catalog, grouped by severity (4 per
// grade). Mirrors "보안 정책 16개 카탈로그" / GET /api/security/catalog.
// Used as the source of truth for the selection UI and as a local FALLBACK
// when the catalog API is unavailable. `id` is the backend `key`
// (e.g. "sql-injection") sent in `selected_items`.

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'

export type SecurityCheckItem = {
  /** Catalog key — the identifier sent to the backend in `selected_items`
   *  (e.g. "sql-injection"). Matches GET /api/security/catalog `key`. */
  id: string
  title: string
  cwe: string
  severity: CheckSeverity
  description: string
}

export const severityMeta: Record<
  CheckSeverity,
  { label: string; color: string }
> = {
  critical: { label: 'Critical', color: '#EF4444' },
  high: { label: 'High', color: '#F97316' },
  medium: { label: 'Medium', color: '#EAB308' },
  low: { label: 'Low', color: '#22C55E' },
}

export const severityOrder: CheckSeverity[] = ['critical', 'high', 'medium', 'low']

export const securityCheckCatalog: SecurityCheckItem[] = [
  // Critical
  {
    id: 'sql-injection',
    title: 'SQL Injection',
    cwe: 'CWE-89',
    severity: 'critical',
    description: '사용자 입력이 쿼리에 직접 결합되어 데이터베이스 조작이 가능한지 검사합니다.',
  },
  {
    id: 'command-injection',
    title: 'Command Injection',
    cwe: 'CWE-78',
    severity: 'critical',
    description: '외부 명령 실행 구문에 악의적 입력이 주입되어 시스템 명령이 실행되는지 확인합니다.',
  },
  {
    id: 'hardcoded-secret',
    title: 'Hardcoded Secret',
    cwe: 'CWE-798',
    severity: 'critical',
    description: '소스코드에 API 키, 토큰, 비밀번호 같은 민감 정보가 하드코딩되어 있는지 탐지합니다.',
  },
  {
    id: 'code-injection',
    title: 'Code Injection',
    cwe: 'CWE-94',
    severity: 'critical',
    description: '신뢰할 수 없는 입력이 코드로 평가/실행되어 임의 코드가 수행되는지 검사합니다.',
  },
  // High
  {
    id: 'insecure-deserialization',
    title: 'Insecure Deserialization',
    cwe: 'CWE-502',
    severity: 'high',
    description: '신뢰할 수 없는 직렬화 데이터 역직렬화 과정에서 원격 코드 실행 위험을 분석합니다.',
  },
  {
    id: 'idor',
    title: 'IDOR',
    cwe: 'CWE-639',
    severity: 'high',
    description: '접근 제어 없이 식별자 조작만으로 타인의 객체·데이터에 접근 가능한지 점검합니다.',
  },
  {
    id: 'improper-jwt',
    title: 'Improper JWT Verification',
    cwe: 'CWE-347',
    severity: 'high',
    description: 'JWT 서명 검증이 누락되거나 약하게 처리되어 토큰 위조가 가능한지 확인합니다.',
  },
  {
    id: 'cleartext-transmission',
    title: 'Cleartext Transmission',
    cwe: 'CWE-319',
    severity: 'high',
    description: '민감 정보가 암호화 없이 평문으로 전송되는지 탐지합니다.',
  },
  // Medium
  {
    id: 'path-traversal',
    title: 'Path Traversal',
    cwe: 'CWE-22',
    severity: 'medium',
    description: '파일 경로 조작으로 허용되지 않은 상위 디렉터리에 접근 가능한지 점검합니다.',
  },
  {
    id: 'xss',
    title: 'XSS',
    cwe: 'CWE-79',
    severity: 'medium',
    description: '검증되지 않은 스크립트가 브라우저에서 실행되어 세션 탈취 위험이 있는지 탐지합니다.',
  },
  {
    id: 'weak-crypto',
    title: 'Weak Cryptography',
    cwe: 'CWE-327',
    severity: 'medium',
    description: '취약하거나 폐기된 암호 알고리즘 사용 여부를 점검합니다.',
  },
  {
    id: 'ssrf',
    title: 'SSRF',
    cwe: 'CWE-918',
    severity: 'medium',
    description: '서버가 검증 없이 외부 요청을 수행해 내부 자원에 접근당할 수 있는지 검사합니다.',
  },
  // Low
  {
    id: 'error-info-exposure',
    title: 'Error Message Info Exposure',
    cwe: 'CWE-209',
    severity: 'low',
    description: '오류 메시지에 내부 구현·스택 정보가 노출되는지 확인합니다.',
  },
  {
    id: 'missing-httponly',
    title: 'Missing HttpOnly',
    cwe: 'CWE-1004',
    severity: 'low',
    description: '쿠키에 HttpOnly 플래그가 없어 스크립트로 탈취 가능한지 점검합니다.',
  },
  {
    id: 'missing-secure-flag',
    title: 'Missing Secure Flag',
    cwe: 'CWE-614',
    severity: 'low',
    description: '쿠키에 Secure 플래그가 없어 평문 채널로 전송되는지 확인합니다.',
  },
  {
    id: 'weak-password-policy',
    title: 'Weak Password Requirements',
    cwe: 'CWE-521',
    severity: 'low',
    description: '비밀번호 정책이 약해 무차별 대입 공격에 취약한지 검사합니다.',
  },
]

export const allCheckIds: string[] = securityCheckCatalog.map((c) => c.id)

export function buildCatalogBySeverity(
  items: SecurityCheckItem[],
): Record<CheckSeverity, SecurityCheckItem[]> {
  return severityOrder.reduce(
    (acc, sev) => {
      acc[sev] = items.filter((c) => c.severity === sev)
      return acc
    },
    { critical: [], high: [], medium: [], low: [] } as Record<CheckSeverity, SecurityCheckItem[]>,
  )
}

export const catalogBySeverity = buildCatalogBySeverity(securityCheckCatalog)

// Look up a local catalog item's description by key, so a catalog fetched
// from the API (which carries no description) can reuse our copy.
const descriptionByKey = new Map(securityCheckCatalog.map((c) => [c.id, c.description]))
export function descriptionForKey(key: string): string {
  return descriptionByKey.get(key) ?? ''
}
