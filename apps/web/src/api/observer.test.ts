import { describe, expect, it } from 'vitest'
import { todayOverviewSchema } from './observer'

const THREAD_ID = '0193c0de-5a11-7abc-9def-0123456789ab'

function overview(codexLaunchUrl: string | null | undefined) {
  return {
    generatedAt: '2026-08-19T00:00:00.000Z',
    repositoryCount: 1,
    activeRepositoryCount: 1,
    waitingCount: 0,
    conflictCount: 0,
    repositories: [
      {
        repositoryId: 'repo_a',
        workspaceId: 'ws_a',
        displayName: 'demo',
        available: true,
        gitAvailable: true,
        summary: '作業が続いています',
        changedFileCount: 0,
        lastChangedLabel: null,
        sessions: [
          {
            id: '11111111-2222-4333-8444-555555555555',
            source: 'codex',
            displayName: 'Codex',
            status: 'active',
            activity: 'editing',
            attributionConfidence: 'verified',
            title: 'APIを直している',
            lastObservedAt: '2026-08-19T00:00:00.000Z',
            lastObservedLabel: 'たった今',
            ...(codexLaunchUrl === undefined ? {} : { codexLaunchUrl }),
          },
        ],
        worktrees: [],
        conflicts: [],
        areas: [],
      },
    ],
  }
}

describe('todayOverviewSchema', () => {
  it('accepts a sanitized Codex launch URL', () => {
    expect(
      todayOverviewSchema.parse(overview(`codex://threads/${THREAD_ID}`))
        .repositories[0]?.sessions[0]?.codexLaunchUrl,
    ).toBe(`codex://threads/${THREAD_ID}`)
    expect(
      todayOverviewSchema.parse(overview(null)).repositories[0]?.sessions[0]
        ?.codexLaunchUrl,
    ).toBeNull()
  })

  it('rejects arbitrary, pid, and extra URI launch targets', () => {
    const rejected = [
      `javascript:${THREAD_ID}`,
      `https://example.test/threads/${THREAD_ID}`,
      `codex://threads/${THREAD_ID}?x=1`,
      `codex://threads/${THREAD_ID}#frag`,
      `live:codex:${THREAD_ID}`,
      `live:codex:repo-hataraki:pid:248`,
      THREAD_ID,
    ]
    for (const codexLaunchUrl of rejected) {
      expect(() =>
        todayOverviewSchema.parse(overview(codexLaunchUrl)),
      ).toThrow()
    }
  })
})
