import { describe, expect, it } from 'vitest'
import { resolveCommandOnPath } from './command-path.js'

describe('resolveCommandOnPath', () => {
  it('resolves node from PATH and rejects empty names', () => {
    expect(resolveCommandOnPath('')).toBeUndefined()
    expect(
      resolveCommandOnPath('definitely-missing-sikumi-bin'),
    ).toBeUndefined()
    expect(resolveCommandOnPath(process.execPath)).toBe(process.execPath)
    const fromPath = resolveCommandOnPath('node')
    expect(fromPath === undefined || fromPath.includes('node')).toBe(true)
  })
})
