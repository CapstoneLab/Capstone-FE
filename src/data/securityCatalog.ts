// The fixed 16-item security check catalog, grouped by severity (4 per
// grade). Mirrors the "화면 A — 검사 항목 선택" spec. When the backend exposes
// GET /api/security/catalog this can be replaced with a fetched list; until
// then this is the source of truth for the selection UI and the
// `selected_checks` payload sent to POST /api/pipelines.

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'

export type SecurityCheckItem = {
  /** Identifier sent to the backend in `selected_checks`. Uses the CWE code
   *  since that's the stable, scanner-agnostic key shown in the UI. */
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
    id: 'CWE-89',
    title: 'SQL Injection',
    cwe: 'CWE-89',
    severity: 'critical',
    description: '사용자 입력이 쿼리에 직접 결합되어 데이터베이스 조작이 가능한지 검사합니다.',
  },
  {
    id: 'CWE-78',
    title: 'Command Injection',
    cwe: 'CWE-78',
    severity: 'critical',
    description: '외부 명령 실행 구문에 악의적 입력이 주입되어 시스템 명령이 실행되는지 확인합니다.',
  },
  {
    id: 'CWE-798',
    title: 'Hardcoded Secret',
    cwe: 'CWE-798',
    severity: 'critical',
    description: '소스코드에 API 키, 토큰, 비밀번호 같은 민감 정보가 하드코딩되어 있는지 탐지합니다.',
  },
  {
    id: 'CWE-94',
    title: 'Code Injection',
    cwe: 'CWE-94',
    severity: 'critical',
    description: '신뢰할 수 없는 입력이 코드로 평가/실행되어 임의 코드가 수행되는지 검사합니다.',
  },
  // High
  {
    id: 'CWE-502',
    title: 'Insecure Deserialization',
    cwe: 'CWE-502',
    severity: 'high',
    description: '신뢰할 수 없는 직렬화 데이터 역직렬화 과정에서 원격 코드 실행 위험을 분석합니다.',
  },
  {
    id: 'CWE-639',
    title: 'IDOR',
    cwe: 'CWE-639',
    severity: 'high',
    description: '접근 제어 없이 식별자 조작만으로 타인의 객체·데이터에 접근 가능한지 점검합니다.',
  },
  {
    id: 'CWE-347',
    title: 'Improper JWT Verification',
    cwe: 'CWE-347',
    severity: 'high',
    description: 'JWT 서명 검증이 누락되거나 약하게 처리되어 토큰 위조가 가능한지 확인합니다.',
  },
  {
    id: 'CWE-319',
    title: 'Cleartext Transmission',
    cwe: 'CWE-319',
    severity: 'high',
    description: '민감 정보가 암호화 없이 평문으로 전송되는지 탐지합니다.',
  },
  // Medium
  {
    id: 'CWE-22',
    title: 'Path Traversal',
    cwe: 'CWE-22',
    severity: 'medium',
    description: '파일 경로 조작으로 허용되지 않은 상위 디렉터리에 접근 가능한지 점검합니다.',
  },
  {
    id: 'CWE-79',
    title: 'XSS',
    cwe: 'CWE-79',
    severity: 'medium',
    description: '검증되지 않은 스크립트가 브라우저에서 실행되어 세션 탈취 위험이 있는지 탐지합니다.',
  },
  {
    id: 'CWE-327',
    title: 'Weak Cryptography',
    cwe: 'CWE-327',
    severity: 'medium',
    description: '취약하거나 폐기된 암호 알고리즘 사용 여부를 점검합니다.',
  },
  {
    id: 'CWE-918',
    title: 'SSRF',
    cwe: 'CWE-918',
    severity: 'medium',
    description: '서버가 검증 없이 외부 요청을 수행해 내부 자원에 접근당할 수 있는지 검사합니다.',
  },
  // Low
  {
    id: 'CWE-209',
    title: 'Error Message Info Exposure',
    cwe: 'CWE-209',
    severity: 'low',
    description: '오류 메시지에 내부 구현·스택 정보가 노출되는지 확인합니다.',
  },
  {
    id: 'CWE-1004',
    title: 'Missing HttpOnly',
    cwe: 'CWE-1004',
    severity: 'low',
    description: '쿠키에 HttpOnly 플래그가 없어 스크립트로 탈취 가능한지 점검합니다.',
  },
  {
    id: 'CWE-614',
    title: 'Missing Secure Flag',
    cwe: 'CWE-614',
    severity: 'low',
    description: '쿠키에 Secure 플래그가 없어 평문 채널로 전송되는지 확인합니다.',
  },
  {
    id: 'CWE-521',
    title: 'Weak Password Requirements',
    cwe: 'CWE-521',
    severity: 'low',
    description: '비밀번호 정책이 약해 무차별 대입 공격에 취약한지 검사합니다.',
  },
]

export const allCheckIds: string[] = securityCheckCatalog.map((c) => c.id)

export const catalogBySeverity: Record<CheckSeverity, SecurityCheckItem[]> =
  severityOrder.reduce(
    (acc, sev) => {
      acc[sev] = securityCheckCatalog.filter((c) => c.severity === sev)
      return acc
    },
    { critical: [], high: [], medium: [], low: [] } as Record<
      CheckSeverity,
      SecurityCheckItem[]
    >,
  )
