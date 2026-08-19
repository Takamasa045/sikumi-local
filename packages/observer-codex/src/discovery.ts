import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  commandFromHookEntry,
  isHookEntryOurs,
  isInsideResolvedRoot,
  isPlainObject,
  readJsonObject,
  readTextIfExists,
  resolveExistingPathInside,
  safeJoinUnderRoot,
} from '@sikumi-local/observer-core'
import { CODEX_HOOK_EVENTS } from './events.js'

export type CodexHookOrigin =
  | 'user-hooks-json'
  | 'user-config-toml'
  | 'repo-hooks-json'
  | 'repo-config-toml'
  | 'plugin'

export interface DiscoveredCodexHook {
  readonly origin: CodexHookOrigin
  readonly path: string
  readonly eventName: string
  readonly command: string | null
  readonly ours: boolean
}

export interface CodexDiscovery {
  readonly homeDir: string
  readonly repoDir: string | null
  readonly hooks: readonly DiscoveredCodexHook[]
  readonly ourHooks: readonly DiscoveredCodexHook[]
  readonly evidence: readonly string[]
}

export function discoverCodexHooks(input: {
  readonly homeDir: string
  readonly repoDir?: string | null
  readonly hookCommandPath: string
}): CodexDiscovery {
  const hooks: DiscoveredCodexHook[] = []
  const evidence: string[] = []
  const userHooks = safeJoinUnderRoot(input.homeDir, '.codex', 'hooks.json')
  const userToml = safeJoinUnderRoot(input.homeDir, '.codex', 'config.toml')
  const repoHooks = input.repoDir
    ? safeJoinUnderRoot(input.repoDir, '.codex', 'hooks.json')
    : null
  const repoToml = input.repoDir
    ? safeJoinUnderRoot(input.repoDir, '.codex', 'config.toml')
    : null

  if (userHooks) {
    hooks.push(
      ...readHooksJson(userHooks, 'user-hooks-json', input.hookCommandPath),
    )
  }
  if (userToml) {
    hooks.push(
      ...readHooksToml(userToml, 'user-config-toml', input.hookCommandPath),
    )
  }
  if (repoHooks) {
    hooks.push(
      ...readHooksJson(repoHooks, 'repo-hooks-json', input.hookCommandPath),
    )
  }
  if (repoToml) {
    hooks.push(
      ...readHooksToml(repoToml, 'repo-config-toml', input.hookCommandPath),
    )
  }
  hooks.push(...readPluginHooks(input.homeDir, input.hookCommandPath))

  const ourHooks = hooks.filter((hook) => hook.ours)
  if (userHooks && existsSync(userHooks)) {
    evidence.push(`user hooks.json: ${userHooks}`)
  }
  if (userToml && existsSync(userToml)) {
    evidence.push(`user config.toml: ${userToml}`)
  }
  if (repoHooks && existsSync(repoHooks)) {
    evidence.push(`repo hooks.json: ${repoHooks}`)
  }
  if (repoToml && existsSync(repoToml)) {
    evidence.push(`repo config.toml: ${repoToml}`)
  }
  const pluginCount = hooks.filter((hook) => hook.origin === 'plugin').length
  if (pluginCount > 0) {
    evidence.push(`plugin hooks: ${pluginCount}件`)
  }
  if (ourHooks.length > 0) {
    evidence.push(`Sikumi Codex Hook: ${ourHooks.length}件`)
  }

  return {
    homeDir: input.homeDir,
    repoDir: input.repoDir ?? null,
    hooks,
    ourHooks,
    evidence,
  }
}

function readHooksJson(
  path: string,
  origin: CodexHookOrigin,
  hookCommandPath: string,
): DiscoveredCodexHook[] {
  const parsed = readJsonObject(path)
  if (!parsed.ok || !isPlainObject(parsed.value.hooks)) {
    return []
  }
  const found: DiscoveredCodexHook[] = []
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
  return found
}

function readHooksToml(
  path: string,
  origin: CodexHookOrigin,
  hookCommandPath: string,
): DiscoveredCodexHook[] {
  const text = readTextIfExists(path)
  if (!text) {
    return []
  }
  const found: DiscoveredCodexHook[] = []
  const eventPattern = /\[\[?hooks\.([A-Za-z0-9_]+)\]\]?/g
  const events = new Set<string>()
  for (const match of text.matchAll(eventPattern)) {
    if (match[1]) {
      events.add(match[1])
    }
  }
  const ours = text.includes(hookCommandPath)
  if (ours) {
    const names = events.size > 0 ? [...events] : ['unknown']
    for (const eventName of names) {
      found.push({
        origin,
        path,
        eventName,
        command: hookCommandPath,
        ours: true,
      })
    }
    return found
  }
  for (const eventName of events) {
    found.push({
      origin,
      path,
      eventName,
      command: null,
      ours: false,
    })
  }
  return found
}

function readPluginHooks(
  homeDir: string,
  hookCommandPath: string,
): DiscoveredCodexHook[] {
  const pluginsRoot = safeJoinUnderRoot(homeDir, '.codex', 'plugins')
  if (!pluginsRoot || !existsSync(pluginsRoot)) {
    return []
  }
  const found: DiscoveredCodexHook[] = []
  for (const name of safeReadDir(pluginsRoot, homeDir)) {
    const pluginDir = join(pluginsRoot, name)
    const hookFiles = [
      join(pluginDir, 'hooks.json'),
      join(pluginDir, '.codex-plugin', 'hooks.json'),
    ]
    for (const file of hookFiles) {
      if (!resolveExistingPathInside(file, homeDir) || !existsSync(file)) {
        continue
      }
      found.push(...readHooksJson(file, 'plugin', hookCommandPath))
    }
    found.push(...readPluginManifestHooks(pluginDir, homeDir, hookCommandPath))
  }
  return found
}

function readPluginManifestHooks(
  pluginDir: string,
  homeDir: string,
  hookCommandPath: string,
): DiscoveredCodexHook[] {
  const file = join(pluginDir, '.codex-plugin', 'plugin.json')
  if (!resolveExistingPathInside(file, homeDir) || !existsSync(file)) {
    return []
  }
  const parsed = readJsonObject(file)
  if (!parsed.ok || !isPlainObject(parsed.value.hooks)) {
    return []
  }
  return readHooksJson(file, 'plugin', hookCommandPath)
}

function extractCommand(entry: unknown): string | null {
  if (!isPlainObject(entry)) {
    return null
  }
  const direct = commandFromHookEntry(entry.command)
  if (direct) {
    return direct
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

function safeReadDir(directory: string, root: string): string[] {
  try {
    if (!isInsideResolvedRoot(directory, root)) {
      return []
    }
    return readdirSync(directory).filter((name) => {
      try {
        return statSync(join(directory, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

export function missingCodexEvents(
  discovery: CodexDiscovery,
): readonly string[] {
  const present = new Set(discovery.ourHooks.map((hook) => hook.eventName))
  return CODEX_HOOK_EVENTS.filter((event) => !present.has(event))
}
