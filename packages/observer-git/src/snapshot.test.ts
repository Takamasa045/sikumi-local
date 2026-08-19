import { execFileSync } from 'node:child_process'
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
import { createGitObserverAdapter } from './adapter.js'
import { resolveGitExecutable, runGit } from './exec.js'
import { matchLongestObservedRoot, sanitizeRepoPath } from './paths.js'
import { snapshotGitRepository } from './snapshot.js'
import { parseStatusPorcelainV2, parseWorktreeList } from './status.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('snapshotGitRepository', () => {
  it('returns unavailable for a path that is not a git repository', () => {
    const directory = createTemp()
    const snapshot = snapshotGitRepository(directory)
    expect(snapshot.available).toBe(false)
    expect(snapshot.reason).toBe('not-git')
    expect(snapshot.changedFiles).toEqual([])
  })

  it('returns unavailable for missing and non-directory paths', () => {
    const directory = createTemp()
    const missing = snapshotGitRepository(join(directory, 'gone'))
    expect(missing.available).toBe(false)
    expect(missing.reason).toBe('missing')
    const filePath = join(directory, 'file.txt')
    writeFileSync(filePath, 'not a directory\n')
    const fileSnapshot = snapshotGitRepository(filePath)
    expect(fileSnapshot.available).toBe(false)
    expect(fileSnapshot.reason).toBe('not-directory')
  })

  it('captures modified, deleted, renamed, untracked, and linked worktrees', () => {
    const repo = createGitRepo()
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 2\n')
    rmSync(join(repo, 'src/gone.ts'))
    execFileSync('git', ['mv', 'src/old-name.ts', 'src/new-name.ts'], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/untracked.ts'), 'export const u = 1\n')

    const worktree = join(createTemp(), 'linked')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(worktree, 'src/feature.ts'), 'export const f = 1\n')

    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.available).toBe(true)
    expect(snapshot.worktrees.length).toBeGreaterThanOrEqual(2)
    const primary = snapshot.worktrees.find((item) => item.isPrimary)
    const paths = new Set(
      (primary?.changedFiles ?? []).map((file) => file.path),
    )
    expect(paths.has('src/auth.ts')).toBe(true)
    expect(paths.has('src/gone.ts')).toBe(true)
    expect(paths.has('src/new-name.ts') || paths.has('src/old-name.ts')).toBe(
      true,
    )
    expect(paths.has('src/untracked.ts')).toBe(true)
    const deleted = primary?.changedFiles.find(
      (file) => file.path === 'src/gone.ts',
    )
    expect(deleted?.changeType).toBe('deleted')
    const untracked = primary?.changedFiles.find(
      (file) => file.path === 'src/untracked.ts',
    )
    expect(untracked?.changeType).toBe('untracked')
    const linked = snapshot.worktrees.find(
      (item) => item.path === realpathSync(worktree),
    )
    expect(
      linked?.changedFiles.some((file) => file.path === 'src/feature.ts'),
    ).toBe(true)
    expect(snapshot.baseCommit).toBeNull()
    expect(primary?.baseCommit).toBeNull()
    expect(linked?.headCommit).toBe(snapshot.headCommit)
    expect(linked?.baseCommit).toBeNull()
  })

  it('reports unknown when a meaningful merge-base cannot be established', () => {
    const repo = createGitRepo()
    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.available).toBe(true)
    expect(snapshot.baseCommit).toBeNull()
    expect(snapshot.worktrees[0]?.baseCommit).toBeNull()
  })

  it('uses merge-base of worktree branches without mutating git', () => {
    const repo = createGitRepo()
    const firstHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 2\n')
    execFileSync('git', ['add', 'src/auth.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'main-ahead'], { cwd: repo })
    const worktree = join(createTemp(), 'linked')
    execFileSync(
      'git',
      ['worktree', 'add', '-b', 'feature', worktree, firstHead],
      {
        cwd: repo,
      },
    )
    writeFileSync(join(worktree, 'src/feature.ts'), 'export const f = 1\n')
    execFileSync('git', ['add', 'src/feature.ts'], { cwd: worktree })
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: worktree })

    const before = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    const snapshot = snapshotGitRepository(repo)
    const linked = snapshot.worktrees.find(
      (item) => item.path === realpathSync(worktree),
    )
    expect(linked?.baseCommit).toBe(firstHead)
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim(),
    ).toBe(before)
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: repo,
        encoding: 'utf8',
      }),
    ).toBe('')
  })

  it('records a repository merge-base against origin/main without mutating git', () => {
    const repo = createGitRepo()
    const firstHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://example.invalid/repo.git'],
      { cwd: repo },
    )
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', firstHead], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 2\n')
    execFileSync('git', ['add', 'src/auth.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'ahead-of-origin'], { cwd: repo })
    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.available).toBe(true)
    expect(snapshot.baseCommit).toBe(firstHead)
    expect(snapshot.worktrees[0]?.baseCommit).toBe(firstHead)
  })
})

describe('observed root matching', () => {
  it('matches a linked worktree and rejects sibling and symlink escapes', () => {
    const repo = createGitRepo()
    const sibling = createTemp()
    writeFileSync(join(sibling, 'secret.txt'), 'nope')
    const linked = join(createTemp(), 'linked')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', linked], {
      cwd: repo,
    })
    const leak = join(createTemp(), 'outside')
    mkdirSync(leak)
    const link = join(createTemp(), 'alias')
    symlinkSync(leak, link)

    expect(matchLongestObservedRoot(linked, [repo, realpathSync(linked)])).toBe(
      realpathSync(linked),
    )
    expect(matchLongestObservedRoot(sibling, [repo])).toBeNull()
    expect(matchLongestObservedRoot(`${repo}-other`, [repo])).toBeNull()
    expect(
      matchLongestObservedRoot(link, [repo, realpathSync(linked)]),
    ).toBeNull()
  })
})

describe('path safety', () => {
  it('rejects traversal and outside symlinks', () => {
    const repo = createGitRepo()
    const outside = join(createTemp(), 'secret.txt')
    writeFileSync(outside, 'secret')
    const link = join(repo, 'src/leak')
    symlinkSync(outside, link)
    expect(sanitizeRepoPath('../secret.txt', repo)).toBeNull()
    expect(sanitizeRepoPath(link, repo)).toBeNull()
    expect(sanitizeRepoPath('src/auth.ts', repo)).toBe('src/auth.ts')
  })
})

describe('parsers', () => {
  it('parses worktree porcelain and status v2', () => {
    const listed = parseWorktreeList(
      [
        'worktree /repo',
        'HEAD abc',
        'branch refs/heads/main',
        '',
        'worktree /repo-feature',
        'HEAD def',
        'detached',
      ].join('\n'),
    )
    expect(listed).toEqual([
      { path: '/repo', head: 'abc', branch: 'main' },
      { path: '/repo-feature', head: 'def', branch: null },
    ])

    const files = parseStatusPorcelainV2(
      ['? src/new.ts', '1 .M N... 100644 100644 100644 a b src/edit.ts'].join(
        '\n',
      ),
      '/repo',
    )
    expect(files.map((file) => file.path)).toEqual([
      'src/new.ts',
      'src/edit.ts',
    ])
  })
})

describe('git adapter', () => {
  it('reports ready when git exists and does not change user settings', async () => {
    const adapter = createGitObserverAdapter()
    const health = await adapter.healthCheck()
    expect(health.ok).toBe(true)
    expect((await adapter.install()).changed).toBe(false)
    expect((await adapter.uninstall()).changed).toBe(false)
  })

  it('reports unavailable when git is missing from PATH', async () => {
    const previous = process.env.PATH
    process.env.PATH = ''
    try {
      const adapter = createGitObserverAdapter()
      const health = await adapter.healthCheck()
      expect(health.ok).toBe(false)
      expect(health.status).toBe('unavailable')
      expect(health.errors[0]).toContain('Git')
    } finally {
      process.env.PATH = previous
    }
  })
})

describe('git exec', () => {
  it('returns stdout on allowed failure and null when git is missing', () => {
    const repo = createGitRepo()
    expect(
      runGit(repo, ['rev-parse', '--verify', 'refs/heads/missing'], {
        allowedFailure: true,
      }),
    ).toBe('')
    expect(resolveGitExecutable()).toBeTruthy()
    const previous = process.env.PATH
    process.env.PATH = ''
    try {
      expect(resolveGitExecutable()).toBeNull()
      expect(runGit(repo, ['status'])).toBeNull()
    } finally {
      process.env.PATH = previous
    }
  })
})

function createGitRepo(): string {
  const directory = createTemp()
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: directory })
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(directory, 'src/auth.ts'), 'export const a = 1\n')
  writeFileSync(join(directory, 'src/gone.ts'), 'export const g = 1\n')
  writeFileSync(join(directory, 'src/old-name.ts'), 'export const o = 1\n')
  execFileSync('git', ['add', '.'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory })
  return realpathSync(directory)
}

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-observer-git-'))
  tempDirectories.push(directory)
  return directory
}
