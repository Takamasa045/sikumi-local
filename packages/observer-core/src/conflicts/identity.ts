import { createHash } from 'node:crypto'
import type { ConflictSide } from './types.js'

export function actorKey(
  side: Pick<ConflictSide, 'sessionId' | 'worktreePath'>,
): string {
  if (side.sessionId) {
    return `s:${side.sessionId}`
  }
  if (side.worktreePath) {
    return `w:${side.worktreePath.replaceAll('\\', '/')}`
  }
  return 'unknown'
}

export function orderedSides<
  T extends Pick<ConflictSide, 'sessionId' | 'worktreePath'>,
>(left: T, right: T): readonly [T, T] {
  return actorKey(left) <= actorKey(right) ? [left, right] : [right, left]
}

export function conflictIdentityKey(
  repositoryId: string,
  left: Pick<ConflictSide, 'sessionId' | 'worktreePath'>,
  right: Pick<ConflictSide, 'sessionId' | 'worktreePath'>,
): string {
  const [first, second] = orderedSides(left, right)
  return `cnf:${repositoryId}:${actorKey(first)}:${actorKey(second)}`
}

export function conflictIdFromKey(identityKey: string): string {
  return createHash('sha256').update(identityKey).digest('hex').slice(0, 32)
}

export function conflictFingerprint(parts: readonly string[]): string {
  return createHash('sha256')
    .update([...parts].sort().join('\n'))
    .digest('hex')
    .slice(0, 32)
}

export function sameConflictActor(
  left: Pick<ConflictSide, 'sessionId' | 'worktreePath'>,
  right: Pick<ConflictSide, 'sessionId' | 'worktreePath'>,
): boolean {
  if (left.sessionId && right.sessionId) {
    return left.sessionId === right.sessionId
  }
  return actorKey(left) === actorKey(right)
}
