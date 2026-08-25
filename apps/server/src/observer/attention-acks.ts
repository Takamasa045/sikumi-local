import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ControlPlaneSnapshot } from '@sikumi-local/observer-core'

export function attentionAckPath(dataDirectory: string): string {
  return join(dataDirectory, 'observer', 'attention-acks.json')
}

export function readAttentionAcks(dataDirectory: string): Set<string> {
  const path = attentionAckPath(dataDirectory)
  if (!existsSync(path)) {
    return new Set()
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { ids?: unknown }
    if (!Array.isArray(parsed.ids)) {
      return new Set()
    }
    return new Set(
      parsed.ids.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    )
  } catch {
    return new Set()
  }
}

export function writeAttentionAck(
  dataDirectory: string,
  id: string,
): Set<string> {
  const ids = readAttentionAcks(dataDirectory)
  ids.add(id)
  const path = attentionAckPath(dataDirectory)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ids: [...ids] }, null, 2)}\n`, 'utf8')
  return ids
}

export function omitAcknowledgedAttention(
  snapshot: ControlPlaneSnapshot,
  acks: ReadonlySet<string>,
): ControlPlaneSnapshot {
  if (acks.size === 0) {
    return snapshot
  }
  const attention = snapshot.attention.filter((item) => !acks.has(item.id))
  return {
    ...snapshot,
    attention,
    repositories: snapshot.repositories.map((repository) => {
      const repoAttention = repository.attention.filter(
        (item) => !acks.has(item.id),
      )
      return {
        ...repository,
        attention: repoAttention,
        waitingCount: repoAttention.filter(
          (item) => item.kind === 'waiting-for-user',
        ).length,
        staleCount: repoAttention.filter((item) => item.kind === 'stale-work')
          .length,
        conflictCount: repoAttention.filter((item) => item.kind === 'conflict')
          .length,
      }
    }),
  }
}
