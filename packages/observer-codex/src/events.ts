import type {
  ObserverActivity,
  ObserverNormalizedType,
} from '@sikumi-local/observer-core'

export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'PreCompact',
  'PostCompact',
] as const
export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number]

export const CODEX_HOOK_COMMAND_NAME = 'sikumi-observer-codex.mjs'

export function isCodexHookEvent(value: string): value is CodexHookEvent {
  return (CODEX_HOOK_EVENTS as readonly string[]).includes(value)
}

export function mapCodexEvent(
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
      return mapToolEvent(toolName, false)
    case 'PostToolUse':
      return mapToolEvent(toolName, true)
    case 'PermissionRequest':
      return {
        normalizedType: 'permission.requested',
        activity: 'waiting-for-user',
      }
    case 'SubagentStart':
      return { normalizedType: 'subagent.started', activity: 'planning' }
    case 'SubagentStop':
      return { normalizedType: 'subagent.stopped', activity: 'completed' }
    case 'Stop':
      return { normalizedType: 'activity.changed', activity: 'completed' }
    case 'PreCompact':
    case 'PostCompact':
      return { normalizedType: 'activity.changed', activity: 'reviewing' }
    default:
      return { normalizedType: 'activity.changed', activity: 'unknown' }
  }
}

function mapToolEvent(
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
    name === 'apply_patch' ||
    name.includes('edit') ||
    name.includes('write') ||
    name.includes('patch')
  ) {
    return { normalizedType: 'file.changed', activity: 'editing' }
  }
  return { normalizedType: 'activity.changed', activity: 'unknown' }
}
