import { describe, expect, it } from 'vitest'
import { buildObservedWorks } from './situation.js'
import { buildAttentionItems, isRedConflict } from './attention.js'
import {
  adapter,
  claim,
  finding,
  NOW_MS,
  session,
  STALE_ISO,
} from './control-plane-fixtures.js'

describe('buildAttentionItems', () => {
  it('collapses waiting-for-user to the latest item per place and tool', () => {
    const sessions = [
      session({
        id: 'codex-old',
        source: 'codex',
        status: 'waiting-for-user',
        activity: 'waiting-for-user',
        lastObservedAt: '2026-08-25T02:40:00.000Z',
        title: '古い確認',
      }),
      session({
        id: 'codex-new',
        source: 'codex',
        status: 'waiting-for-user',
        activity: 'waiting-for-user',
        lastObservedAt: '2026-08-25T02:55:00.000Z',
        title: '新しい確認',
      }),
      session({
        id: 'cursor-wait',
        source: 'cursor',
        status: 'waiting-for-user',
        activity: 'waiting-for-user',
        lastObservedAt: '2026-08-25T02:50:00.000Z',
      }),
    ]
    const works = buildObservedWorks({ sessions, now: NOW_MS })
    const attention = buildAttentionItems({ works, sessions, now: NOW_MS })
    const waiting = attention.filter((item) => item.kind === 'waiting-for-user')
    expect(waiting).toHaveLength(2)
    expect(waiting.map((item) => item.source).sort()).toEqual(['codex', 'cursor'])
    expect(waiting.find((item) => item.source === 'codex')?.workIds).toEqual([
      'codex-new',
    ])
  })

  it('keeps stale-work yellow even when the clock has moved, and pairs it with lingering writes', () => {
    const sessions = [
      session({
        id: 'codex-stale',
        source: 'codex',
        status: 'stale',
        activity: 'idle',
        lastObservedAt: STALE_ISO,
      }),
    ]
    const works = buildObservedWorks({ sessions, now: NOW_MS })
    const clockOnly = buildAttentionItems({ works, sessions, now: NOW_MS })
    expect(clockOnly.filter((item) => item.kind === 'stale-work')).toEqual([
      expect.objectContaining({
        severity: 'yellow',
        title: '止まっている可能性があります',
      }),
    ])
    expect(clockOnly.some((item) => item.severity === 'red')).toBe(false)

    const lingering = buildAttentionItems({
      works,
      sessions,
      claims: [claim('codex-stale', 'src/auth.ts', STALE_ISO)],
      now: NOW_MS,
    })
    expect(lingering.filter((item) => item.kind === 'stale-work')).toEqual([
      expect.objectContaining({
        severity: 'yellow',
        title: '途中のまま残っています',
      }),
    ])
    expect(lingering.some((item) => item.severity === 'red')).toBe(false)
  })

  it('emits unknown-owner once as yellow and never as red', () => {
    const sessions = [
      session({
        id: 'git-a',
        source: 'git',
        attributionConfidence: 'inferred',
        title: '変更元不明の作業',
      }),
      session({
        id: 'git-b',
        source: 'git',
        attributionConfidence: 'unknown',
        lastObservedAt: STALE_ISO,
      }),
    ]
    const attention = buildAttentionItems({
      works: buildObservedWorks({ sessions, now: NOW_MS }),
      sessions,
      now: NOW_MS,
    })
    const unknown = attention.filter((item) => item.kind === 'unknown-owner')
    expect(unknown).toHaveLength(1)
    expect(unknown[0]?.severity).toBe('yellow')
    expect(unknown[0]?.title).toBe('誰の作業かまだ分かっていません')
    expect(unknown.some((item) => item.severity === 'red')).toBe(false)
  })

  it('does not raise unknown-owner when a named agent already owns the place', () => {
    const sessions = [
      session({ id: 'codex-a', source: 'codex' }),
      session({
        id: 'git-a',
        source: 'git',
        attributionConfidence: 'inferred',
      }),
    ]
    const attention = buildAttentionItems({
      works: buildObservedWorks({ sessions, now: NOW_MS }),
      sessions,
      now: NOW_MS,
    })
    expect(attention.some((item) => item.kind === 'unknown-owner')).toBe(false)
  })

  it('turns only evidenced same-file write conflicts with strong attribution red', () => {
    const red = finding({
      id: 'c-red',
      level: 'high',
      leftConfidence: 'verified',
      rightConfidence: 'correlated',
      evidenceKind: 'same-file',
    })
    const inferred = finding({
      id: 'c-inferred',
      level: 'critical',
      leftConfidence: 'inferred',
      rightConfidence: 'inferred',
    })
    const relatedOnly = finding({
      id: 'c-related',
      level: 'related',
      evidenceKind: 'same-directory',
    })
    expect(isRedConflict(red)).toBe(true)
    expect(isRedConflict(inferred)).toBe(false)
    expect(isRedConflict(relatedOnly)).toBe(false)

    const attention = buildAttentionItems({
      works: [],
      sessions: [],
      conflicts: [red, inferred, relatedOnly],
      now: NOW_MS,
    })
    expect(attention.filter((item) => item.kind === 'conflict')).toEqual([
      expect.objectContaining({
        id: 'conflict:c-red',
        severity: 'red',
      }),
    ])
  })

  it('does not warn red just because two agents share a repository', () => {
    const sessions = [
      session({ id: 'codex-a', source: 'codex' }),
      session({ id: 'cursor-a', source: 'cursor' }),
    ]
    const attention = buildAttentionItems({
      works: buildObservedWorks({ sessions, now: NOW_MS }),
      sessions,
      conflicts: [],
      now: NOW_MS,
    })
    expect(attention.some((item) => item.kind === 'conflict')).toBe(false)
    expect(attention.some((item) => item.severity === 'red')).toBe(false)
  })

  it('reports a degraded adapter as observer-degraded, not as a red conflict', () => {
    const attention = buildAttentionItems({
      works: [],
      sessions: [],
      adapters: [
        adapter({ source: 'codex', status: 'degraded', errors: ['hook timeout'] }),
      ],
      now: NOW_MS,
    })
    expect(attention.filter((item) => item.kind === 'observer-degraded')).toEqual([
      expect.objectContaining({
        source: 'codex',
        severity: 'orange',
        title: '観測が弱くなっています',
      }),
    ])
    expect(attention.some((item) => item.severity === 'red')).toBe(false)
  })
})
