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
    const paths = new Set((primary?.changedFiles ?? []).map((file) => file.path))
    expect(paths.has('src/auth.ts')).toBe(true)
    expect(paths.has('src/gone.ts')).toBe(true)
    expect(paths.has('src/new-name.ts') || paths.has('src/old-name.ts')).toBe(
      true,
    )
    expect(paths.has('src/untracked.ts')).toBe(true)
    const deleted = primary?.changedFiles.find((file) => file.path === 'src/gone.ts')
    expect(deleted?.changeType).toBe('deleted')
    const untracked = primary?.changedFiles.find(
      (file) => file.path === 'src/untracked.ts',
    )
    expect(untracked?.changeType).toBe('untracked')
    const linked = snapshot.worktrees.find((item) => item.path === realpathSync(worktree))
    expect(linked?.changedFiles.some((file) => file.path === 'src/feature.ts')).toBe(
      true,
    )
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
    expect(snapshot.latestRecordTitle).toBe('init')
    expect(snapshot.workTitles).toEqual(['init'])
    expect(snapshot.outgoingCount).toBeNull()
    expect(snapshot.incomingCount).toBeNull()
  })

  it('reads the latest record title and everyday sync counts', () => {
    const repo = createGitRepo()
    const bare = join(createTemp(), 'origin.git')
    execFileSync('git', ['init', '--bare', bare])
    execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo })
    execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: repo })
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 3\n')
    execFileSync('git', ['add', 'src/auth.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'ログイン画面の直し'], { cwd: repo })

    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.latestRecordTitle).toBe('ログイン画面の直し')
    expect(snapshot.workStory).toBeNull()
    expect(snapshot.placeIntro).toBeNull()
    expect(snapshot.articleTitles).toEqual([])
    expect(snapshot.workTitles).toEqual(['ログイン画面の直し', 'init'])
    expect(snapshot.outgoingCount).toBe(1)
    expect(snapshot.incomingCount).toBe(0)
    expect(snapshot.headCommit).not.toBe('ログイン画面の直し')
  })

  it('lists recent record titles newest first without inventing one', () => {
    const repo = createGitRepo()
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 3\n')
    execFileSync('git', ['add', 'src/auth.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'feat: launch HATARAKI office UI'], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 4\n')
    execFileSync('git', ['add', 'src/auth.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'ログイン画面の直し'], { cwd: repo })
    writeFileSync(join(repo, 'src/auth.ts'), 'export const a = 5\n')
    execFileSync('git', ['add', 'src/auth.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', '庭のクリック詳細を厚くする'], {
      cwd: repo,
    })

    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.latestRecordTitle).toBe('庭のクリック詳細を厚くする')
    expect(snapshot.workTitles).toEqual([
      '庭のクリック詳細を厚くする',
      'ログイン画面の直し',
      'feat: launch HATARAKI office UI',
      'init',
    ])
    expect(snapshot.articleTitles).toEqual([])
    expect(snapshot.placeIntro).toBeNull()
  })

  it('reads a Japanese README as the place intro without paths', () => {
    const repo = createGitRepo()
    writeFileSync(
      join(repo, 'README.md'),
      ['# はたらき', '', '働きの画面を整えるための場所です。', ''].join('\n'),
    )
    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.placeIntro).toBe(
      'はたらき。働きの画面を整えるための場所です。',
    )
    expect(snapshot.placeIntro).not.toContain('README.md')
  })

  it('extracts a blog article title from articles.log when the place is a kit', () => {
    const repo = createGitRepo()
    writeFileSync(join(repo, 'BLOG_WORKSPACE.md'), '# blog\n')
    writeFileSync(
      join(repo, 'articles.log'),
      [
        'date | title | characters | memo',
        '2026-08-15 | AIチームは多いほど強い、ではなかった | 3200 |',
        '',
      ].join('\n'),
    )
    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.workStory).toBe(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
    expect(snapshot.articleTitles).toEqual([
      {
        title: 'AIチームは多いほど強い、ではなかった',
        date: '2026-08-15',
      },
    ])
    expect(snapshot.workTitles[0]).toBe('init')
    expect(snapshot.workStory).not.toContain('MEMORY.md')
    expect(snapshot.workStory).not.toContain('BLOG_WORKSPACE.md')
  })

  it('uses a topic brief title when that topic folder is dirty', () => {
    const repo = createGitRepo()
    mkdirSync(join(repo, 'topics', '2026-08-15_ai-agent-wiring'), {
      recursive: true,
    })
    writeFileSync(join(repo, 'BLOG_WORKSPACE.md'), '# blog\n')
    writeFileSync(
      join(repo, 'topics', '2026-08-15_ai-agent-wiring', 'brief.yml'),
      'title: AIエージェントの配線\n',
    )
    writeFileSync(
      join(repo, 'articles.log'),
      ['date | title | characters | memo', '2026-08-01 | 短い下書き | 400 |', ''].join(
        '\n',
      ),
    )
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'blog kit'], { cwd: repo })
    writeFileSync(
      join(repo, 'topics', '2026-08-15_ai-agent-wiring', 'brief.yml'),
      'title: AIエージェントの配線\noutline: 続き\n',
    )

    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.workStory).toBe('『AIエージェントの配線』を書いています')
    expect(snapshot.workStory).not.toContain('brief.yml')
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
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree, firstHead], {
      cwd: repo,
    })
    writeFileSync(join(worktree, 'src/feature.ts'), 'export const f = 1\n')
    execFileSync('git', ['add', 'src/feature.ts'], { cwd: worktree })
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: worktree })

    const before = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    const snapshot = snapshotGitRepository(repo)
    const linked = snapshot.worktrees.find((item) => item.path === realpathSync(worktree))
    expect(linked?.baseCommit).toBe(firstHead)
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    ).toBe(before)
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }),
    ).toBe('')
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
    expect(matchLongestObservedRoot(link, [repo, realpathSync(linked)])).toBeNull()
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
    expect(files.map((file) => file.path)).toEqual(['src/new.ts', 'src/edit.ts'])
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
