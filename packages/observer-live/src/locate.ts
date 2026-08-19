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

export function declaredWorkspaceCwd(
  args: string | null | undefined,
): string | null {
  if (!args) {
    return null
  }
  const match = args.match(
    /(?:^|\s)(?:--cwd|--cd)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/,
  )
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
  return isBindableCwd(value) ? value : null
}

export function locateLiveProcess(input: {
  readonly process: LiveProcessRow
  readonly roots: readonly RegisteredLiveRoot[]
  readonly sessionCwds: readonly string[]
}): {
  readonly root: RegisteredLiveRoot
  readonly cwd: string
  readonly attributionConfidence: AttributionConfidence
} | null {
  const declared = declaredWorkspaceCwd(input.process.args)
  const bound = firstBoundPlace([declared, input.process.cwd], input.roots)
  if (bound) {
    return bound
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

function firstBoundPlace(
  candidates: readonly (string | null | undefined)[],
  roots: readonly RegisteredLiveRoot[],
): {
  readonly root: RegisteredLiveRoot
  readonly cwd: string
  readonly attributionConfidence: AttributionConfidence
} | null {
  for (const candidate of candidates) {
    if (!isBindableCwd(candidate)) {
      continue
    }
    const matched = matchRegisteredPlace(candidate, roots)
    if (!matched) {
      continue
    }
    return {
      root: matched.root,
      cwd: candidate!,
      attributionConfidence:
        matched.kind === 'contained' ? 'verified' : 'correlated',
    }
  }
  return null
}

export function liveProcessExternalSessionId(
  source: LiveSighting['source'],
  repositoryId: string,
  pid: number,
): string {
  return `live:${source}:${repositoryId}:pid:${pid}`
}

export function isLiveProcessExternalSessionId(
  value: string | null | undefined,
): boolean {
  return typeof value === 'string' && /:pid:\d+$/.test(value)
}

export function sightingFromLocatedProcess(input: {
  readonly process: LiveProcessRow
  readonly source: LiveSighting['source']
  readonly surface: LiveSighting['surface']
  readonly located: NonNullable<ReturnType<typeof locateLiveProcess>>
  readonly title: string | null
  readonly lastObservedAt: string
  readonly activity?: LiveSighting['activity']
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
    externalSessionId: liveProcessExternalSessionId(
      input.source,
      input.located.root.repositoryId,
      input.process.pid,
    ),
    pid: input.process.pid,
    ...(input.activity ? { activity: input.activity } : {}),
  }
}
