import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ConflictFinding,
  ExternalSession,
} from '@sikumi-local/observer-core'
import {
  presentConflictActors,
  presentConflictTechnical,
  presentConflictView,
} from './conflict-view.js'
import type { CombinedStore } from '../storage/store.js'
import type {
  RegisteredRepository,
  StoredRepositorySnapshot,
} from '../storage/observer-store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('presentConflictTechnical', () => {
  it('reconstructs merge-base from worktree heads when session bases differ', () => {
    const repo = track(createTemporaryGitRepository())
    mkdirSync(joinSrc(repo), { recursive: true })
    writeFileSync(joinSrc(repo, 'users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const commonBase = revParse(repo, 'HEAD')

    const worktree = `${track(createTemporaryDirectory())}/wt`
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(joinSrc(repo, 'users.ts'), 'export const users = 2\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'main-ahead'], { cwd: repo })
    writeFileSync(joinSrc(worktree, 'users.ts'), 'export const users = 3\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: worktree })
    execFileSync('git', ['commit', '-m', 'feature-ahead'], { cwd: worktree })

    const leftHead = revParse(repo, 'HEAD')
    const rightHead = revParse(worktree, 'HEAD')
    expect(leftHead).not.toBe(rightHead)
    expect(commonBase).not.toBe(leftHead)
    expect(commonBase).not.toBe(rightHead)

    const finding = sampleFinding({
      leftWorktreePath: repo,
      rightWorktreePath: worktree,
      evidence: [
        {
          kind: 'same-file',
          label: '同じファイル',
          leftPath: 'src/users.ts',
          rightPath: 'src/users.ts',
        },
      ],
    })
    const leftSession = sampleSession({
      id: 'left',
      source: 'git',
      worktreePath: repo,
      branch: 'main',
      headCommit: leftHead,
      baseCommit: null,
      attributionConfidence: 'inferred',
    })
    const rightSession = sampleSession({
      id: 'right',
      source: 'git',
      worktreePath: worktree,
      branch: 'feature',
      headCommit: rightHead,
      baseCommit: 'deadbeef',
      attributionConfidence: 'inferred',
    })
    const technical = presentConflictTechnical({
      finding,
      repository: {
        id: 'repo_1',
        workspaceId: 'ws_1',
        absolutePath: repo,
        displayName: 'demo',
        currentBranch: 'main',
        readable: true,
      },
      snapshots: [
        snapshot({
          worktreePath: repo,
          branch: 'main',
          headCommit: leftHead,
          baseCommit: null,
          files: ['src/users.ts'],
        }),
        snapshot({
          worktreePath: worktree,
          branch: 'feature',
          headCommit: rightHead,
          baseCommit: commonBase,
          files: ['src/users.ts'],
        }),
      ],
      leftSession,
      rightSession,
    })

    expect(technical.commonBase).toBe(commonBase)
    expect(technical.leftBranch).toBe('main')
    expect(technical.rightBranch).toBe('feature')
    expect(technical.leftHead).toBe(leftHead)
    expect(technical.rightHead).toBe(rightHead)
    expect(technical.leftWorktreePath).toBe(repo)
    expect(technical.rightWorktreePath).toBe(worktree)
    expect(technical.changedPaths).toEqual(['src/users.ts'])
  })

  it('does not leak unregistered paths and reports unknown when merge-base is unavailable', () => {
    const technical = presentConflictTechnical({
      finding: sampleFinding({
        leftWorktreePath: '/tmp/unregistered-left',
        rightWorktreePath: '/tmp/unregistered-right',
        evidence: [
          {
            kind: 'same-file',
            label: '同じファイル',
            leftPath: '/tmp/secret/passwords.txt',
            rightPath: '../outside.ts',
          },
          {
            kind: 'same-file',
            label: '同じファイル',
            leftPath: 'src/users.ts',
          },
        ],
      }),
      repository: {
        id: 'repo_1',
        workspaceId: 'ws_1',
        absolutePath: '/registered/repo',
        displayName: 'demo',
        currentBranch: 'main',
        readable: true,
      },
      snapshots: [
        snapshot({
          worktreePath: '/registered/repo',
          branch: 'main',
          headCommit: 'aaa',
          baseCommit: null,
          files: ['src/users.ts', '/tmp/secret/notes.txt'],
        }),
      ],
      leftSession: sampleSession({
        id: 'left',
        source: 'git',
        worktreePath: '/tmp/unregistered-left',
        branch: 'secret-branch',
        headCommit: null,
        baseCommit: null,
      }),
    })

    expect(technical.leftWorktreePath).toBeNull()
    expect(technical.rightWorktreePath).toBeNull()
    expect(technical.commonBase).toBe('unknown')
    expect(technical.changedPaths).toEqual(['src/users.ts'])
    expect(JSON.stringify(technical)).not.toContain('/tmp/secret')
    expect(JSON.stringify(technical)).not.toContain('/tmp/unregistered')
    expect(JSON.stringify(technical)).not.toContain('../outside.ts')
  })
})

describe('presentConflictActors', () => {
  it('Scenario E: verified Codex + correlated Cursor is Codex / 変更元不明', () => {
    const finding = sampleFinding({
      leftSource: 'codex',
      rightSource: 'cursor',
      leftAttributionConfidence: 'verified',
      rightAttributionConfidence: 'correlated',
    })
    const actors = presentConflictActors(
      finding,
      sampleSession({
        id: 'codex-1',
        source: 'codex',
        attributionConfidence: 'verified',
      }),
      sampleSession({
        id: 'cursor-1',
        source: 'cursor',
        attributionConfidence: 'correlated',
      }),
    )
    expect(actors.leftActorLabel).toBe('Codex')
    expect(actors.rightActorLabel).toBe('変更元不明')
    expect(actors.leftAttributionConfidence).toBe('verified')
    expect(actors.rightAttributionConfidence).toBe('correlated')
  })

  it('prefers the current session confidence over a stale finding', () => {
    const actors = presentConflictActors(
      sampleFinding({
        leftSource: 'cursor',
        rightSource: 'git',
        leftAttributionConfidence: 'verified',
        rightAttributionConfidence: 'inferred',
      }),
      sampleSession({
        id: 'cursor-1',
        source: 'cursor',
        attributionConfidence: 'inferred',
      }),
    )
    expect(actors.leftActorLabel).toBe('変更元不明')
    expect(actors.rightActorLabel).toBe('変更元不明')
  })
})

describe('presentConflictView', () => {
  it('keeps simple mode path-free and adds safe actor labels', () => {
    const finding = sampleFinding({
      leftSource: 'codex',
      rightSource: 'cursor',
      leftAttributionConfidence: 'verified',
      rightAttributionConfidence: 'correlated',
      leftWorktreePath: '/registered/repo',
      rightWorktreePath: '/registered/repo-wt',
      evidence: [
        {
          kind: 'same-file',
          label: '同じファイル',
          leftPath: 'src/users.ts',
          rightPath: 'src/users.ts',
        },
      ],
    })
    const presented = presentConflictView(
      finding,
      fakeStore({
        repository: {
          id: 'repo_1',
          workspaceId: 'ws_1',
          absolutePath: '/registered/repo',
          displayName: 'demo',
          currentBranch: 'main',
          readable: true,
        },
        sessions: [
          sampleSession({
            id: 's-left',
            source: 'codex',
            attributionConfidence: 'verified',
          }),
          sampleSession({
            id: 's-right',
            source: 'cursor',
            attributionConfidence: 'correlated',
          }),
        ],
      }),
      'simple',
    )
    expect(presented.technical).toBeUndefined()
    expect(presented.leftWorktreePath).toBeNull()
    expect(presented.rightWorktreePath).toBeNull()
    expect(presented.evidence).toEqual([
      { kind: 'same-file', label: '同じファイル' },
    ])
    expect(presented.leftActorLabel).toBe('Codex')
    expect(presented.rightActorLabel).toBe('変更元不明')
    expect(JSON.stringify(presented)).not.toContain('src/users.ts')
    expect(JSON.stringify(presented)).not.toContain('/registered/repo')
  })
})

function sampleFinding(
  overrides: Partial<ConflictFinding> = {},
): ConflictFinding {
  return {
    id: 'cnf_1',
    identityKey: 'cnf:repo_1:s-left:s-right',
    repositoryId: 'repo_1',
    leftSessionId: 's-left',
    rightSessionId: 's-right',
    leftWorktreePath: '/registered/repo',
    rightWorktreePath: '/registered/repo-wt',
    leftSource: 'codex',
    rightSource: 'cursor',
    leftAttributionConfidence: 'verified',
    rightAttributionConfidence: 'verified',
    level: 'high',
    score: 82,
    confidence: 'inferred',
    headline: '🔴 同じ仕組みを変更しています',
    summary: '同じファイルを変更しています',
    recommendation: 'こちらから自動操作はしません。',
    reasons: ['同じファイル'],
    evidence: [{ kind: 'same-file', label: '同じファイル' }],
    fingerprint: 'fp',
    status: 'open',
    detectedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  }
}

function sampleSession(
  input: Partial<ExternalSession> & Pick<ExternalSession, 'id' | 'source'>,
): ExternalSession {
  return {
    surface: 'cli',
    externalSessionId: input.id,
    workspaceId: 'ws_1',
    repositoryId: 'repo_1',
    cwd: input.worktreePath ?? '/registered/repo',
    worktreePath: input.worktreePath ?? '/registered/repo',
    branch: input.branch ?? 'main',
    baseCommit: input.baseCommit ?? null,
    headCommit: input.headCommit ?? null,
    title: '作業中',
    status: 'active',
    activity: 'editing',
    attributionConfidence: input.attributionConfidence ?? 'verified',
    startedAt: '2026-08-18T00:00:00.000Z',
    lastObservedAt: '2026-08-18T00:00:00.000Z',
    endedAt: null,
    ...input,
  }
}

function snapshot(input: {
  readonly worktreePath: string
  readonly branch: string | null
  readonly headCommit: string | null
  readonly baseCommit: string | null
  readonly files: readonly string[]
}): StoredRepositorySnapshot {
  return {
    id: `snap-${input.worktreePath}`,
    repositoryId: 'repo_1',
    worktreePath: input.worktreePath,
    branch: input.branch,
    headCommit: input.headCommit,
    baseCommit: input.baseCommit,
    status: {},
    changedFiles: input.files.map((path) => ({ path })),
    createdAt: '2026-08-18T00:00:00.000Z',
  }
}

function fakeStore(input: {
  readonly repository?: RegisteredRepository
  readonly sessions?: readonly ExternalSession[]
  readonly snapshots?: readonly StoredRepositorySnapshot[]
}): CombinedStore {
  return {
    getRegisteredRepository() {
      return input.repository
    },
    getExternalSession(id: string) {
      return input.sessions?.find((session) => session.id === id)
    },
    latestSnapshotsByRepository() {
      return [...(input.snapshots ?? [])]
    },
  } as unknown as CombinedStore
}

function revParse(cwd: string, rev: string): string {
  return execFileSync('git', ['rev-parse', rev], {
    cwd,
    encoding: 'utf8',
  }).trim()
}

function joinSrc(root: string, file = ''): string {
  return file ? `${root}/src/${file}` : `${root}/src`
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
