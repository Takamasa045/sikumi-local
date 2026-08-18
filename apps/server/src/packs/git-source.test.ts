import { describe, expect, it } from 'vitest'
import { assertSafeGitUrl, displayGitSource } from './git-source.js'

describe('git pack source allowlist', () => {
  it('allows file and https, and rejects credentials and other schemes', () => {
    expect(assertSafeGitUrl('https://example.com/pack.git')).toContain(
      'https://example.com/pack.git',
    )
    expect(displayGitSource('https://example.com/pack.git')).toContain(
      'example.com',
    )
    expect(displayGitSource('file:///tmp/pack.git')).toBe(
      'local git repository',
    )
    expect(() => assertSafeGitUrl('ssh://git@example.com/pack.git')).toThrow()
    expect(() => assertSafeGitUrl('http://example.com/pack.git')).toThrow()
    expect(() => assertSafeGitUrl('file://evil-host/tmp/pack.git')).toThrow(
      /invalid/,
    )
    expect(() =>
      assertSafeGitUrl('https://user:secret@example.com/pack.git'),
    ).toThrow(/credentials/)
    expect(() => assertSafeGitUrl('not a url')).toThrow()
  })
})
