import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitObserverAdapter } from './adapter.js'
import {
  applyNameStatus,
  applyNumstat,
  parseStatusPorcelainV2,
  parseWorktreeList,
} from './status.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function repo(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-git-status-'))
  tempDirectories.push(directory)
  return directory
}

describe('git status parsers', () => {
  it('parses worktree list porcelain including detached and skipped noise', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(
      parseWorktreeList(
        [
          'ignored line',
          'worktree /tmp/main',
          'HEAD abc',
          'branch refs/heads/main',
          'worktree /tmp/feature',
          'HEAD def',
          'detached',
        ].join('\n'),
      ),
    ).toEqual([
      { path: '/tmp/main', head: 'abc', branch: 'main' },
      { path: '/tmp/feature', head: 'def', branch: null },
    ])
  })

  it('parses porcelain v2 untracked, unmerged, added, deleted, and renamed lines', () => {
    const root = repo()
    const parsed = parseStatusPorcelainV2(
      [
        '',
        '? src/new.ts',
        '? ../escape.ts',
        'u UU N... 100644 100644 100644 111 222 333 src/conflict.ts',
        'u',
        '1 A. N... 000000 100644 100644 0000000 abcdef1 src/added.ts',
        '1 .D N... 100644 000000 000000 abcdef1 0000000 src/deleted.ts',
        '1 M. N... 100644 100644 100644 abcdef1 abcdef2 src/changed.ts',
        '2 R. N... 100644 100644 100644 abcdef1 abcdef2 R100 src/old.ts\tsrc/renamed.ts',
        '1 .',
      ].join('\n'),
      root,
    )
    const byPath = Object.fromEntries(parsed.map((file) => [file.path, file]))
    expect(byPath['src/new.ts']?.changeType).toBe('untracked')
    expect(byPath['src/conflict.ts']?.changeType).toBe('unmerged')
    expect(byPath['src/added.ts']?.changeType).toBe('added')
    expect(byPath['src/deleted.ts']?.changeType).toBe('deleted')
    expect(byPath['src/changed.ts']?.changeType).toBe('modified')
    expect(byPath['src/renamed.ts']?.changeType).toBe('renamed')
    expect(byPath['src/renamed.ts']?.previousPath).toBe('src/old.ts')
    expect(parsed.some((file) => file.path.includes('escape'))).toBe(false)
  })

  it('applies name-status and numstat including copied, binary, and unknown codes', () => {
    const root = repo()
    const base = parseStatusPorcelainV2(
      '1 M. N... 100644 100644 100644 a b src/a.ts\n',
      root,
    )
    const named = applyNameStatus(
      base,
      [
        '',
        'R100\tsrc/old.ts\tsrc/renamed.ts',
        'C080\tsrc/a.ts\tsrc/copy.ts',
        'A\tsrc/added.ts',
        'D\tsrc/deleted.ts',
        'U\tsrc/conflict.ts',
        'M\tsrc/a.ts',
        'X\t../escape.ts',
        'R100\tsrc/old.ts\t',
      ].join('\n'),
      root,
    )
    const byPath = Object.fromEntries(named.map((file) => [file.path, file]))
    expect(byPath['src/renamed.ts']?.changeType).toBe('renamed')
    expect(byPath['src/copy.ts']?.changeType).toBe('copied')
    expect(byPath['src/added.ts']?.changeType).toBe('added')
    expect(byPath['src/deleted.ts']?.changeType).toBe('deleted')
    expect(byPath['src/conflict.ts']?.changeType).toBe('unmerged')
    expect(byPath['src/a.ts']?.changeType).toBe('modified')

    const counted = applyNumstat(
      named,
      [
        '',
        '3\t1\tsrc/a.ts',
        '-\t-\tsrc/binary.png',
        '2\t0\tsrc/old.ts\tsrc/renamed.ts',
        '1\t0\t',
        'nope\tnope\tsrc/a.ts',
      ].join('\n'),
      root,
    )
    const countedByPath = Object.fromEntries(
      counted.map((file) => [file.path, file]),
    )
    expect(countedByPath['src/a.ts']?.addedLines).toBeNull()
    expect(countedByPath['src/binary.png']?.addedLines).toBeNull()
    expect(countedByPath['src/renamed.ts']?.addedLines).toBe(2)
  })
})

describe('git observer adapter', () => {
  it('reports local git health without install files', async () => {
    const adapter = createGitObserverAdapter()
    const health = await adapter.healthCheck()
    expect(health.ok).toBe(true)
    expect((await adapter.install()).changed).toBe(false)
    expect((await adapter.uninstall()).changed).toBe(false)
    expect(adapter.normalize({ source: 'git' })).toBeNull()
  })
})
