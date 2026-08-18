import { rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import {
  assertJobCwd,
  assertRegisteredCwd,
  registeredRepositoryRoots,
} from './cwd-policy.js'
import { resolveFakeHarnessEnabled } from './runtime.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('cwd policy', () => {
  it('allows only registered repository paths', () => {
    const opened = openDatabase(track(createTemporaryDirectory()))
    databases.push(opened)
    const store = createStore(opened.db)
    const repositoryPath = track(createTemporaryDirectory())
    const workspace = store.createWorkspace({
      absolutePath: repositoryPath,
      displayName: 'registered-repo',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: null,
      readable: true,
    })

    expect(registeredRepositoryRoots(store)).toEqual([
      workspace.repository.absolutePath,
    ])
    expect(assertRegisteredCwd(store, workspace.repository.absolutePath)).toBe(
      workspace.repository.absolutePath,
    )
    expect(() =>
      assertRegisteredCwd(store, track(createTemporaryDirectory())),
    ).toThrow(/登録済みRepository以外/)

    const escape = join(repositoryPath, 'escape')
    const outside = track(createTemporaryDirectory())
    symlinkSync(outside, escape)
    expect(() => assertRegisteredCwd(store, escape)).toThrow(
      /登録済みRepository以外/,
    )
  })

  it('allows a dedicated worktree cwd and rejects anything else', () => {
    const opened = openDatabase(track(createTemporaryDirectory()))
    databases.push(opened)
    const store = createStore(opened.db)
    const worktree = track(createTemporaryDirectory())
    expect(assertJobCwd(store, worktree, worktree)).toBe(worktree)
    expect(() =>
      assertJobCwd(store, track(createTemporaryDirectory()), worktree),
    ).toThrow(/専用Worktree以外/)
  })

  it('rejects an encoded traversal that would leave the worktree', () => {
    const opened = openDatabase(track(createTemporaryDirectory()))
    databases.push(opened)
    const store = createStore(opened.db)
    const worktree = track(createTemporaryDirectory())
    expect(() =>
      assertJobCwd(store, `${worktree}/%2e%2e/secret`, worktree),
    ).toThrow()
  })
})

describe('fake harness flag', () => {
  it('stays off unless explicitly enabled', () => {
    expect(resolveFakeHarnessEnabled(undefined, {})).toBe(false)
    expect(
      resolveFakeHarnessEnabled(undefined, {
        SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER: '1',
      }),
    ).toBe(true)
    expect(
      resolveFakeHarnessEnabled(false, {
        SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER: '1',
      }),
    ).toBe(false)
    expect(resolveFakeHarnessEnabled(true, {})).toBe(true)
  })
})

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
