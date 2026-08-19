import { existsSync } from 'node:fs'
import {
  isHookEntryOurs,
  isPlainObject,
  readJsonObject,
  safeJoinUnderRoot,
} from '@sikumi-local/observer-core'
import { CLAUDE_CODE_REQUIRED_HOOK_EVENTS } from './events.js'

export interface DiscoveredClaudeHook {
  readonly path: string
  readonly eventName: string
  readonly matcher: string | null
  readonly ours: boolean
}

export interface ClaudeCodeDiscovery {
  readonly settingsPaths: readonly string[]
  readonly hooks: readonly DiscoveredClaudeHook[]
  readonly ourHooks: readonly DiscoveredClaudeHook[]
  readonly evidence: readonly string[]
}

export function discoverClaudeCodeHooks(input: {
  readonly homeDir: string
  readonly repoDir?: string | null
  readonly hookCommandPath: string
}): ClaudeCodeDiscovery {
  const paths = [
    safeJoinUnderRoot(input.homeDir, '.claude', 'settings.json'),
    input.repoDir
      ? safeJoinUnderRoot(input.repoDir, '.claude', 'settings.local.json')
      : null,
    input.repoDir
      ? safeJoinUnderRoot(input.repoDir, '.claude', 'settings.json')
      : null,
  ].filter((path): path is string => path !== null)

  const hooks: DiscoveredClaudeHook[] = []
  const evidence: string[] = []
  for (const path of paths) {
    if (!existsSync(path)) {
      continue
    }
    evidence.push(path)
    hooks.push(...readSettingsHooks(path, input.hookCommandPath))
  }
  const ourHooks = hooks.filter((hook) => hook.ours)
  if (ourHooks.length > 0) {
    evidence.push(`Sikumi Claude Code Hook: ${ourHooks.length}件`)
  }
  return {
    settingsPaths: paths.filter((path) => existsSync(path)),
    hooks,
    ourHooks,
    evidence,
  }
}

export function missingClaudeCodeEvents(
  discovery: ClaudeCodeDiscovery,
): readonly string[] {
  const present = new Set(discovery.ourHooks.map((hook) => hook.eventName))
  return CLAUDE_CODE_REQUIRED_HOOK_EVENTS.filter((event) => !present.has(event))
}

function readSettingsHooks(
  path: string,
  hookCommandPath: string,
): DiscoveredClaudeHook[] {
  const parsed = readJsonObject(path)
  if (!parsed.ok || !isPlainObject(parsed.value.hooks)) {
    return []
  }
  const found: DiscoveredClaudeHook[] = []
  for (const [eventName, entries] of Object.entries(parsed.value.hooks)) {
    if (!Array.isArray(entries)) {
      continue
    }
    for (const entry of entries) {
      found.push({
        path,
        eventName,
        matcher:
          isPlainObject(entry) && typeof entry.matcher === 'string'
            ? entry.matcher
            : null,
        ours: isHookEntryOurs(entry, hookCommandPath),
      })
    }
  }
  return found
}
