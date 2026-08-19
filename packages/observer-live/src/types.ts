import type {
  AttributionConfidence,
  IngestionMethod,
  ObserverSourceId,
  ObserverSurface,
} from '@sikumi-local/observer-core'

export const liveAgentSources = [
  'codex',
  'claude-code',
  'cursor',
  'grok-build',
] as const
export type LiveAgentSource = (typeof liveAgentSources)[number]

export type LiveSightingKind = 'process' | 'session-file'

export interface RegisteredLiveRoot {
  readonly repositoryId: string
  readonly workspaceId: string
  readonly absolutePath: string
}

export interface LiveProcessRow {
  readonly pid: number
  readonly user: string
  readonly command: string
  readonly args: string
  readonly cwd: string | null
  readonly ppid?: number | null
  readonly childCwds?: readonly string[]
}

export interface LiveSighting {
  readonly source: LiveAgentSource
  readonly surface: ObserverSurface
  readonly kind: LiveSightingKind
  readonly cwd: string
  readonly repositoryId: string
  readonly workspaceId: string
  readonly title: string | null
  readonly lastObservedAt: string
  readonly attributionConfidence: AttributionConfidence
  readonly ingestionMethod: IngestionMethod
  readonly externalSessionId: string
  readonly pid: number | null
}

export interface LiveDiscoveryInput {
  readonly roots: readonly RegisteredLiveRoot[]
  readonly homeDir: string
  readonly currentUser: string
  readonly now?: number
  readonly listProcesses?: () => readonly LiveProcessRow[]
}

export function isLiveAgentSource(
  value: ObserverSourceId,
): value is LiveAgentSource {
  return (liveAgentSources as readonly string[]).includes(value)
}
