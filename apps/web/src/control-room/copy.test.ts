import { describe, expect, it } from 'vitest'
import {
  everydayText,
  isForbiddenEveryday,
  placeNowText,
  relatedWorkSentence,
  summarizeControlPlane,
  toolLabel,
  workListText,
  workNextText,
  workNowText,
} from './copy'
import { sampleSnapshot } from './test-snapshot'

describe('control room copy', () => {
  it('uses everyday tool names and hides forbidden labels', () => {
    expect(toolLabel('codex', 'Codex')).toBe('Codex')
    expect(toolLabel('grok-build', 'Grok Build')).toBe('Grok')
    expect(toolLabel('claude-code', 'Claude Code')).toBe('Claude Code')
    expect(toolLabel('cursor', 'Cursor Agent')).toBe('Cursor')
    expect(toolLabel('git', '変更元不明')).toBeNull()
    expect(everydayText('Grok 2 が直している')).toBe('Grok が直している')
    expect(everydayText('fake-claude')).toBeNull()
    expect(everydayText('変更元不明の作業')).toBeNull()
    expect(everydayText('縁側で休む')).toBe('休む')
    expect(everydayText('a1b2c3d')).toBeNull()
    expect(isForbiddenEveryday('Grok 2')).toBe(true)
    expect(isForbiddenEveryday('変更元不明')).toBe(true)
  })

  it('summarizes running AIs, places, attention, and waiting', () => {
    const summary = summarizeControlPlane(sampleSnapshot())
    expect(summary.runningAiCount).toBe(2)
    expect(summary.placeCount).toBe(1)
    expect(summary.attentionCount).toBe(2)
    expect(summary.waitingCount).toBe(1)
  })

  it('says who is doing what without file names', () => {
    const snapshot = sampleSnapshot()
    const work = snapshot.works[0]!
    expect(workNowText(work)).toBe('Codexが、ログイン画面の直しをしています')
    expect(workListText(work)).toBe('Codexが、ログイン画面の直し')
    expect(workNowText(work)).not.toContain('src/auth.ts')
    expect(workNextText(work, snapshot.attention)).toBe(
      'ぶつからないか、先に見てください',
    )
    expect(placeNowText(snapshot.repositories[0]!)).toBe(
      'CodexとCursorが、同じ場所で動いています',
    )
    expect(relatedWorkSentence(work, snapshot.works)).toBe(
      '同じ場所で、Cursorもログイン画面の直しをしています',
    )
  })
})
