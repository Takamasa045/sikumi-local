import { describe, expect, it } from 'vitest'
import {
  conflictHeadline,
  scoreToConflictLevel,
  type AttributionConfidence,
  type ExternalSession,
  type ObserverSourceId,
  type ResourceClaim,
} from '../types.js'
import {
  actorDisplayName,
  analyzeConflictPair,
  analyzeRepositoryConflicts,
  analyzedToFinding,
  applyConflictTransition,
  classifyConflictPath,
  conflictIdentityKey,
  effectiveClaims,
  extractMigrationNumber,
  reconcileConflictFindings,
  safeActorLabel,
  scoreClaimPair,
  scoreSides,
  type ConflictClaimInput,
  type ConflictSide,
} from './index.js'

describe('conflict score bands', () => {
  it.each([
    [0, 'safe'],
    [29, 'safe'],
    [30, 'related'],
    [59, 'related'],
    [60, 'caution'],
    [79, 'caution'],
    [80, 'high'],
    [89, 'high'],
    [90, 'critical'],
    [100, 'critical'],
  ] as const)('maps %s to %s', (score, level) => {
    expect(scoreToConflictLevel(score)).toBe(level)
  })

  it('uses the documented easy-mode headlines', () => {
    expect(conflictHeadline('high')).toBe('🔴 同じ仕組みを変更しています')
    expect(conflictHeadline('caution')).toBe('🟠 完了順を調整した方が安全です')
    expect(conflictHeadline('related')).toBe('🟡 一部が関係しています')
    expect(conflictHeadline('safe')).toBe('🟢 別々に進められそうです')
  })
})

describe('mechanical scoring rules', () => {
  it.each([
    {
      name: 'delete vs edit same file is critical',
      left: claim({
        resourceKey: 'src/users.ts',
        action: 'delete',
        changeType: 'deleted',
      }),
      right: claim({
        resourceKey: 'src/users.ts',
        action: 'write',
        changeType: 'modified',
      }),
      score: 92,
      kind: 'delete-edit',
    },
    {
      name: 'same file is high',
      left: claim({ resourceKey: 'src/users.ts' }),
      right: claim({ resourceKey: 'src/users.ts' }),
      score: 82,
      kind: 'same-file',
    },
    {
      name: 'same schema file is high',
      left: claim({ resourceKey: 'src/db/schema/users.ts' }),
      right: claim({ resourceKey: 'src/db/schema/users.ts' }),
      score: 80,
      kind: 'same-schema',
    },
    {
      name: 'same API file is high',
      left: claim({ resourceKey: 'src/api/users.ts' }),
      right: claim({ resourceKey: 'src/api/users.ts' }),
      score: 80,
      kind: 'same-api',
    },
    {
      name: 'same config file is high',
      left: claim({ resourceKey: 'apps/web/vite.config.ts' }),
      right: claim({ resourceKey: 'apps/web/vite.config.ts' }),
      score: 80,
      kind: 'same-config',
    },
    {
      name: 'same package manifest is high',
      left: claim({ resourceKey: 'package.json' }),
      right: claim({ resourceKey: 'package.json' }),
      score: 80,
      kind: 'same-package',
    },
    {
      name: 'lockfile is related',
      left: claim({ resourceKey: 'pnpm-lock.yaml' }),
      right: claim({ resourceKey: 'pnpm-lock.yaml' }),
      score: 55,
      kind: 'lockfile',
    },
    {
      name: 'generated file is high',
      left: claim({ resourceKey: 'src/graphql-types.generated.ts' }),
      right: claim({ resourceKey: 'src/graphql-types.generated.ts' }),
      score: 80,
      kind: 'generated',
    },
    {
      name: 'same migration number is high',
      left: claim({ resourceKey: 'db/migrations/20240818120000_users.sql' }),
      right: claim({
        resourceKey: 'db/migrations/20240818120000_profiles.sql',
      }),
      score: 80,
      kind: 'migration-number',
    },
    {
      name: 'same directory is related',
      left: claim({ resourceKey: 'src/auth/login.ts' }),
      right: claim({ resourceKey: 'src/auth/logout.ts' }),
      score: 45,
      kind: 'same-directory',
    },
    {
      name: 'read vs write is related',
      left: claim({ resourceKey: 'src/users.ts', action: 'read' }),
      right: claim({ resourceKey: 'src/users.ts', action: 'write' }),
      score: 38,
      kind: 'read-write',
    },
    {
      name: 'schema to API is caution',
      left: claim({ resourceKey: 'src/db/schema/users.ts' }),
      right: claim({ resourceKey: 'src/api/users.ts' }),
      score: 68,
      kind: 'schema-api',
    },
    {
      name: 'test pairing is related',
      left: claim({ resourceKey: 'src/api/users.ts' }),
      right: claim({ resourceKey: 'tests/users.test.ts' }),
      score: 42,
      kind: 'test-pair',
    },
  ])('$name', ({ left, right, score, kind }) => {
    const hits = scoreClaimPair(left, right)
    expect(hits[0]?.kind).toBe(kind)
    expect(hits[0]?.score).toBe(score)
    expect(scoreToConflictLevel(hits[0]?.score ?? 0)).toBe(
      scoreToConflictLevel(score),
    )
  })

  it('treats a rename previous path as the same file', () => {
    const hits = scoreClaimPair(
      claim({
        resourceKey: 'src/users.ts',
        changeType: 'deleted',
        action: 'delete',
      }),
      claim({
        resourceKey: 'src/accounts.ts',
        previousPath: 'src/users.ts',
        changeType: 'renamed',
      }),
    )
    expect(hits[0]?.kind).toBe('delete-edit')
  })

  it('does not treat completely separate packages as a finding', () => {
    const hits = scoreSides(
      [claim({ resourceKey: 'packages/alpha/src/one.ts' })],
      [claim({ resourceKey: 'packages/beta/src/two.ts' })],
    )
    expect(hits).toEqual([])
  })

  it('keeps schema-to-API caution even across packages', () => {
    const hits = scoreSides(
      [claim({ resourceKey: 'packages/db/src/schema/users.ts' })],
      [claim({ resourceKey: 'packages/api/src/api/users.ts' })],
    )
    expect(hits[0]?.kind).toBe('schema-api')
    expect(hits[0]?.score).toBe(68)
  })
})

describe('false-positive controls', () => {
  it('does not link common src/index/user tokens as the same mechanism', () => {
    const hits = scoreClaimPair(
      claim({ resourceKey: 'src/index.ts' }),
      claim({ resourceKey: 'lib/user.ts' }),
    )
    expect(hits.some((hit) => hit.kind === 'schema-api')).toBe(false)
    expect(hits[0]?.score ?? 0).toBeLessThan(30)
  })

  it('explains exact evidence for schema-to-API instead of a broad substring', () => {
    const hits = scoreClaimPair(
      claim({ resourceKey: 'src/db/schema/users.ts' }),
      claim({ resourceKey: 'src/api/users.ts' }),
    )
    expect(hits[0]?.label).toContain('users')
    expect(hits[0]?.label).not.toMatch(/\bsrc\b/)
  })
})

describe('observed vs planned precedence', () => {
  it('drops a planned claim when the same path is already observed', () => {
    const effective = effectiveClaims([
      claim({ resourceKey: 'src/users.ts', claimKind: 'observed' }),
      claim({ resourceKey: 'src/users.ts', claimKind: 'planned' }),
      claim({ resourceKey: 'src/config.ts', claimKind: 'planned' }),
    ])
    expect(
      effective.map((item) => `${item.claimKind}:${item.resourceKey}`),
    ).toEqual(['observed:src/users.ts', 'planned:src/config.ts'])
  })

  it('still compares observed write against the other side planned write', () => {
    const analyzed = analyzeConflictPair({
      repositoryId: 'repo',
      left: side({
        sessionId: 'codex',
        source: 'codex',
        claims: [claim({ resourceKey: 'src/users.ts', claimKind: 'observed' })],
      }),
      right: side({
        sessionId: 'cursor',
        source: 'cursor',
        claims: [claim({ resourceKey: 'src/users.ts', claimKind: 'planned' })],
      }),
    })
    expect(analyzed?.level).toBe('high')
    expect(analyzed?.score).toBe(82)
  })
})

describe('scan-order invariance and stable identity', () => {
  it('keeps the same identity and score regardless of side or scan order', () => {
    const left = side({
      sessionId: 'sess-b',
      source: 'cursor',
      worktreePath: '/repo-b',
      claims: [claim({ resourceKey: 'src/users.ts' })],
    })
    const right = side({
      sessionId: 'sess-a',
      source: 'codex',
      worktreePath: '/repo-a',
      claims: [claim({ resourceKey: 'src/users.ts' })],
    })
    const forward = analyzeConflictPair({ repositoryId: 'repo', left, right })
    const reverse = analyzeConflictPair({
      repositoryId: 'repo',
      left: right,
      right: left,
    })
    expect(forward?.id).toBe(reverse?.id)
    expect(forward?.identityKey).toBe(reverse?.identityKey)
    expect(forward?.score).toBe(reverse?.score)
    expect(forward?.identityKey).toBe(conflictIdentityKey('repo', left, right))
  })

  it('does not compare a session with itself', () => {
    const same = side({
      sessionId: 'sess-1',
      claims: [claim({ resourceKey: 'src/users.ts' })],
    })
    expect(
      analyzeConflictPair({ repositoryId: 'repo', left: same, right: same }),
    ).toBeNull()
  })

  it('does not attribute a git-only worktree to an AI app', () => {
    const analyzed = analyzeRepositoryConflicts({
      repositoryId: 'repo',
      now: '2026-08-18T00:00:00.000Z',
      sessions: [],
      claims: [],
      worktrees: [
        {
          path: '/repo',
          branch: 'main',
          headCommit: 'aaa',
          baseCommit: null,
          files: [{ path: 'src/users.ts', changeType: 'modified' }],
        },
        {
          path: '/repo-wt',
          branch: 'feature',
          headCommit: 'bbb',
          baseCommit: 'aaa',
          files: [{ path: 'src/users.ts', changeType: 'modified' }],
        },
      ],
    })
    expect(analyzed).toHaveLength(1)
    expect(analyzed[0]?.left.source).toBe('git')
    expect(analyzed[0]?.right.source).toBe('git')
    expect(analyzed[0]?.summary).toContain('変更元不明')
    expect(analyzed[0]?.summary).not.toContain('Claude')
    expect(analyzed[0]?.summary).not.toContain('Codex')
  })
})

describe('path classification helpers', () => {
  it('extracts a migration number and ignores generic user tokens', () => {
    expect(
      extractMigrationNumber('db/migrations/20240818120000_users.sql'),
    ).toBe('20240818120000')
    expect(classifyConflictPath('src/index.ts').tokens).not.toContain('src')
    expect(classifyConflictPath('src/index.ts').tokens).not.toContain('index')
    expect(classifyConflictPath('lib/user.ts').tokens).not.toContain('user')
  })
})

describe('lifecycle reconcile', () => {
  const now = '2026-08-18T01:00:00.000Z'

  it('dedupes by identity, keeps acknowledged, resolves stale, and reopens on new evidence', () => {
    const first = analyzeConflictPair({
      repositoryId: 'repo',
      left: side({
        sessionId: 'codex',
        source: 'codex',
        claims: [claim({ resourceKey: 'src/users.ts' })],
      }),
      right: side({
        sessionId: 'cursor',
        source: 'cursor',
        claims: [claim({ resourceKey: 'src/users.ts' })],
      }),
    })
    expect(first).toBeTruthy()
    const inserted = reconcileConflictFindings({
      existing: [],
      analyzed: [first!],
      now: '2026-08-18T00:00:00.000Z',
    })
    const acknowledged = applyConflictTransition(
      inserted[0]!,
      'acknowledge',
      now,
    )
    expect(acknowledged.status).toBe('acknowledged')
    expect(
      applyConflictTransition(acknowledged, 'acknowledge', now).status,
    ).toBe('acknowledged')

    const unchanged = reconcileConflictFindings({
      existing: [acknowledged],
      analyzed: [first!],
      now,
    })
    expect(unchanged[0]?.status).toBe('acknowledged')
    expect(unchanged[0]?.id).toBe(first?.id)

    const disappeared = reconcileConflictFindings({
      existing: [acknowledged],
      analyzed: [],
      now,
    })
    expect(disappeared[0]?.status).toBe('resolved')
    expect(disappeared[0]?.resolvedAt).toBe(now)

    const resolvedAgain = reconcileConflictFindings({
      existing: disappeared,
      analyzed: [first!],
      now: '2026-08-18T02:00:00.000Z',
    })
    expect(resolvedAgain[0]?.status).toBe('resolved')

    const stronger = analyzeConflictPair({
      repositoryId: 'repo',
      left: side({
        sessionId: 'codex',
        source: 'codex',
        claims: [
          claim({
            resourceKey: 'src/users.ts',
            action: 'delete',
            changeType: 'deleted',
          }),
        ],
      }),
      right: side({
        sessionId: 'cursor',
        source: 'cursor',
        claims: [claim({ resourceKey: 'src/users.ts' })],
      }),
    })
    const reopened = reconcileConflictFindings({
      existing: disappeared,
      analyzed: [stronger!],
      now: '2026-08-18T03:00:00.000Z',
    })
    expect(reopened[0]?.status).toBe('open')
    expect(reopened[0]?.resolvedAt).toBeNull()
    expect(reopened[0]?.level).toBe('critical')

    const resolved = applyConflictTransition(acknowledged, 'resolve', now)
    expect(resolved.status).toBe('resolved')
    expect(applyConflictTransition(resolved, 'resolve', now).status).toBe(
      'resolved',
    )
  })
})

describe('acceptance scenarios A and C', () => {
  it('Scenario A: exact same users.ts from verified Codex and Cursor is high/red', () => {
    const analyzed = analyzeRepositoryConflicts({
      repositoryId: 'repo-a',
      now: '2026-08-18T00:00:00.000Z',
      sessions: [
        session({
          id: 'codex-1',
          source: 'codex',
          worktreePath: '/repo',
          attributionConfidence: 'verified',
        }),
        session({
          id: 'cursor-1',
          source: 'cursor',
          worktreePath: '/repo-wt',
          attributionConfidence: 'verified',
        }),
      ],
      claims: [
        resourceClaim('codex-1', 'src/users.ts'),
        resourceClaim('cursor-1', 'src/users.ts'),
      ],
      worktrees: [
        worktree('/repo', [{ path: 'src/users.ts', changeType: 'modified' }]),
        worktree('/repo-wt', [
          { path: 'src/users.ts', changeType: 'modified' },
        ]),
      ],
    })
    expect(analyzed).toHaveLength(1)
    expect(analyzed[0]?.level).toBe('high')
    expect(analyzed[0]?.score).toBeGreaterThanOrEqual(80)
    expect(analyzed[0]?.headline).toBe('🔴 同じ仕組みを変更しています')
    expect(analyzed[0]?.summary).toContain('Codex')
    expect(analyzed[0]?.summary).toContain('Cursor')
    expect(analyzed[0]?.left.attributionConfidence).toBe('verified')
    expect(analyzed[0]?.right.attributionConfidence).toBe('verified')
    expect(analyzed[0]?.recommendation).toContain('自動では取り込みません')
  })

  it('Scenario C: Grok schema vs Claude Code API is caution/orange', () => {
    const analyzed = analyzeRepositoryConflicts({
      repositoryId: 'repo-c',
      now: '2026-08-18T00:00:00.000Z',
      sessions: [
        session({
          id: 'grok-1',
          source: 'grok-build',
          worktreePath: '/repo',
          attributionConfidence: 'verified',
        }),
        session({
          id: 'claude-1',
          source: 'claude-code',
          worktreePath: '/repo-wt',
          attributionConfidence: 'verified',
        }),
      ],
      claims: [
        resourceClaim('grok-1', 'src/db/schema/users.ts'),
        resourceClaim('claude-1', 'src/api/users.ts'),
      ],
      worktrees: [
        worktree('/repo', [
          { path: 'src/db/schema/users.ts', changeType: 'modified' },
        ]),
        worktree('/repo-wt', [
          { path: 'src/api/users.ts', changeType: 'modified' },
        ]),
      ],
    })
    expect(analyzed).toHaveLength(1)
    expect(analyzed[0]?.level).toBe('caution')
    expect(analyzed[0]?.score).toBeGreaterThanOrEqual(60)
    expect(analyzed[0]?.score).toBeLessThan(80)
    expect(analyzed[0]?.headline).toBe('🟠 完了順を調整した方が安全です')
    expect(analyzed[0]?.summary).toContain('同じデータ構造')
    expect(analyzed[0]?.evidence[0]?.kind).toBe('schema-api')
  })
})

describe('per-side attribution and Scenario E', () => {
  it('names an app only when that side is verified or reported', () => {
    expect(safeActorLabel('codex', 'verified')).toBe('Codex')
    expect(safeActorLabel('cursor', 'reported')).toBe('Cursor')
    expect(safeActorLabel('cursor', 'correlated')).toBe('変更元不明')
    expect(safeActorLabel('grok-build', 'inferred')).toBe('変更元不明')
    expect(safeActorLabel('claude-code', 'unknown')).toBe('変更元不明')
    expect(safeActorLabel('git', 'verified')).toBe('変更元不明')
    expect(safeActorLabel(null, 'verified')).toBe('変更元不明')
  })

  it('Scenario E: verified Codex + correlated Cursor is Codex / 変更元不明', () => {
    const analyzed = analyzeRepositoryConflicts({
      repositoryId: 'repo-e',
      now: '2026-08-18T00:00:00.000Z',
      sessions: [
        session({
          id: 'codex-e',
          source: 'codex',
          worktreePath: '/repo',
          attributionConfidence: 'verified',
        }),
        session({
          id: 'cursor-e',
          source: 'cursor',
          worktreePath: '/repo-wt',
          attributionConfidence: 'correlated',
        }),
      ],
      claims: [
        resourceClaim('codex-e', 'src/users.ts'),
        resourceClaim('cursor-e', 'src/users.ts'),
      ],
      worktrees: [
        worktree('/repo', [{ path: 'src/users.ts', changeType: 'modified' }]),
        worktree('/repo-wt', [
          { path: 'src/users.ts', changeType: 'modified' },
        ]),
      ],
    })
    expect(analyzed).toHaveLength(1)
    const finding = analyzedToFinding(analyzed[0]!, {
      status: 'open',
      detectedAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      resolvedAt: null,
    })
    const labels = [
      actorDisplayName(analyzed[0]!.left),
      actorDisplayName(analyzed[0]!.right),
    ]
    expect(labels).toEqual(['Codex', '変更元不明'])
    expect(analyzed[0]?.summary).toContain('Codex')
    expect(analyzed[0]?.summary).toContain('変更元不明')
    expect(analyzed[0]?.summary).not.toContain('Cursor')
    expect(finding.leftAttributionConfidence).toBe(
      analyzed[0]?.left.attributionConfidence,
    )
    expect(finding.rightAttributionConfidence).toBe(
      analyzed[0]?.right.attributionConfidence,
    )
    expect(
      [
        safeActorLabel(finding.leftSource, finding.leftAttributionConfidence),
        safeActorLabel(finding.rightSource, finding.rightAttributionConfidence),
      ].sort(),
    ).toEqual(['Codex', '変更元不明'])
  })

  it('keeps git-only sides unnamed after persistence', () => {
    const analyzed = analyzeRepositoryConflicts({
      repositoryId: 'repo',
      now: '2026-08-18T00:00:00.000Z',
      sessions: [],
      claims: [],
      worktrees: [
        worktree('/repo', [{ path: 'src/users.ts', changeType: 'modified' }]),
        worktree('/repo-wt', [
          { path: 'src/users.ts', changeType: 'modified' },
        ]),
      ],
    })
    expect(analyzed).toHaveLength(1)
    expect(actorDisplayName(analyzed[0]!.left)).toBe('変更元不明')
    expect(actorDisplayName(analyzed[0]!.right)).toBe('変更元不明')
    expect(analyzed[0]?.summary).toContain('変更元不明')
    expect(analyzed[0]?.summary).not.toContain('Codex')
    const finding = analyzedToFinding(analyzed[0]!, {
      status: 'open',
      detectedAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      resolvedAt: null,
    })
    expect(finding.leftSource).toBe('git')
    expect(finding.rightSource).toBe('git')
    expect(
      safeActorLabel(finding.leftSource, finding.leftAttributionConfidence),
    ).toBe('変更元不明')
  })
})

function claim(
  input: Partial<ConflictClaimInput> & { resourceKey: string },
): ConflictClaimInput {
  return {
    resourceType: 'file',
    action: 'write',
    claimKind: 'observed',
    ...input,
  }
}

function side(
  input: Partial<ConflictSide> & {
    readonly sessionId?: string | null
    readonly claims: readonly ConflictClaimInput[]
  },
): ConflictSide {
  return {
    sessionId: input.sessionId ?? 'sess',
    source: input.source ?? 'codex',
    attributionConfidence: input.attributionConfidence ?? 'verified',
    worktreePath: input.worktreePath ?? '/repo',
    branch: input.branch ?? 'main',
    headCommit: input.headCommit ?? 'aaa',
    baseCommit: input.baseCommit ?? null,
    claims: input.claims,
  }
}

function session(input: {
  readonly id: string
  readonly source: ObserverSourceId
  readonly worktreePath: string
  readonly attributionConfidence: AttributionConfidence
}): ExternalSession {
  return {
    id: input.id,
    source: input.source,
    surface: 'cli',
    externalSessionId: input.id,
    workspaceId: 'ws',
    repositoryId: 'repo',
    cwd: input.worktreePath,
    worktreePath: input.worktreePath,
    branch: 'main',
    baseCommit: null,
    headCommit: 'aaa',
    title: '作業中',
    status: 'active',
    activity: 'editing',
    attributionConfidence: input.attributionConfidence,
    startedAt: '2026-08-18T00:00:00.000Z',
    lastObservedAt: '2026-08-18T00:00:00.000Z',
    endedAt: null,
  }
}

function resourceClaim(sessionId: string, path: string): ResourceClaim {
  return {
    id: `${sessionId}:${path}`,
    externalSessionId: sessionId,
    repositoryId: 'repo',
    resourceType: 'file',
    resourceKey: path,
    action: 'write',
    claimKind: 'observed',
    confidence: 'verified',
    firstObservedAt: '2026-08-18T00:00:00.000Z',
    lastObservedAt: '2026-08-18T00:00:00.000Z',
  }
}

function worktree(
  path: string,
  files: Array<{ path: string; changeType: 'modified' }>,
) {
  return {
    path,
    branch: path.endsWith('wt') ? 'feature' : 'main',
    headCommit: path.endsWith('wt') ? 'bbb' : 'aaa',
    baseCommit: path.endsWith('wt') ? 'aaa' : null,
    files,
  }
}
