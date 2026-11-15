import { describe, expect, it } from 'vitest'
import { conflictExistingJobId } from './api'

describe('conflictExistingJobId', () => {
  it('reads the id nested under detail (current backend)', () => {
    expect(
      conflictExistingJobId({ detail: { message: 'already running', existing_job_id: 'job-1' } }),
    ).toBe('job-1')
  })

  it('falls back to the top-level id (older backend)', () => {
    expect(conflictExistingJobId({ detail: 'already running', existing_job_id: 'job-2' })).toBe('job-2')
  })

  it('returns null when no id is present', () => {
    expect(conflictExistingJobId({ detail: 'already running' })).toBeNull()
    expect(conflictExistingJobId(null)).toBeNull()
  })
})
