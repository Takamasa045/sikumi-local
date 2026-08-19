import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  joinInside,
  matchLongestObservedRoot,
  resolveExistingRoot,
  sanitizeRepoPath,
} from './paths.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function trackDir(): string {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'sikumi-git-paths-')),
  )
  tempDirectories.push(directory)
  return directory
}

describe('observer-git paths', () => {
  it('sanitizes relative, absolute, missing, and escaped repository paths', () => {
    const root = trackDir()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/a.ts'), 'export {}\n')
    expect(sanitizeRepoPath('', root)).toBeNull()
    expect(sanitizeRepoPath('src/\0a.ts', root)).toBeNull()
    expect(sanitizeRepoPath('../secret', root)).toBeNull()
    expect(sanitizeRepoPath('src/a.ts', root)).toBe('src/a.ts')
    expect(sanitizeRepoPath(join(root, 'src/a.ts'), root)).toBe('src/a.ts')
    expect(sanitizeRepoPath(join(root, 'missing.ts'), root)).toBe('missing.ts')
    expect(sanitizeRepoPath('/tmp/outside.ts', root)).toBeNull()
    expect(sanitizeRepoPath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src/a.ts')
    expect(sanitizeRepoPath('C:\\other\\a.ts', 'C:\\repo')).toBeNull()

    const outside = trackDir()
    symlinkSync(outside, join(root, 'link-out'))
    expect(sanitizeRepoPath(join(root, 'link-out'), root)).toBeNull()
  })

  it('resolves existing roots and matches the longest observed root', () => {
    const root = trackDir()
    const nested = join(root, 'nested')
    mkdirSync(nested)
    expect(resolveExistingRoot(root)).toBe(realpathSync(root))
    expect(resolveExistingRoot(join(root, 'gone'))).toBeNull()
    expect(joinInside(root, 'src/a.ts')).toBe(join(root, 'src/a.ts'))
    expect(matchLongestObservedRoot(null, [root])).toBeNull()
    expect(matchLongestObservedRoot('   ', [root])).toBeNull()
    expect(matchLongestObservedRoot('../escape', [root])).toBeNull()
    expect(matchLongestObservedRoot(join(root, 'missing'), [])).toBeNull()
    expect(matchLongestObservedRoot(nested, [root, nested])).toBe(
      realpathSync(nested),
    )
    expect(matchLongestObservedRoot(nested, [root])).toBe(realpathSync(root))
  })
})
