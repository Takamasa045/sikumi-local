import type {
  ObserverActivity,
  ObserverNormalizedType,
} from '@sikumi-local/observer-core'

/** Design 15.2 initial required / install-target events. Official extras such as Setup are accepted as unknown future, not required. */
export const CLAUDE_CODE_REQUIRED_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'TeammateIdle',
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
] as const

export const CLAUDE_CODE_HOOK_EVENTS = CLAUDE_CODE_REQUIRED_HOOK_EVENTS
export type ClaudeCodeHookEvent = (typeof CLAUDE_CODE_HOOK_EVENTS)[number]
export const CLAUDE_CODE_HOOK_COMMAND_NAME = 'sikumi-observer-claude-code.mjs'

export const CLAUDE_CODE_TOOL_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
] as const

export function isClaudeCodeHookEvent(
  value: string,
): value is ClaudeCodeHookEvent {
  return (CLAUDE_CODE_HOOK_EVENTS as readonly string[]).includes(value)
}

export function matcherForEvent(eventName: string): string | undefined {
  if ((CLAUDE_CODE_TOOL_EVENTS as readonly string[]).includes(eventName)) {
    return '*'
  }
  return undefined
}

export function matcherAllows(
  matcher: string | null | undefined,
  toolName: string | null,
): boolean {
  if (!matcher || matcher === '*') {
    return true
  }
  if (!toolName) {
    return false
  }
  const names = matcher.split('|').map((part) => part.trim().toLowerCase())
  return names.includes(toolName.toLowerCase())
}

export function mapClaudeCodeEvent(
  nativeEventType: string,
  toolName?: string | null,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
} {
  switch (nativeEventType) {
    case 'SessionStart':
      return { normalizedType: 'session.started', activity: 'starting' }
    case 'SessionEnd':
      return { normalizedType: 'session.ended', activity: 'completed' }
    case 'UserPromptSubmit':
      return { normalizedType: 'prompt.submitted', activity: 'planning' }
    case 'PreToolUse':
      return mapTool(toolName, false)
    case 'PostToolUse':
      return mapTool(toolName, true)
    case 'PostToolUseFailure':
      return { normalizedType: 'session.failed', activity: 'failed' }
    case 'PermissionRequest':
      return {
        normalizedType: 'permission.requested',
        activity: 'waiting-for-user',
      }
    case 'PermissionDenied':
      return { normalizedType: 'permission.resolved', activity: 'failed' }
    case 'Notification':
      return {
        normalizedType: 'user.input_required',
        activity: 'waiting-for-user',
      }
    case 'SubagentStart':
      return { normalizedType: 'subagent.started', activity: 'planning' }
    case 'SubagentStop':
      return { normalizedType: 'subagent.stopped', activity: 'completed' }
    case 'TaskCreated':
      return { normalizedType: 'task.created', activity: 'planning' }
    case 'TaskCompleted':
      return { normalizedType: 'task.completed', activity: 'completed' }
    case 'Stop':
      return { normalizedType: 'activity.changed', activity: 'completed' }
    case 'StopFailure':
      return { normalizedType: 'session.failed', activity: 'failed' }
    case 'TeammateIdle':
      return { normalizedType: 'heartbeat', activity: 'idle' }
    case 'CwdChanged':
      return { normalizedType: 'activity.changed', activity: 'unknown' }
    case 'DirectoryAdded':
      return { normalizedType: 'file.changed', activity: 'editing' }
    case 'FileChanged':
      return { normalizedType: 'file.changed', activity: 'editing' }
    case 'WorktreeCreate':
      return { normalizedType: 'worktree.created', activity: 'editing' }
    case 'WorktreeRemove':
      return { normalizedType: 'worktree.removed', activity: 'completed' }
    case 'PreCompact':
    case 'PostCompact':
      return { normalizedType: 'activity.changed', activity: 'reviewing' }
    default:
      return { normalizedType: 'activity.changed', activity: 'unknown' }
  }
}

function mapTool(
  toolName: string | null | undefined,
  completed: boolean,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
} {
  const name = (toolName ?? '').toLowerCase()
  if (name === 'bash' || name === 'shell') {
    return {
      normalizedType: completed ? 'command.completed' : 'command.started',
      activity: 'running-command',
    }
  }
  if (name === 'read' || name.includes('read')) {
    return { normalizedType: 'file.read', activity: 'reading' }
  }
  if (
    name === 'edit' ||
    name === 'write' ||
    name === 'multiedit' ||
    name.includes('edit') ||
    name.includes('write')
  ) {
    return { normalizedType: 'file.changed', activity: 'editing' }
  }
  return { normalizedType: 'activity.changed', activity: 'unknown' }
}
