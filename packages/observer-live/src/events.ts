import {
  buildIdempotencyKey,
  createObserverEventId,
  nowIso,
  OBSERVER_SCHEMA_VERSION,
  type NormalizedObserverEvent,
} from '@sikumi-local/observer-core'
import type { LiveSighting } from './types.js'

export function liveSightingToEvent(
  sighting: LiveSighting,
  receivedAt = nowIso(),
): NormalizedObserverEvent {
  return {
    id: createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt: sighting.lastObservedAt,
    receivedAt,
    source: sighting.source,
    surface: sighting.surface,
    nativeEventType:
      sighting.kind === 'process' ? 'live.process' : 'live.session-file',
    normalizedType: 'activity.changed',
    externalSessionId: sighting.externalSessionId,
    externalTurnId: null,
    externalTaskId: null,
    externalSubagentId: null,
    cwd: sighting.cwd,
    repositoryId: sighting.repositoryId,
    worktreePath: sighting.cwd,
    branch: null,
    baseCommit: null,
    headCommit: null,
    actorKind: 'agent',
    activity: 'editing',
    resource: null,
    summary: sighting.title,
    attributionConfidence: sighting.attributionConfidence,
    ingestionMethod: sighting.ingestionMethod,
    idempotencyKey: buildIdempotencyKey({
      source: sighting.source,
      externalSessionId: sighting.externalSessionId,
      nativeEventType:
        sighting.kind === 'process' ? 'live.process' : 'live.session-file',
      occurredAt: sighting.lastObservedAt,
    }),
    payload: {
      origin: sighting.kind,
    },
  }
}
