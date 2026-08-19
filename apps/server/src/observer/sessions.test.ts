import { describe, expect, it } from 'vitest'
import { projectInboundEvent } from '@sikumi-local/observer-core'
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

describe('nextSessionStatus and correlateRepository edges', () => {
  it('matches by repositoryId, returns null without paths, and maps source confidence', () => {
    const byId = projectInboundEvent({
      source: 'cursor',
      nativeEventType: 'sessionStart',
      repositoryId: 'repo-a',
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    expect(correlateRepository(byId, [repoA])?.repository.id).toBe('repo-a')

    const missing = projectInboundEvent({
      source: 'cursor',
      nativeEventType: 'sessionStart',
      repositoryId: 'other',
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    expect(correlateRepository(missing, [repoA])).toBeNull()

    const gitEvent = projectInboundEvent({
      source: 'git',
      nativeEventType: 'status',
      cwd: repoA.absolutePath,
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    expect(correlateRepository(gitEvent, [repoA])?.confidence).toBe('inferred')

    const desktop = projectInboundEvent({
      source: 'claude-desktop',
      nativeEventType: 'sessionStart',
      cwd: repoA.absolutePath,
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    expect(correlateRepository(desktop, [repoA])?.confidence).toBe('reported')
  })

  it('maps session status transitions including heartbeat and default revive', () => {
    const ev = (normalizedType: string, source = 'cursor') =>
      projectInboundEvent({
        source,
        nativeEventType: normalizedType,
        normalizedType,
        occurredAt: '2026-08-18T00:00:00.000Z',
      })

    expect(nextSessionStatus(ev('session.started'))).toBe('active')
    expect(nextSessionStatus(ev('session.ended'))).toBe('ended')
    expect(nextSessionStatus(ev('session.ended', 'claude-desktop'))).toBe(
      'completed',
    )
    expect(nextSessionStatus(ev('session.failed'))).toBe('failed')
    expect(nextSessionStatus(ev('permission.requested'))).toBe(
      'waiting-for-user',
    )
    expect(nextSessionStatus(ev('user.input_required'))).toBe(
      'waiting-for-user',
    )
    expect(nextSessionStatus(ev('heartbeat'), 'waiting-for-user')).toBe(
      'waiting-for-user',
    )
    expect(nextSessionStatus(ev('heartbeat'), 'active')).toBe('idle')
    expect(nextSessionStatus(ev('task.completed'), 'active')).toBe('active')
    expect(nextSessionStatus(ev('task.completed'))).toBe('detected')
    expect(nextSessionStatus(ev('file.changed'), 'ended')).toBe('active')
    expect(nextSessionStatus(ev('file.changed'), 'detected')).toBe('active')
    expect(nextSessionStatus(ev('file.changed'), 'idle')).toBe('idle')
  })
})
