import { describe, expect, it } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import {
  GARDEN_ACTIVE_WINDOW_MS,
  UNKNOWN_GARDEN_WORK,
  canNameObservedDriver,
  describeGardenWork,
  isGenericWorkTitle,
  isUnknownActivity,
  shouldShowGardenDog,
  stationForTone,
} from './gardenState'

type SessionView = TodayOverview['repositories'][number]['sessions'][number]

const NOW = '2026-08-19T00:10:00.000Z'
const NOW_MS = Date.parse(NOW)

describe('shouldShowGardenDog', () => {
  it('shows a recently observed running session', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'run',
          source: 'codex',
          status: 'running',
          activity: 'working',
          lastObservedAt: '2026-08-19T00:08:00.000Z',
        }),
        NOW_MS,
      ),
    ).toBe(true)
  })

  it('shows a waiting session even if the last observation is a bit older', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'wait',
          source: 'claude-code',
          status: 'idle',
          activity: 'waiting-for-user',
          lastObservedAt: '2026-08-19T00:00:00.000Z',
        }),
        NOW_MS,
      ),
    ).toBe(true)
  })

  it('hides idle, stale, completed, and inferred sessions', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'idle',
          source: 'cursor',
          displayName: 'エージェントワークフローキッズ版',
          status: 'idle',
          activity: 'idle',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      shouldShowGardenDog(
        session({
          id: 'stale',
          source: 'codex',
          status: 'stale',
          activity: 'idle',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      shouldShowGardenDog(
        session({
          id: 'done',
          source: 'codex',
          status: 'completed',
          activity: 'completed',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      shouldShowGardenDog(
        session({
          id: 'guess',
          source: 'codex',
          status: 'running',
          activity: 'working',
          attributionConfidence: 'inferred',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
  })

  it('hides a running session that was last seen outside the short window', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'old',
          source: 'grok',
          status: 'active',
          activity: 'editing',
          lastObservedAt: new Date(
            NOW_MS - GARDEN_ACTIVE_WINDOW_MS - 1_000,
          ).toISOString(),
        }),
        NOW_MS,
      ),
    ).toBe(false)
  })
})

describe('describeGardenWork', () => {
  it('prefers a real title over boilerplate and the source name', () => {
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'codex',
          displayName: 'Codex',
          title: 'APIを直している',
        }),
        { displayName: 'alpha' },
      ),
    ).toBe('APIを直している')
  })

  it('uses a session name when the title is only a source template', () => {
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'cursor',
          displayName: 'ログイン画面の直し',
          title: 'Cursorの作業が始まりました',
        }),
        { displayName: 'alpha' },
      ),
    ).toBe('ログイン画面の直し')
  })

  it('falls back to the repository, then says the work is unknown', () => {
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'codex',
          displayName: 'Codex',
          title: 'Codexの作業が始まりました',
        }),
        { displayName: 'alpha' },
      ),
    ).toBe('alphaが対象です')
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'codex',
          displayName: 'Codex',
          title: 'Codexの様子が届きました',
        }),
        { displayName: '   ' },
      ),
    ).toBe(UNKNOWN_GARDEN_WORK)
  })

  it('treats source event templates as generic', () => {
    expect(isGenericWorkTitle('Codexの作業が始まりました')).toBe(true)
    expect(isGenericWorkTitle('Claude Codeの作業が終わりました')).toBe(true)
    expect(isGenericWorkTitle('Claude Codeがファイルを扱っています')).toBe(
      true,
    )
    expect(isGenericWorkTitle('Grok Buildが確認を待っています')).toBe(true)
    expect(isGenericWorkTitle('Codex')).toBe(true)
    expect(isGenericWorkTitle('Claude Code')).toBe(true)
    expect(isGenericWorkTitle('作業中')).toBe(true)
    expect(isGenericWorkTitle('APIを直している')).toBe(false)
  })
})

describe('canNameObservedDriver', () => {
  it('names a live observed session with a real job title', () => {
    expect(
      canNameObservedDriver(
        session({
          id: 'run',
          source: 'codex',
          title: 'APIを直している',
          status: 'running',
          activity: 'working',
          lastObservedAt: '2026-08-19T00:08:00.000Z',
        }),
        NOW_MS,
      ),
    ).toBe(true)
  })

  it('does not name git inferred, unknown activity, or source-name titles', () => {
    expect(
      canNameObservedDriver(
        session({
          id: 'git',
          source: 'git',
          title: '変更元不明の作業',
          attributionConfidence: 'inferred',
          activity: 'unknown',
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      canNameObservedDriver(
        session({
          id: 'unknown',
          source: 'claude-code',
          title: 'ログイン画面を直している',
          status: 'running',
          activity: 'unknown',
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      canNameObservedDriver(
        session({
          id: 'template',
          source: 'codex',
          title: 'Codexの作業が始まりました',
          status: 'running',
          activity: 'working',
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(isUnknownActivity('unknown')).toBe(true)
    expect(isUnknownActivity('working')).toBe(false)
  })
})

describe('stationForTone', () => {
  it('keeps live work on the ground stations, not the observatory', () => {
    expect(stationForTone('working')).toBe('workbench')
    expect(stationForTone('waiting')).toBe('waiting')
    expect(stationForTone('completed')).toBe('delivery')
    expect(stationForTone('observing')).toBe('rest')
  })
})

function session(
  partial: Partial<SessionView> & Pick<SessionView, 'id' | 'source'>,
): SessionView {
  return {
    displayName: partial.displayName ?? partial.source,
    status: 'idle',
    activity: 'idle',
    attributionConfidence: 'observed',
    title: '作業',
    lastObservedAt: NOW,
    lastObservedLabel: null,
    ...partial,
  }
}
