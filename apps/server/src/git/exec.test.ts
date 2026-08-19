import { describe, expect, it } from 'vitest'
import {
  resolveGitExecutable,
  runGit,
  runGitBytes,
  runGitWithStdin,
} from './exec.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { rmSync } from 'node:fs'

describe('git exec', () => {
  it('runs git through an argument array and maps failures', () => {
    const git = resolveGitExecutable()
    expect(git.length).toBeGreaterThan(0)
    const cwd = createTemporaryDirectory()
    try {
      expect(runGit(cwd, ['--version'])).toMatch(/git version/)
      expect(runGit(cwd, ['--version'], { trim: false })).toMatch(/git version/)
      expect(runGitBytes(cwd, ['--version']).length).toBeGreaterThan(0)
      expect(runGit(cwd, ['not-a-command'], { allowedFailure: true })).toBe('')
      expect(() => runGit(cwd, ['not-a-command'])).toThrow(/Git操作/)
      expect(() => runGitBytes(cwd, ['not-a-command'])).toThrow(/Git操作/)
      expect(() => runGitWithStdin(cwd, ['not-a-command'], 'payload')).toThrow()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
