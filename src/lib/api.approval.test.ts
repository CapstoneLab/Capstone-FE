import { afterEach, expect, it, vi } from 'vitest'
import { fetchJobResult } from './api'
afterEach(() => vi.unstubAllGlobals())
it.each([true, false, undefined])('requires explicit server approval eligibility: %s', async (eligible) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    job_id: 'job', verdict: 'block_pending_approval', approval_eligible: eligible,
    approval_reason: eligible ? null : 'Already deployed',
  }), { status: 200 })))
  const result = await fetchJobResult('token', 'job')
  expect(result?.approvalEligible).toBe(eligible === true)
  expect(result?.approvalReason).toBe(eligible ? null : 'Already deployed')
})
