import type { ConflictFinding } from '../types.js'
import { analyzedToFinding, type AnalyzedConflict } from './types.js'

export function reconcileConflictFindings(input: {
  readonly existing: readonly ConflictFinding[]
  readonly analyzed: readonly AnalyzedConflict[]
  readonly now: string
}): ConflictFinding[] {
  const existingByKey = new Map(
    input.existing.map((item) => [item.identityKey, item]),
  )
  const nextKeys = new Set(input.analyzed.map((item) => item.identityKey))
  const next: ConflictFinding[] = []

  for (const analyzed of input.analyzed) {
    const previous = existingByKey.get(analyzed.identityKey)
    if (!previous) {
      next.push(
        analyzedToFinding(analyzed, {
          status: 'open',
          detectedAt: input.now,
          updatedAt: input.now,
          resolvedAt: null,
        }),
      )
      continue
    }

    const sameEvidence = previous.fingerprint === analyzed.fingerprint
    if (previous.status === 'acknowledged' && sameEvidence) {
      next.push(
        analyzedToFinding(analyzed, {
          status: 'acknowledged',
          detectedAt: previous.detectedAt,
          updatedAt: input.now,
          resolvedAt: null,
        }),
      )
      continue
    }
    if (previous.status === 'resolved') {
      next.push(
        analyzedToFinding(
          analyzed,
          sameEvidence
            ? {
                status: 'resolved',
                detectedAt: previous.detectedAt,
                updatedAt: input.now,
                resolvedAt: previous.resolvedAt ?? input.now,
              }
            : {
                status: 'open',
                detectedAt: previous.detectedAt,
                updatedAt: input.now,
                resolvedAt: null,
              },
        ),
      )
      continue
    }
    next.push(
      analyzedToFinding(analyzed, {
        status: previous.status,
        detectedAt: previous.detectedAt,
        updatedAt: input.now,
        resolvedAt: null,
      }),
    )
  }

  for (const previous of input.existing) {
    if (nextKeys.has(previous.identityKey)) {
      continue
    }
    if (previous.status === 'resolved') {
      next.push(previous)
      continue
    }
    next.push({
      ...previous,
      status: 'resolved',
      updatedAt: input.now,
      resolvedAt: previous.resolvedAt ?? input.now,
    })
  }

  return next.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return left.identityKey.localeCompare(right.identityKey)
  })
}

export function applyConflictTransition(
  finding: ConflictFinding,
  action: 'acknowledge' | 'resolve',
  now: string,
): ConflictFinding {
  if (action === 'resolve') {
    if (finding.status === 'resolved') {
      return finding
    }
    return {
      ...finding,
      status: 'resolved',
      updatedAt: now,
      resolvedAt: finding.resolvedAt ?? now,
    }
  }
  if (finding.status === 'resolved' || finding.status === 'acknowledged') {
    return finding
  }
  return {
    ...finding,
    status: 'acknowledged',
    updatedAt: now,
    resolvedAt: null,
  }
}
