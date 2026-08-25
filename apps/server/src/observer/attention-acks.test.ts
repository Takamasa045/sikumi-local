import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  omitAcknowledgedAttention,
  readAttentionAcks,
  writeAttentionAck,
} from './attention-acks.js'
import { buildControlPlaneSnapshot } from './control-plane.js'
import { NOW_ISO, NOW_MS, session } from './control-plane-fixtures.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('attention acknowledgements', () => {
  it('hides an acknowledged waiting item from the snapshot', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: NOW_ISO,
      now: NOW_MS,
      repositories: [{ id: 'repo-a', displayName: 'alpha' }],
      sessions: [
        session({
          id: 'codex-wait',
          source: 'codex',
          status: 'waiting-for-user',
          activity: 'waiting-for-user',
        }),
      ],
    })
    const waiting = snapshot.attention.find(
      (item) => item.kind === 'waiting-for-user',
    )
    expect(waiting).toBeDefined()
    const next = omitAcknowledgedAttention(snapshot, new Set([waiting!.id]))
    expect(next.attention).toEqual([])
    expect(next.repositories[0]?.waitingCount).toBe(0)
  })

  it('remembers acknowledgements in the data directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sikumi-acks-'))
    tempDirectories.push(directory)
    writeAttentionAck(directory, 'waiting:repo-a:codex')
    expect([...readAttentionAcks(directory)]).toEqual(['waiting:repo-a:codex'])
  })
})
