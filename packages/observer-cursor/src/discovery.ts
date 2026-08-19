import { existsSync } from 'node:fs'
import {
  isHookEntryOurs,
  isPlainObject,
  readJsonObject,
  safeJoinUnderRoot,
} from '@sikumi-local/observer-core'
import { CURSOR_HOOKS_VERSION, CURSOR_REQUIRED_HOOK_EVENTS } from './events.js'

export type CursorHookOrigin = 'user-hooks-json' | 'repo-hooks-json'

export interface DiscoveredCursorHook {
  readonly origin: CursorHookOrigin
  readonly path: string
  readonly eventName: string
  readonly command: string | null
  readonly ours: boolean
}

export interface CursorDiscovery {
  readonly homeDir: string
  readonly repoDir: string | null
  readonly hooks: readonly DiscoveredCursorHook[]
  readonly ourHooks: readonly DiscoveredCursorHook[]
  readonly evidence: readonly string[]
  readonly schemaVersion: number | null
}

export function discoverCursorHooks(input: {
  readonly homeDir: string
  readonly repoDir?: string | null
  readonly hookCommandPath: string
}): CursorDiscovery {
  const hooks: DiscoveredCursorHook[] = []
  const evidence: string[] = []
  const userHooks = safeJoinUnderRoot(input.homeDir, '.cursor', 'hooks.json')
  const repoHooks = input.repoDir
    ? safeJoinUnderRoot(input.repoDir, '.cursor', 'hooks.json')
    : null
  let schemaVersion: number | null = null

  if (userHooks) {
    const read = readHooksJson(
      userHooks,
      'user-hooks-json',
      input.hookCommandPath,
    )
    hooks.push(...read.hooks)
    if (read.schemaVersion !== null) {
      schemaVersion = read.schemaVersion
    }
    if (existsSync(userHooks)) {
      evidence.push(`user hooks.json: ${userHooks}`)
    }
  }
  if (repoHooks) {
    const read = readHooksJson(
      repoHooks,
      'repo-hooks-json',
      input.hookCommandPath,
    )
    hooks.push(...read.hooks)
    if (schemaVersion === null && read.schemaVersion !== null) {
      schemaVersion = read.schemaVersion
    }
    if (existsSync(repoHooks)) {
      evidence.push(`repo hooks.json: ${repoHooks}`)
    }
  }

  const ourHooks = hooks.filter((hook) => hook.ours)
  if (ourHooks.length > 0) {
    evidence.push(`Sikumi Cursor Hook: ${ourHooks.length}件`)
  }
  if (schemaVersion !== null && schemaVersion !== CURSOR_HOOKS_VERSION) {
    evidence.push(`hooks.json version=${schemaVersion} は未検証です`)
  }
  evidence.push('Cursor Cloud Agent は初期対象外です')

  return {
    homeDir: input.homeDir,
    repoDir: input.repoDir ?? null,
    hooks,
    ourHooks,
    evidence,
    schemaVersion,
  }
}

export function missingCursorEvents(
  discovery: CursorDiscovery,
): readonly string[] {
  const present = new Set(discovery.ourHooks.map((hook) => hook.eventName))
  return CURSOR_REQUIRED_HOOK_EVENTS.filter((event) => !present.has(event))
}

function readHooksJson(
  path: string,
  origin: CursorHookOrigin,
  hookCommandPath: string,
): {
  readonly hooks: readonly DiscoveredCursorHook[]
  readonly schemaVersion: number | null
} {
  const parsed = readJsonObject(path)
  if (!parsed.ok) {
    return { hooks: [], schemaVersion: null }
  }
  const schemaVersion =
    typeof parsed.value.version === 'number' ? parsed.value.version : null
  if (!isPlainObject(parsed.value.hooks)) {
    return { hooks: [], schemaVersion }
  }
  const found: DiscoveredCursorHook[] = []
  for (const [eventName, entries] of Object.entries(parsed.value.hooks)) {
    if (!Array.isArray(entries)) {
      continue
    }
    for (const entry of entries) {
      found.push({
        origin,
        path,
        eventName,
        command: extractCommand(entry),
        ours: isHookEntryOurs(entry, hookCommandPath),
      })
    }
  }
  return { hooks: found, schemaVersion }
}

function extractCommand(entry: unknown): string | null {
  if (!isPlainObject(entry)) {
    return null
  }
  if (typeof entry.command === 'string' && entry.command.trim().length > 0) {
    return entry.command.trim()
  }
  if (Array.isArray(entry.hooks)) {
    for (const hook of entry.hooks) {
      const nested = extractCommand(hook)
      if (nested) {
        return nested
      }
    }
  }
  return null
}
