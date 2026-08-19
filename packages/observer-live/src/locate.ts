import type { AttributionConfidence } from '@sikumi-local/observer-core'
import {
  isBindableCwd,
  matchRegisteredPlace,
  uniqueMatchedPlace,
} from './match.js'
import type {
  LiveProcessRow,
  LiveSighting,
  RegisteredLiveRoot,
} from './types.js'

export function locateLiveProcess(input: {
  readonly process: LiveProcessRow
  readonly roots: readonly RegisteredLiveRoot[]
  readonly sessionCwds: readonly string[]
}): {
  readonly root: RegisteredLiveRoot
  readonly cwd: string
  readonly attributionConfidence: AttributionConfidence
} | null {
  const own = matchRegisteredPlace(input.process.cwd, input.roots)
  if (own && isBindableCwd(input.process.cwd)) {
    return {
      root: own.root,
      cwd: input.process.cwd!,
      attributionConfidence:
        own.kind === 'contained' ? 'verified' : 'correlated',
    }
  }

  const fromChildren = uniqueMatchedPlace(
    input.process.childCwds ?? [],
    input.roots,
  )
  if (fromChildren) {
    const cwd =
      (input.process.childCwds ?? []).find(
        (candidate) =>
          matchRegisteredPlace(candidate, input.roots)?.root.repositoryId ===
          fromChildren.root.repositoryId,
      ) ?? fromChildren.root.absolutePath
    return {
      root: fromChildren.root,
      cwd,
      attributionConfidence: 'correlated',
    }
  }

  const fromSessions = uniqueMatchedPlace(input.sessionCwds, input.roots)
  if (fromSessions) {
    const cwd =
      input.sessionCwds.find(
        (candidate) =>
          matchRegisteredPlace(candidate, input.roots)?.root.repositoryId ===
          fromSessions.root.repositoryId,
      ) ?? fromSessions.root.absolutePath
    return {
      root: fromSessions.root,
      cwd,
      attributionConfidence: 'correlated',
    }
  }

  return null
}

export function sightingFromLocatedProcess(input: {
  readonly process: LiveProcessRow
  readonly source: LiveSighting['source']
  readonly surface: LiveSighting['surface']
  readonly located: NonNullable<ReturnType<typeof locateLiveProcess>>
  readonly title: string | null
  readonly lastObservedAt: string
}): LiveSighting {
  return {
    source: input.source,
    surface: input.surface,
    kind: 'process',
    cwd: input.located.cwd,
    repositoryId: input.located.root.repositoryId,
    workspaceId: input.located.root.workspaceId,
    title: input.title,
    lastObservedAt: input.lastObservedAt,
    attributionConfidence: input.located.attributionConfidence,
    ingestionMethod: 'process-scan',
    externalSessionId: `live:${input.source}:${input.located.root.repositoryId}`,
    pid: input.process.pid,
  }
}
