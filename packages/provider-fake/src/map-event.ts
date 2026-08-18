import {
  artifactTypes,
  runActivityStates,
  type ArtifactType,
  type RunActivityState,
} from '@sikumi-local/core'
import {
  isCanonicalEventType,
  isApprovalDecision,
  type CanonicalEvent,
} from '@sikumi-local/provider-sdk'

export function mapFakeProcessEvent(
  runId: string,
  raw: Record<string, unknown>,
  occurredAt: string,
): CanonicalEvent | null {
  if (typeof raw.type !== 'string' || !isCanonicalEventType(raw.type)) {
    return null
  }

  const summary =
    typeof raw.summary === 'string' && raw.summary.length > 0
      ? raw.summary
      : defaultSummary(raw.type)

  switch (raw.type) {
    case 'run.state_changed':
      return {
        type: 'run.state_changed',
        runId,
        occurredAt,
        summary,
        state: asActivityState(raw.state),
      }
    case 'repository.read':
      return {
        type: 'repository.read',
        runId,
        occurredAt,
        summary,
        ...(typeof raw.path === 'string' ? { path: raw.path } : {}),
      }
    case 'web.search':
      return {
        type: 'web.search',
        runId,
        occurredAt,
        summary,
        ...(typeof raw.query === 'string' ? { query: raw.query } : {}),
      }
    case 'approval.requested':
      if (typeof raw.requestId !== 'string') {
        return null
      }
      return {
        type: 'approval.requested',
        runId,
        occurredAt,
        summary,
        requestId: raw.requestId,
        risk:
          raw.risk === 'low' ||
          raw.risk === 'medium' ||
          raw.risk === 'high' ||
          raw.risk === 'critical'
            ? raw.risk
            : 'medium',
      }
    case 'approval.resolved':
      if (
        typeof raw.requestId !== 'string' ||
        typeof raw.decision !== 'string' ||
        !isApprovalDecision(raw.decision)
      ) {
        return null
      }
      return {
        type: 'approval.resolved',
        runId,
        occurredAt,
        summary,
        requestId: raw.requestId,
        decision: raw.decision,
      }
    case 'artifact.created':
      return {
        type: 'artifact.created',
        runId,
        occurredAt,
        summary,
        artifactType: asArtifactType(raw.artifactType),
        title: typeof raw.title === 'string' ? raw.title : '成果',
      }
    default:
      return {
        type: raw.type,
        runId,
        occurredAt,
        summary,
      } as CanonicalEvent
  }
}

function defaultSummary(type: string): string {
  switch (type) {
    case 'run.started':
      return '仕事を始めます'
    case 'repository.read':
      return 'この工房の資料を読んでいます'
    case 'web.search':
      return '公式情報を探しています'
    case 'run.completed':
      return '調査が完了しました'
    case 'run.failed':
      return '調査を完了できませんでした'
    case 'run.cancelled':
      return '仕事を中止しました'
    default:
      return type
  }
}

function asActivityState(value: unknown): RunActivityState {
  if (
    typeof value === 'string' &&
    (runActivityStates as readonly string[]).includes(value)
  ) {
    return value as RunActivityState
  }
  return 'preparing'
}

function asArtifactType(value: unknown): ArtifactType {
  if (
    typeof value === 'string' &&
    (artifactTypes as readonly string[]).includes(value)
  ) {
    return value as ArtifactType
  }
  return 'report'
}
