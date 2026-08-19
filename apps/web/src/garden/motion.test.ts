import { describe, expect, it } from 'vitest'
import {
  poseGesture,
  readPrefersReducedMotion,
  travelDurationMs,
} from './motion'

describe('garden motion', () => {
  it('returns no duration for the same station', () => {
    expect(travelDurationMs({ x: 53, y: 49 }, { x: 53, y: 49 })).toBe(0)
  })

  it('returns a walk duration between distant stations', () => {
    const duration = travelDurationMs({ x: 53, y: 49 }, { x: 13, y: 22 })
    expect(duration).toBeGreaterThanOrEqual(480)
    expect(duration).toBeLessThanOrEqual(1400)
  })

  it('maps poses to existing gestures', () => {
    expect(poseGesture('idle', false)).toBe('idle')
    expect(poseGesture('reading', false)).toBe('working')
    expect(poseGesture('waiting', false)).toBe('waiting')
    expect(poseGesture('working', true)).toBe('walking')
    expect(poseGesture('completed', false)).toBe('idle')
  })

  it('treats missing matchMedia as motion enabled', () => {
    expect(readPrefersReducedMotion()).toBe(false)
  })
})
