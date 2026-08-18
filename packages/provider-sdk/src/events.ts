import {
  isShikumiEventType,
  type ApprovalRisk,
  type ArtifactType,
  type RunActivityState,
  type ShikumiEventType,
} from '@sikumi-local/core'

export interface CanonicalEventBase {
  readonly type: ShikumiEventType
  readonly runId: string
  readonly occurredAt: string
  readonly summary: string
}

export interface RunStartedEvent extends CanonicalEventBase {
  readonly type: 'run.started'
}

export interface RunStateChangedEvent extends CanonicalEventBase {
  readonly type: 'run.state_changed'
  readonly state: RunActivityState
}

export interface RepositoryReadEvent extends CanonicalEventBase {
  readonly type: 'repository.read'
  readonly path?: string
}

export interface WebSearchEvent extends CanonicalEventBase {
  readonly type: 'web.search'
  readonly query?: string
}

export interface ToolStartedEvent extends CanonicalEventBase {
  readonly type: 'tool.started'
}

export interface ToolCompletedEvent extends CanonicalEventBase {
  readonly type: 'tool.completed'
}

export interface CommandStartedEvent extends CanonicalEventBase {
  readonly type: 'command.started'
}

export interface CommandCompletedEvent extends CanonicalEventBase {
  readonly type: 'command.completed'
}

export interface FileChangedEvent extends CanonicalEventBase {
  readonly type: 'file.changed'
}

export interface ApprovalRequestedEvent extends CanonicalEventBase {
  readonly type: 'approval.requested'
  readonly requestId: string
  readonly risk: ApprovalRisk
}

export interface ApprovalResolvedEvent extends CanonicalEventBase {
  readonly type: 'approval.resolved'
  readonly requestId: string
  readonly decision: 'approved' | 'denied'
}

export interface UserQuestionEvent extends CanonicalEventBase {
  readonly type: 'user.question'
}

export interface ArtifactCreatedEvent extends CanonicalEventBase {
  readonly type: 'artifact.created'
  readonly artifactType: ArtifactType
  readonly title: string
}

export interface UsageUpdatedEvent extends CanonicalEventBase {
  readonly type: 'usage.updated'
}

export interface RunCompletedEvent extends CanonicalEventBase {
  readonly type: 'run.completed'
}

export interface RunFailedEvent extends CanonicalEventBase {
  readonly type: 'run.failed'
}

export interface RunCancelledEvent extends CanonicalEventBase {
  readonly type: 'run.cancelled'
}

export type CanonicalEvent =
  | RunStartedEvent
  | RunStateChangedEvent
  | RepositoryReadEvent
  | WebSearchEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | CommandStartedEvent
  | CommandCompletedEvent
  | FileChangedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UserQuestionEvent
  | ArtifactCreatedEvent
  | UsageUpdatedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent

export function isTerminalEventType(type: ShikumiEventType): boolean {
  return (
    type === 'run.completed' ||
    type === 'run.failed' ||
    type === 'run.cancelled'
  )
}

export function isCanonicalEventType(value: string): value is ShikumiEventType {
  return isShikumiEventType(value)
}
