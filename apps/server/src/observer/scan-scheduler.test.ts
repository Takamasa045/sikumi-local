import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScanScheduler } from './scan-scheduler.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('createScanScheduler', () => {
  it('throttles immediate scans and debounces hook floods', () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const scheduler = createScanScheduler({
      scan,
      throttleMs: 2_000,
      debounceMs: 500,
    })

    expect(scheduler.runIfDue('repo-1')).toBe(true)
    expect(scheduler.runIfDue('repo-1')).toBe(false)
    expect(scan).toHaveBeenCalledTimes(1)

    scheduler.schedule('repo-1')
    scheduler.schedule('repo-1')
    scheduler.schedule('repo-1')
    expect(scheduler.pendingCount()).toBe(1)
    vi.advanceTimersByTime(499)
    expect(scan).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(scan).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2_000)
    expect(scheduler.runIfDue('repo-1')).toBe(true)
    expect(scan).toHaveBeenCalledTimes(2)

    scheduler.schedule('repo-1')
    scheduler.schedule('repo-2')
    vi.advanceTimersByTime(500)
    expect(scan).toHaveBeenCalledTimes(3)
    expect(scan).toHaveBeenLastCalledWith('repo-2')
  })

  it('clears pending hook scans without running them', () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const scheduler = createScanScheduler({
      scan,
      throttleMs: 2_000,
      debounceMs: 500,
    })
    scheduler.schedule('repo-1')
    expect(scheduler.pendingCount()).toBe(1)
    scheduler.clear()
    expect(scheduler.pendingCount()).toBe(0)
    vi.advanceTimersByTime(1_000)
    expect(scan).not.toHaveBeenCalled()
  })
})

it('flush skips a still-throttled repository and records lastScanAt', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-19T00:00:00.000Z'))
  const scan = vi.fn()
  const scheduler = createScanScheduler({
    scan,
    throttleMs: 2_000,
    debounceMs: 500,
  })
  expect(scheduler.runIfDue('repo-1')).toBe(true)
  expect(scheduler.lastScanAt('repo-1')).toBe(Date.now())
  scheduler.schedule('repo-1')
  scheduler.flush()
  expect(scan).toHaveBeenCalledTimes(1)
  vi.setSystemTime(new Date('2026-08-19T00:00:03.000Z'))
  scheduler.schedule('repo-1')
  scheduler.flush()
  expect(scan).toHaveBeenCalledTimes(2)
})
