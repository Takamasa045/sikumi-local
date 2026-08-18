import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import {
  assertInsideDataDirectory,
  assertInsideWorktreesRoot,
  assertSafeBranchName,
  exportsRoot,
  jobShortId,
  sanitizeIdSegment,
  worktreeBranchName,
  worktreeRelPath,
  worktreesRoot,
} from './paths.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('worktree path guards', () => {
  it('accepts safe ids and rejects traversal, bad branches, and escaped roots', () => {
    expect(jobShortId('a8f3d2aa-1111-4111-8111-aaaaaaaaaaaa')).toBe('a8f3d2aa')
    expect(
      worktreeBranchName('saguru', 'a8f3d2aa-1111-4111-8111-aaaaaaaaaaaa'),
    ).toBe('shikumi/saguru/a8f3d2aa')
    expect(assertSafeBranchName('shikumi/saguru/a8f3d2aa')).toBe(
      'shikumi/saguru/a8f3d2aa',
    )
    expect(sanitizeIdSegment('repo-1', 'repositoryId')).toBe('repo-1')
    expect(worktreeRelPath('repo-1', 'job-1')).toContain('worktrees')
    expect(() => jobShortId('!!!')).toThrow()
    expect(() => worktreeBranchName('SAGURU', 'job-1')).toThrow()
    expect(() => assertSafeBranchName('main')).toThrow()
    expect(() => sanitizeIdSegment('..', 'repositoryId')).toThrow()
    expect(() => sanitizeIdSegment('a/b', 'repositoryId')).toThrow()
    expect(() => worktreeRelPath('../x', 'job')).toThrow()

    const data = track(createTemporaryDirectory())
    expect(worktreesRoot(data)).toBe(join(data, 'worktrees'))
    expect(exportsRoot(data)).toBe(join(data, 'exports'))
    mkdirSync(join(data, 'worktrees', 'repo', 'job'), { recursive: true })
    expect(
      assertInsideWorktreesRoot(join(data, 'worktrees', 'repo', 'job'), data),
    ).toContain('worktrees')
    expect(
      assertInsideDataDirectory(join(data, 'worktrees', 'repo', 'job'), data),
    ).toContain(data)
    const outside = track(createTemporaryDirectory())
    expect(() => assertInsideDataDirectory(outside, data)).toThrow(/escapes/)
    expect(() => assertInsideWorktreesRoot(outside, data)).toThrow(/contained/)
    const escape = join(data, 'worktrees', 'escape')
    symlinkSync(outside, escape)
    expect(() => assertInsideWorktreesRoot(escape, data)).toThrow()
  })
})

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
