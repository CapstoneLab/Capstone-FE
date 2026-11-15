import { afterEach, expect, it, vi } from 'vitest'
import { fetchJobResult, approveJob } from './api'
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

it('maps same-job resume responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({status:'approved',resumed:true,
    resume_from_stage:'build',followup_job_id:'same',acknowledged_cwes:['CWE-502']}),{status:200})))
  expect(await approveJob('token','same','accepted',undefined,'Tester')).toMatchObject({
    resumed:true,resumeFromStage:'build',followupJobId:'same',acknowledgedCwes:['CWE-502']})
})
