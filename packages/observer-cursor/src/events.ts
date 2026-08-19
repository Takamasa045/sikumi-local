import type {
  ObserverActivity,
  ObserverNormalizedType,
} from '@sikumi-local/observer-core'

/** Design 13.2 initial required / install-target events. Official extras are accepted as unknown future, not required. */
export const CURSOR_REQUIRED_HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeSubmitPrompt',
  'afterAgentResponse',
  'stop',
  'subagentStart',
  'subagentStop',
  'beforeTabFileRead',
  'afterTabFileEdit',
] as const

export const CURSOR_HOOK_EVENTS = CURSOR_REQUIRED_HOOK_EVENTS
export type CursorHookEvent = (typeof CURSOR_HOOK_EVENTS)[number]

export const CURSOR_KNOWN_EXTRA_EVENTS = [
  'beforeMCPExecution',
  'afterMCPExecution',
  'preCompact',
  'afterAgentThought',
  'workspaceOpen',
] as const

export const CURSOR_TAB_EVENTS = [
  'beforeTabFileRead',
  'afterTabFileEdit',
] as const

export const CURSOR_HOOK_COMMAND_NAME = 'sikumi-observer-cursor.mjs'
export const CURSOR_HOOKS_VERSION = 1
export const CURSOR_SUPPORTED_RANGE = 'Cursor Hooks 2026-08 version:1'

export function isCursorHookEvent(value: string): value is CursorHookEvent {
  return (CURSOR_HOOK_EVENTS as readonly string[]).includes(value)
}

export function isCursorTabEvent(value: string): boolean {
  return (CURSOR_TAB_EVENTS as readonly string[]).includes(value)
}

export function isCursorKnownExtraEvent(value: string): boolean {
  return (CURSOR_KNOWN_EXTRA_EVENTS as readonly string[]).includes(value)
}

export function mapCursorEvent(
  nativeEventType: string,
  toolName?: string | null,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
} {
  switch (nativeEventType) {
    case 'sessionStart':
    case 'workspaceOpen':
      return { normalizedType: 'session.started', activity: 'starting' }
    case 'sessionEnd':
      return { normalizedType: 'session.ended', activity: 'completed' }
    case 'beforeSubmitPrompt':
      return { normalizedType: 'prompt.submitted', activity: 'planning' }
    case 'preToolUse':
      return mapTool(toolName, false)
    case 'postToolUse':
      return mapTool(toolName, true)
    case 'postToolUseFailure':
      return { normalizedType: 'session.failed', activity: 'failed' }
    case 'beforeShellExecution':
      return { normalizedType: 'command.started', activity: 'running-command' }
    case 'afterShellExecution':
      return { normalizedType: 'command.completed', activity: 'running-command' }
    case 'beforeReadFile':
    case 'beforeTabFileRead':
      return { normalizedType: 'file.read', activity: 'reading' }
    case 'afterFileEdit':
    case 'afterTabFileEdit':
      return { normalizedType: 'file.changed', activity: 'editing' }
    case 'afterAgentResponse':
      return { normalizedType: 'activity.changed', activity: 'reviewing' }
    case 'stop':
      return { normalizedType: 'activity.changed', activity: 'completed' }
    case 'subagentStart':
      return { normalizedType: 'subagent.started', activity: 'planning' }
    case 'subagentStop':
      return { normalizedType: 'subagent.stopped', activity: 'completed' }
    case 'beforeMCPExecution':
    case 'afterMCPExecution':
      return { normalizedType: 'activity.changed', activity: 'unknown' }
    case 'preCompact':
      return { normalizedType: 'activity.changed', activity: 'reviewing' }
    case 'afterAgentThought':
      return { normalizedType: 'activity.changed', activity: 'planning' }
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
  if (name === 'bash' || name === 'shell' || name.includes('shell')) {
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
    name.includes('edit') ||
    name.includes('write') ||
    name.includes('apply')
  ) {
    return { normalizedType: 'file.changed', activity: 'editing' }
  }
  return { normalizedType: 'activity.changed', activity: 'unknown' }
}
