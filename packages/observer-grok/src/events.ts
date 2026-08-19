import type {
  ObserverActivity,
  ObserverNormalizedType,
} from '@sikumi-local/observer-core'

export const GROK_REQUIRED_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'PermissionRequest',
  'WorktreeCreate',
  'WorktreeRemove',
] as const

export type GrokHookEvent = (typeof GROK_REQUIRED_HOOK_EVENTS)[number]

export const GROK_TOOL_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
] as const

export const GROK_HOOK_COMMAND_NAME = 'sikumi-observer-grok.mjs'
export const GROK_PLUGIN_ID = 'sikumi-observer'
export const GROK_SUPPORTED_VERSION_RANGE = {
  min: '1.0.5',
  max: '1.0.5',
  label: '1.0.5',
} as const

export const GROK_TOML_BEGIN = '# sikumi-observer-begin'
export const GROK_TOML_END = '# sikumi-observer-end'
export const GROK_COMMAND_PLACEHOLDER = 'SIKUMI_OBSERVER_GROK_COMMAND'

export function isGrokHookEvent(value: string): value is GrokHookEvent {
  return (GROK_REQUIRED_HOOK_EVENTS as readonly string[]).includes(value)
}

export function matcherForGrokEvent(eventName: string): string | undefined {
  if ((GROK_TOOL_HOOK_EVENTS as readonly string[]).includes(eventName)) {
    return '*'
  }
  return undefined
}

export function canonicalizeGrokEventName(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'unknown'
  }
  const compact = trimmed.replace(/[._-]/g, '').toLowerCase()
  const aliases: Record<string, string> = {
    sessionstart: 'SessionStart',
    sessionend: 'SessionEnd',
    pretooluse: 'PreToolUse',
    posttooluse: 'PostToolUse',
    posttoolusefailure: 'PostToolUseFailure',
    subagentstart: 'SubagentStart',
    subagentstop: 'SubagentStop',
    stop: 'Stop',
    permissionrequest: 'PermissionRequest',
    worktreecreate: 'WorktreeCreate',
    worktreeremove: 'WorktreeRemove',
    userpromptsubmit: 'UserPromptSubmit',
  }
  return aliases[compact] ?? trimmed
}

export function mapGrokEvent(
  nativeEventType: string,
  toolName?: string | null,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
} {
  switch (canonicalizeGrokEventName(nativeEventType)) {
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
    case 'SubagentStart':
      return { normalizedType: 'subagent.started', activity: 'planning' }
    case 'SubagentStop':
      return { normalizedType: 'subagent.stopped', activity: 'completed' }
    case 'Stop':
      return { normalizedType: 'activity.changed', activity: 'completed' }
    case 'WorktreeCreate':
      return { normalizedType: 'worktree.created', activity: 'editing' }
    case 'WorktreeRemove':
      return { normalizedType: 'worktree.removed', activity: 'completed' }
    default:
      return mapUnknown(nativeEventType, toolName)
  }
}

function mapUnknown(
  nativeEventType: string,
  toolName?: string | null,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
} {
  const value = nativeEventType.toLowerCase()
  if (value.includes('fail') || value.includes('error')) {
    return { normalizedType: 'session.failed', activity: 'failed' }
  }
  if (value.includes('result') || value.includes('complete')) {
    return { normalizedType: 'task.completed', activity: 'completed' }
  }
  if (value.includes('permission') || value.includes('ask')) {
    return {
      normalizedType: 'permission.requested',
      activity: 'waiting-for-user',
    }
  }
  if (value.includes('subagent') && value.includes('start')) {
    return { normalizedType: 'subagent.started', activity: 'planning' }
  }
  if (value.includes('subagent')) {
    return { normalizedType: 'subagent.stopped', activity: 'completed' }
  }
  if (value.includes('worktree') && value.includes('remove')) {
    return { normalizedType: 'worktree.removed', activity: 'completed' }
  }
  if (value.includes('worktree')) {
    return { normalizedType: 'worktree.created', activity: 'editing' }
  }
  if (value.includes('session') && value.includes('end')) {
    return { normalizedType: 'session.ended', activity: 'completed' }
  }
  if (value.includes('session')) {
    return { normalizedType: 'session.started', activity: 'starting' }
  }
  return mapTool(toolName, value.includes('post') || value.includes('result'))
}

function mapTool(
  toolName: string | null | undefined,
  completed: boolean,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
} {
  const name = (toolName ?? '').toLowerCase()
  if (name === 'bash' || name === 'shell' || name.includes('command')) {
    return {
      normalizedType: completed ? 'command.completed' : 'command.started',
      activity: 'running-command',
    }
  }
  if (name.includes('read')) {
    return { normalizedType: 'file.read', activity: 'reading' }
  }
  if (
    name.includes('edit') ||
    name.includes('write') ||
    name.includes('apply') ||
    name.includes('patch')
  ) {
    return { normalizedType: 'file.changed', activity: 'editing' }
  }
  return { normalizedType: 'activity.changed', activity: 'unknown' }
}
