import { describe, expect, it } from 'vitest'
import type { SecurityFinding } from '@/lib/api'
import { hasKorean, localizeFinding, normalizeCwe } from '@/lib/findingI18n'

function finding(patch: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: '1',
    scanner: 'semgrep',
    ruleId: 'java.spring.spel-injection',
    policyItem: 'code-injection',
    cwe: 'CWE-94',
    inScope: true,
    cve: null,
    cvss: null,
    cvssScore: null,
    title: 'A Spring expression is built with a dynamic value.',
    severity: 'critical',
    filePath: 'src/Vuln.java',
    lineNumber: 244,
    columnNumber: null,
    lineStart: 244,
    lineEnd: 244,
    codeSnippet: null,
    codeSnippetStartLine: null,
    description: 'A Spring expression is built with a dynamic value. The source of the value(s) should be verified.',
    aiSuggestion: 'Use a SimpleEvaluationContext.',
    references: [],
    ...patch,
  }
}

describe('localizeFinding', () => {
  it('replaces English scanner text with Korean by CWE in ko', () => {
    const result = localizeFinding(finding(), 'ko')
    expect(result.categoryLabel).toBe('코드 인젝션')
    expect(hasKorean(result.title)).toBe(true)
    expect(hasKorean(result.description)).toBe(true)
    expect(result.aiSuggestion).toBe('')
    expect(result.originalText).toContain('A Spring expression')
    expect(result.originalText).toContain('SimpleEvaluationContext')
  })

  it('prefers backend Korean fields', () => {
    const result = localizeFinding(
      finding({ titleKo: '백엔드 제목', descriptionKo: '백엔드 설명', aiSuggestionKo: '백엔드 제안' }),
      'ko',
    )
    expect(result.title).toBe('백엔드 제목')
    expect(result.description).toBe('백엔드 설명')
    expect(result.aiSuggestion).toBe('백엔드 제안')
    expect(result.originalText).toBeUndefined()
  })

  it('maps by policy item when CWE is missing, and uses generic text for unknown CWEs', () => {
    expect(localizeFinding(finding({ cwe: null }), 'ko').categoryLabel).toBe('코드 인젝션')
    const unknown = localizeFinding(finding({ cwe: 'CWE-99999', policyItem: null }), 'ko')
    expect(unknown.categoryLabel).toBeUndefined()
    expect(hasKorean(unknown.title)).toBe(true)
  })

  it('leaves text untouched in English and uses the catalog name', () => {
    const result = localizeFinding(finding(), 'en')
    expect(result.title).toBe(finding().title)
    expect(result.categoryLabel).toBe('Code Injection')
    expect(result.originalText).toBeUndefined()
  })

  it('normalizes CWE spellings', () => {
    expect(normalizeCwe('cwe-94')).toBe('CWE-94')
    expect(normalizeCwe('CWE-295: Improper Certificate Validation')).toBe('CWE-295')
    expect(normalizeCwe(null)).toBeNull()
  })
})
