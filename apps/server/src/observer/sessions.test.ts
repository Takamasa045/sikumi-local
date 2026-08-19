import { describe, expect, it } from 'vitest'
import { projectInboundEvent } from '@sikumi-local/observer-core'
import { liveSightingToEvent } from '@sikumi-local/observer-live'
import { correlateRepository, nextSessionStatus } from './sessions.js'

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
    expect(
      correlateRepository(sibling, [repoA], { 'repo-a': [repoA.absolutePath] }),
    ).toBeNull()
  })
})

describe('nextSessionStatus', () => {
  it('revives a stale session when a live process is at the place', () => {
    expect(nextSessionStatus(liveProcessEvent(), 'stale')).toBe('active')
    expect(nextSessionStatus(liveProcessEvent(), 'detected')).toBe('active')
    expect(nextSessionStatus(liveProcessEvent(), 'ended')).toBe('active')
  })

  it('does not revive stale from a session file alone', () => {
    expect(nextSessionStatus(liveSessionFileEvent(), 'stale')).toBe('stale')
  })

  it('keeps a human wait even when the process is still alive', () => {
    expect(nextSessionStatus(liveProcessEvent(), 'waiting-for-user')).toBe(
      'waiting-for-user',
    )
  })

  it('keeps approval wait when a host process is only sitting at /', () => {
    expect(
      nextSessionStatus(
        { ...liveProcessEvent(), activity: 'waiting-for-user' },
        'stale',
      ),
    ).toBe('waiting-for-user')
  })

  it('does not treat a sitting live process as active work', () => {
    expect(
      nextSessionStatus({ ...liveProcessEvent(), activity: 'idle' }, 'active'),
    ).toBe('idle')
  })
})

function liveProcessEvent() {
  return liveSightingToEvent({
    source: 'grok-build',
    surface: 'cli',
    kind: 'process',
    cwd: '/Users/takamasa/Projects/hataraki',
    repositoryId: 'repo-hataraki',
    workspaceId: 'ws-hataraki',
    title: '作業中',
    lastObservedAt: '2026-08-19T00:10:00.000Z',
    attributionConfidence: 'verified',
    ingestionMethod: 'process-scan',
    externalSessionId: 'live:grok-build:repo-hataraki',
    pid: 42,
  })
}

function liveSessionFileEvent() {
  return liveSightingToEvent({
    source: 'grok-build',
    surface: 'cli',
    kind: 'session-file',
    cwd: '/Users/takamasa/Projects/hataraki',
    repositoryId: 'repo-hataraki',
    workspaceId: 'ws-hataraki',
    title: '作業中',
    lastObservedAt: '2026-08-19T00:10:00.000Z',
    attributionConfidence: 'correlated',
    ingestionMethod: 'session-file',
    externalSessionId: 'live:grok-build:sess-old',
    pid: null,
  })
}
