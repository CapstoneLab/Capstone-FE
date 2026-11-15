// Korean presentation of scanner findings.
//
// Scanner messages (Semgrep etc.) arrive in English. When the UI language is
// Korean we show Korean text only:
//   1. backend-provided Korean fields (`title_ko`, `description_ko`,
//      `ai_suggestion_ko`) win;
//   2. otherwise a local Korean description chosen by the finding's policy
//      item (catalog key) or CWE;
//   3. otherwise a generic Korean sentence.
// The replaced English original is kept in `originalText` so the UI can offer
// it behind a collapsed "원문 보기" toggle instead of dropping it.

import type { SecurityFinding } from '@/lib/api'
import { securityCheckCatalog } from '@/data/securityCatalog'

type KoText = {
  /** Category name, e.g. "코드 인젝션". */
  name: string
  /** One-line title for the finding card. */
  title: string
  /** Why it is dangerous and how to fix it. */
  detail: string
}

const KO_BY_CWE: Record<string, KoText> = {
  'CWE-89': {
    name: 'SQL 인젝션',
    title: '사용자 입력이 SQL 쿼리에 직접 결합되어 있습니다.',
    detail:
      '공격자가 입력값으로 쿼리 구조를 바꿔 데이터를 조회·변조·삭제할 수 있습니다. 문자열 결합 대신 PreparedStatement/파라미터 바인딩이나 ORM의 안전한 쿼리 API를 사용하세요.',
  },
  'CWE-78': {
    name: '명령어 인젝션',
    title: '외부 입력이 운영체제 명령 실행에 사용되고 있습니다.',
    detail:
      '입력값에 셸 메타문자를 넣어 서버에서 임의 명령을 실행할 수 있습니다. 셸을 거치지 않는 API를 사용하고, 인자는 배열로 전달하며 허용 목록으로 검증하세요.',
  },
  'CWE-798': {
    name: '하드코딩된 비밀정보',
    title: '소스코드에 비밀번호·API 키·토큰이 하드코딩되어 있습니다.',
    detail:
      '저장소에 접근할 수 있는 누구나 비밀정보를 얻을 수 있고, 커밋 기록에도 남습니다. 환경 변수나 시크릿 매니저로 옮기고, 이미 노출된 키는 즉시 폐기·재발급하세요.',
  },
  'CWE-94': {
    name: '코드 인젝션',
    title: '외부 입력으로 만든 값이 코드(표현식)로 평가·실행됩니다.',
    detail:
      '공격자가 입력값에 코드를 넣어 서버에서 임의 코드를 실행할 수 있습니다. eval·스크립트 엔진·표현식 파서(SpEL 등)에 사용자 입력을 넘기지 말고, 꼭 필요하면 허용 목록 기반으로 제한하세요.',
  },
  'CWE-502': {
    name: '안전하지 않은 역직렬화',
    title: '신뢰할 수 없는 데이터를 역직렬화하고 있습니다.',
    detail:
      '조작된 직렬화 데이터로 원격 코드 실행이 가능할 수 있습니다. 외부 데이터의 네이티브 역직렬화를 피하고, JSON 같은 데이터 전용 형식과 타입 허용 목록을 사용하세요.',
  },
  'CWE-347': {
    name: '부적절한 JWT 검증',
    title: 'JWT 서명 검증이 누락되었거나 약하게 처리되고 있습니다.',
    detail:
      '서명이 검증되지 않으면 공격자가 토큰을 위조해 다른 사용자로 인증할 수 있습니다. 서명을 항상 검증하고, none 알고리즘을 허용하지 말며 사용할 알고리즘을 명시적으로 고정하세요.',
  },
  'CWE-319': {
    name: '평문 전송',
    title: '민감한 정보가 암호화되지 않은 채널(HTTP 등)로 전송됩니다.',
    detail:
      '네트워크 중간에서 데이터가 그대로 노출되거나 변조될 수 있습니다. HTTPS/TLS를 사용하고 평문 프로토콜 주소를 제거하세요.',
  },
  'CWE-22': {
    name: '경로 조작',
    title: '외부 입력이 파일 경로에 검증 없이 사용됩니다.',
    detail:
      '"../" 같은 입력으로 허용되지 않은 상위 디렉터리의 파일을 읽거나 쓸 수 있습니다. 경로를 정규화한 뒤 허용된 기준 디렉터리 안에 있는지 확인하세요.',
  },
  'CWE-79': {
    name: 'XSS(크로스 사이트 스크립팅)',
    title: '검증되지 않은 입력이 웹 페이지에 그대로 출력됩니다.',
    detail:
      '공격자의 스크립트가 다른 사용자의 브라우저에서 실행되어 세션 탈취 등이 가능합니다. 출력 위치에 맞게 이스케이프하고, innerHTML 등 위험한 API 사용을 피하세요.',
  },
  'CWE-327': {
    name: '취약한 암호화',
    title: '취약하거나 더 이상 권장되지 않는 암호 알고리즘을 사용합니다.',
    detail:
      'MD5·SHA-1·DES 등은 충돌·복호화 공격에 취약합니다. AES-GCM, SHA-256 이상 등 현재 권장되는 알고리즘으로 교체하세요.',
  },
  'CWE-918': {
    name: 'SSRF(서버 측 요청 위조)',
    title: '사용자가 지정한 주소로 서버가 검증 없이 요청을 보냅니다.',
    detail:
      '공격자가 서버를 통해 내부망이나 클라우드 메타데이터 같은 내부 자원에 접근할 수 있습니다. 요청 대상 호스트를 허용 목록으로 제한하고 내부 IP 대역을 차단하세요.',
  },
  'CWE-209': {
    name: '오류 메시지 정보 노출',
    title: '오류 메시지에 내부 구현 정보가 노출됩니다.',
    detail:
      '스택 트레이스·쿼리·경로 등이 공격자에게 시스템 구조를 알려줍니다. 사용자에게는 일반적인 메시지만 보여주고 상세 내용은 서버 로그에만 남기세요.',
  },
  'CWE-1004': {
    name: 'HttpOnly 미설정',
    title: '쿠키에 HttpOnly 플래그가 설정되어 있지 않습니다.',
    detail:
      '스크립트(document.cookie)로 쿠키를 읽을 수 있어 XSS 발생 시 세션이 탈취될 수 있습니다. 세션·인증 쿠키에 HttpOnly를 설정하세요.',
  },
  'CWE-614': {
    name: 'Secure 플래그 미설정',
    title: '쿠키에 Secure 플래그가 설정되어 있지 않습니다.',
    detail:
      '쿠키가 HTTP 평문 연결로도 전송되어 중간에서 탈취될 수 있습니다. 민감한 쿠키에는 Secure 플래그를 설정하세요.',
  },
  // Frequently reported outside the 14-item catalog.
  'CWE-295': {
    name: '부적절한 인증서 검증',
    title: 'TLS 인증서 또는 호스트명 검증이 비활성화되어 있습니다.',
    detail:
      '모든 인증서를 신뢰하면 중간자 공격으로 암호화된 통신을 가로채거나 변조할 수 있습니다. 기본 TrustManager/HostnameVerifier를 사용하고, 자체 인증서는 신뢰 저장소에 등록해 검증하세요.',
  },
  'CWE-611': {
    name: 'XXE(외부 엔티티 참조)',
    title: 'XML 파서가 외부 엔티티를 처리하도록 설정되어 있습니다.',
    detail:
      '조작된 XML로 서버 파일을 읽거나 내부망에 요청을 보낼 수 있습니다. 파서에서 DTD와 외부 엔티티 처리를 비활성화하세요.',
  },
  'CWE-601': {
    name: '오픈 리다이렉트',
    title: '검증되지 않은 주소로 사용자를 리다이렉트합니다.',
    detail:
      '피싱 사이트로 사용자를 유도하는 데 악용될 수 있습니다. 리다이렉트 대상을 허용 목록이나 상대 경로로 제한하세요.',
  },
  'CWE-352': {
    name: 'CSRF(사이트 간 요청 위조)',
    title: 'CSRF 보호가 비활성화되어 있거나 누락되었습니다.',
    detail:
      '사용자가 모르는 사이에 로그인된 권한으로 요청이 실행될 수 있습니다. CSRF 토큰이나 SameSite 쿠키 설정으로 보호하세요.',
  },
  'CWE-330': {
    name: '예측 가능한 난수',
    title: '보안 용도에 예측 가능한 난수 생성기를 사용합니다.',
    detail:
      'Math.random·java.util.Random 등은 값을 추측할 수 있어 토큰·비밀번호 생성에 부적합합니다. SecureRandom 등 암호학적으로 안전한 생성기를 사용하세요.',
  },
  'CWE-338': {
    name: '예측 가능한 난수',
    title: '보안 용도에 암호학적으로 안전하지 않은 난수 생성기를 사용합니다.',
    detail:
      '생성된 값을 추측할 수 있습니다. SecureRandom, crypto.randomBytes 등 안전한 생성기를 사용하세요.',
  },
  'CWE-326': {
    name: '불충분한 암호 강도',
    title: '암호 키 길이나 강도가 충분하지 않습니다.',
    detail: '짧은 키는 무차별 대입으로 깨질 수 있습니다. RSA 2048비트 이상, AES 128비트 이상을 사용하세요.',
  },
  'CWE-916': {
    name: '취약한 비밀번호 해시',
    title: '비밀번호 저장에 충분히 강하지 않은 해시를 사용합니다.',
    detail:
      '빠른 해시는 유출 시 대량 대입 공격에 취약합니다. bcrypt·scrypt·Argon2 같은 비밀번호 전용 해시를 사용하세요.',
  },
  'CWE-532': {
    name: '로그 정보 노출',
    title: '민감한 정보가 로그에 기록됩니다.',
    detail: '로그에 접근할 수 있는 사람에게 비밀정보가 노출됩니다. 비밀번호·토큰 등은 로그에서 제외하거나 마스킹하세요.',
  },
  'CWE-117': {
    name: '로그 인젝션',
    title: '외부 입력이 검증 없이 로그에 기록됩니다.',
    detail: '줄바꿈 문자 등으로 가짜 로그를 끼워 넣을 수 있습니다. 로그에 쓰기 전에 개행 문자를 제거·인코딩하세요.',
  },
  'CWE-200': {
    name: '민감 정보 노출',
    title: '민감한 정보가 권한 없는 사용자에게 노출될 수 있습니다.',
    detail: '응답이나 출력에 필요한 정보만 포함하고, 내부 정보·개인정보는 제외하세요.',
  },
  'CWE-434': {
    name: '위험한 파일 업로드',
    title: '업로드 파일의 형식과 저장 위치를 제한하지 않습니다.',
    detail:
      '실행 가능한 파일이 업로드되어 서버에서 실행될 수 있습니다. 확장자·MIME 허용 목록을 적용하고 웹 루트 밖에 임의 이름으로 저장하세요.',
  },
  'CWE-90': {
    name: 'LDAP 인젝션',
    title: '외부 입력이 LDAP 쿼리에 직접 결합되어 있습니다.',
    detail: '쿼리를 조작해 인증을 우회하거나 정보를 조회할 수 있습니다. 입력값을 LDAP 규칙에 맞게 이스케이프하세요.',
  },
  'CWE-643': {
    name: 'XPath 인젝션',
    title: '외부 입력이 XPath 쿼리에 직접 결합되어 있습니다.',
    detail: '쿼리를 조작해 의도하지 않은 데이터에 접근할 수 있습니다. 파라미터화된 XPath를 사용하세요.',
  },
  'CWE-1333': {
    name: '정규식 서비스 거부(ReDoS)',
    title: '비효율적인 정규식이 사용되고 있습니다.',
    detail: '특정 입력에서 처리 시간이 급격히 늘어 서비스가 멈출 수 있습니다. 중첩 반복을 피하고 입력 길이를 제한하세요.',
  },
  'CWE-470': {
    name: '안전하지 않은 리플렉션',
    title: '외부 입력으로 클래스나 메서드를 선택해 호출합니다.',
    detail: '의도하지 않은 코드가 실행될 수 있습니다. 호출 가능한 대상을 허용 목록으로 제한하세요.',
  },
  'CWE-915': {
    name: '대량 할당',
    title: '요청 데이터가 객체 필드에 일괄 바인딩됩니다.',
    detail: '권한·역할 같은 필드가 조작될 수 있습니다. 바인딩 가능한 필드를 명시적으로 제한하세요.',
  },
  'CWE-113': {
    name: 'HTTP 응답 분할',
    title: '외부 입력이 HTTP 헤더에 검증 없이 들어갑니다.',
    detail: '개행 문자로 헤더나 응답을 조작할 수 있습니다. 헤더 값에서 CR/LF를 제거하세요.',
  },
  'CWE-489': {
    name: '디버그 기능 활성화',
    title: '운영 환경에서 디버그 모드가 활성화되어 있습니다.',
    detail: '내부 정보 노출이나 원격 코드 실행으로 이어질 수 있습니다. 배포 시 디버그 설정을 끄세요.',
  },
  'CWE-732': {
    name: '부적절한 권한 설정',
    title: '파일이나 리소스에 과도한 권한이 부여되어 있습니다.',
    detail: '다른 사용자가 파일을 읽거나 수정할 수 있습니다. 필요한 최소 권한만 부여하세요.',
  },
}

// Catalog key → CWE, so a finding tagged only with a policy item still maps.
const CWE_BY_KEY = new Map(securityCheckCatalog.map((item) => [item.id, item.cwe]))
const EN_NAME_BY_KEY = new Map(securityCheckCatalog.map((item) => [item.id, item.title]))
const EN_NAME_BY_CWE = new Map(securityCheckCatalog.map((item) => [item.cwe, item.title]))

const HANGUL = /[가-힣]/

export function hasKorean(text: string | null | undefined): boolean {
  return !!text && HANGUL.test(text)
}

/** "cwe-94", "CWE-94: Improper Control…", "94" → "CWE-94". */
export function normalizeCwe(value: string | null | undefined): string | null {
  const match = value?.match(/(?:cwe[-_\s]?)?(\d{1,5})/i)
  return match ? `CWE-${match[1]}` : null
}

function koTextFor(finding: SecurityFinding): KoText | null {
  const cwe = normalizeCwe(finding.cwe) ?? (finding.policyItem ? CWE_BY_KEY.get(finding.policyItem) : null)
  return (cwe && KO_BY_CWE[cwe]) || null
}

/** Category label in the active language. null → caller shows "정책 항목 외". */
export function findingCategoryLabel(finding: SecurityFinding, locale: string): string | null {
  if (locale === 'ko') {
    const ko = koTextFor(finding)
    if (ko) return ko.name
  } else {
    const cwe = normalizeCwe(finding.cwe)
    const en =
      (finding.policyItem && EN_NAME_BY_KEY.get(finding.policyItem)) || (cwe && EN_NAME_BY_CWE.get(cwe))
    if (en) return en
  }
  return finding.policyItem
}

/** Returns the finding with title/description/aiSuggestion in the active
 *  language. English stays untouched; Korean replaces non-Korean text. */
export function localizeFinding(finding: SecurityFinding, locale: string): SecurityFinding {
  const categoryLabel = findingCategoryLabel(finding, locale) ?? undefined
  if (locale !== 'ko') return { ...finding, categoryLabel }

  const ko = koTextFor(finding)
  const originalParts: string[] = []

  const sourceTitle = finding.title
  const sourceDescription = finding.description
  let title = finding.titleKo || (hasKorean(sourceTitle) ? sourceTitle : '')
  let description =
    finding.descriptionKo || (hasKorean(sourceDescription) ? sourceDescription : '')

  if (!title) {
    title = ko?.title ?? '보안 취약점이 탐지되었습니다.'
    if (sourceTitle) originalParts.push(sourceTitle)
  }
  if (!description) {
    description =
      ko?.detail ??
      '이 항목의 한국어 설명이 아직 준비되지 않았습니다. 아래 원문과 해당 코드를 확인하세요.'
    if (sourceDescription && sourceDescription !== sourceTitle) originalParts.push(sourceDescription)
  }

  let aiSuggestion = finding.aiSuggestionKo || ''
  if (!aiSuggestion && finding.aiSuggestion) {
    if (hasKorean(finding.aiSuggestion)) aiSuggestion = finding.aiSuggestion
    else originalParts.push(`[AI 수정 제안 원문]\n${finding.aiSuggestion}`)
  }

  return {
    ...finding,
    title,
    description,
    aiSuggestion,
    categoryLabel,
    originalText: originalParts.length > 0 ? originalParts.join('\n\n') : undefined,
  }
}
