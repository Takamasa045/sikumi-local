import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import {
  capabilitiesMissing,
  DISCONNECTED_CAPABILITIES,
  isApprovalDecision,
  isCanonicalEventType,
  isTerminalEventType,
  parseApprovalDecision,
} from './index.js'

describe('provider SDK contracts', () => {
  it('keeps disconnected capabilities fully off', () => {
    expect(
      Object.values(DISCONNECTED_CAPABILITIES).every(
        (value) => value === false,
      ),
    ).toBe(true)
    expect(
      capabilitiesMissing(['streaming', 'liveApprovals'], {
        ...DISCONNECTED_CAPABILITIES,
        streaming: true,
      }),
    ).toEqual(['liveApprovals'])
  })

  it('accepts only known approval decisions and terminal events', () => {
    expect(parseApprovalDecision('approved')).toBe('approved')
    expect(isApprovalDecision('denied')).toBe(true)
    expect(isApprovalDecision('always')).toBe(false)
    expect(() => parseApprovalDecision('always')).toThrow(AppError)
    expect(isTerminalEventType('run.completed')).toBe(true)
    expect(isTerminalEventType('run.state_changed')).toBe(false)
    expect(isCanonicalEventType('artifact.created')).toBe(true)
    expect(isCanonicalEventType('reasoning.delta')).toBe(false)
  })
})
