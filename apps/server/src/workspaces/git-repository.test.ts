import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createTemporaryGitRepository } from '../test/git-fixture.js'
import { inspectGitRepository } from './git-repository.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('inspectGitRepository', () => {
  it('reads branch and redacts credential-bearing remotes', () => {
    const directory = track(
      createTemporaryGitRepository({
        remoteUrl:
          'https://x-access-token:ghs_super_secret@github.com/example/repo.git',
      }),
    )

    const inspection = inspectGitRepository(directory)

    expect(inspection.absolutePath).toBe(directory)
    expect(inspection.currentBranch).toBe('main')
    expect(inspection.remoteName).toBe('origin')
    expect(inspection.remoteUrl).toBe('https://github.com/example/repo.git')
    expect(inspection.readable).toBe(true)
  })

  it('rejects a directory that is not a Git repository', () => {
    const directory = track(join(tmpdir(), `sikumi-not-git-${Date.now()}`))
    mkdirSync(directory)

    try {
      inspectGitRepository(directory)
      throw new Error('expected REPOSITORY_NOT_GIT')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_NOT_GIT')
    }
  })

  it('rejects a nested path inside a Git repository', () => {
    const directory = track(
      createTemporaryGitRepository({ nestedDirectory: 'packages/app' }),
    )

    try {
      inspectGitRepository(join(directory, 'packages/app'))
      throw new Error('expected REPOSITORY_NOT_GIT')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_NOT_GIT')
    }
  })

  it('rejects a missing path', () => {
    try {
      inspectGitRepository('/tmp/sikumi-missing-repo-path')
      throw new Error('expected REPOSITORY_NOT_FOUND')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_NOT_FOUND')
    }
  })

  it('rejects a regular file', () => {
    const directory = track(
      createTemporaryGitRepository({ nestedDirectory: 'files' }),
    )
    const filePath = join(directory, 'files', 'notes.txt')
    writeFileSync(filePath, 'nope')

    try {
      inspectGitRepository(filePath)
      throw new Error('expected REPOSITORY_NOT_FOUND')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_NOT_FOUND')
    }
  })
})

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
