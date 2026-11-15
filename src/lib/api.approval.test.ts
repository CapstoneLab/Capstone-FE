import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideApproval, fetchJobResult } from './api'

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

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('decideApproval', () => {
  it('maps same-job resume responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, {
      status: 'approved', resumed: true, resume_from_stage: 'build',
      followup_job_id: 'same', acknowledged_cwes: ['CWE-502'],
    })))
    expect(await decideApproval('token', 'same', 'approve', 'accepted', 'Tester')).toMatchObject({
      resumed: true, resumeFromStage: 'build', followupJobId: 'same', acknowledgedCwes: ['CWE-502'],
    })
  })

  it('creates the pending approval when the backend has none, then approves', async () => {
    const calls: string[] = []
    let approveAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const action = url.split('/approval/')[1]
      calls.push(action)
      if (action === 'approve') {
        approveAttempts += 1
        return approveAttempts === 1
          ? reply(404, { detail: 'Pending approval not found' })
          : reply(200, { status: 'approved', followup_job_id: 'job-2' })
      }
      return reply(200, { status: 'pending' })
    }))

    const res = await decideApproval('t', 'job-1', 'approve', '[승인자: 홍길동] ok', '홍길동')
    expect(calls).toEqual(['approve', 'request', 'approve'])
    expect(res.followupJobId).toBe('job-2')
  })

  it('treats an already-existing request (409) as fine', async () => {
    let approveAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/request')) return reply(409, { detail: 'already pending' })
      approveAttempts += 1
      return approveAttempts === 1 ? reply(404, { detail: 'Pending approval not found' }) : reply(200, { status: 'approved' })
    }))
    await expect(decideApproval('t', 'job-1', 'approve', 'r', 'n')).resolves.toMatchObject({ status: 'approved' })
  })

  it('does not retry other failures', async () => {
    const fetchMock = vi.fn(async () => reply(500, { detail: 'boom' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(decideApproval('t', 'job-1', 'reject', 'r', 'n')).rejects.toThrow('500')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
