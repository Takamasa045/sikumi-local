import { describe, expect, it } from 'vitest'
import { refreshConflicts } from './conflicts.js'

describe('refreshConflicts', () => {
  it('skips merge-base when neither repository nor worktree path exists', () => {
    const upserted: unknown[] = []
    const store = {
      getRegisteredRepository() {
        return undefined
      },
      listExternalSessions() {
        return []
      },
      listResourceClaims() {
        return []
      },
      listConflicts() {
        return []
      },
      upsertConflict(finding: unknown) {
        upserted.push(finding)
      },
    }
    const next = refreshConflicts(
      store as never,
      'repo-missing',
      [
        {
          path: '',
          branch: null,
          headCommit: 'aaa',
          baseCommit: null,
          files: [
            {
              path: 'a.ts',
              previousPath: null,
              changeType: 'modified',
              addedLines: null,
              deletedLines: null,
              staged: false,
              untracked: false,
              category: 'code',
              label: 'modified',
              hash: null,
            },
          ],
        },
        {
          path: '',
          branch: null,
          headCommit: 'bbb',
          baseCommit: null,
          files: [
            {
              path: 'a.ts',
              previousPath: null,
              changeType: 'modified',
              addedLines: null,
              deletedLines: null,
              staged: false,
              untracked: false,
              category: 'code',
              label: 'modified',
              hash: null,
            },
          ],
        },
      ],
      '2026-08-19T00:00:00.000Z',
    )
    expect(Array.isArray(next)).toBe(true)
    expect(upserted.length).toBe(next.length)
  })
})
