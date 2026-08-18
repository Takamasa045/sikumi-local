import { describe, expect, it } from 'vitest'
import { getBuiltInWorld } from './worlds.js'

describe('built-in worlds', () => {
  it('returns the requested world or the first garden', () => {
    expect(getBuiltInWorld('craft-workshop').id).toBe('craft-workshop')
    expect(getBuiltInWorld('missing-world').id).toBe('dog-office')
  })
})
