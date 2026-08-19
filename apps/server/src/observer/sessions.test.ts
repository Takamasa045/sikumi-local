import { describe, expect, it } from 'vitest'
import { projectInboundEvent } from '@sikumi-local/observer-core'
import { correlateRepository } from './sessions.js'

const repoA = {
  id: 'repo-a',
  workspaceId: 'ws-a',
  absolutePath: '/Users/example/project',
  displayName: 'project',
  currentBranch: 'main',
  readable: true,
}

describe('correlateRepository', () => {
  it('prefers a discovered linked worktree over a sibling prefix', () => {
    const linked = '/Users/example/.codex/worktrees/project-feature'
    const event = projectInboundEvent({
      source: 'cursor',
      nativeEventType: 'sessionStart',
      cwd: linked,
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    const matched = correlateRepository(event, [repoA], {
      'repo-a': [repoA.absolutePath, linked],
    })
    expect(matched?.repository.id).toBe('repo-a')
    expect(matched?.confidence).toBe('verified')

    const sibling = projectInboundEvent({
      source: 'cursor',
      nativeEventType: 'sessionStart',
      cwd: '/Users/example/project-other',
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    expect(correlateRepository(sibling, [repoA], { 'repo-a': [repoA.absolutePath] })).toBeNull()
  })
})
