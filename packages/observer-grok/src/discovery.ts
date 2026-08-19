import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  isHookEntryOurs,
  isInsideResolvedRoot,
  isPlainObject,
  readJsonObject,
  readTextIfExists,
  safeJoinUnderRoot,
} from '@sikumi-local/observer-core'
import { GROK_PLUGIN_ID, GROK_REQUIRED_HOOK_EVENTS } from './events.js'
import { parseGrokHooksToml } from './plugin.js'

export type GrokHookOrigin =
  | 'user-config-toml'
  | 'user-managed-config-toml'
  | 'user-requirements-toml'
  | 'repo-config-toml'
  | 'repo-managed-config-toml'
  | 'repo-requirements-toml'
  | 'repo-hooks-dir'
  | 'plugin'

export interface DiscoveredGrokHook {
  readonly origin: GrokHookOrigin
  readonly path: string
  readonly eventName: string
  readonly command: string | null
  readonly ours: boolean
}

export interface GrokDiscovery {
  readonly homeDir: string
  readonly repoDir: string | null
  readonly hooks: readonly DiscoveredGrokHook[]
  readonly ourHooks: readonly DiscoveredGrokHook[]
  readonly pluginPaths: readonly string[]
  readonly evidence: readonly string[]
}

export function discoverGrokHooks(input: {
  readonly homeDir: string
  readonly repoDir?: string | null
  readonly hookCommandPath: string
}): GrokDiscovery {
  const hooks: DiscoveredGrokHook[] = []
  const evidence: string[] = []
  const pluginPaths: string[] = []

  const tomlTargets: Array<{
    readonly path: string | null
    readonly origin: GrokHookOrigin
  }> = [
    {
      path: safeJoinUnderRoot(input.homeDir, '.grok', 'config.toml'),
      origin: 'user-config-toml',
    },
    {
      path: safeJoinUnderRoot(input.homeDir, '.grok', 'managed_config.toml'),
      origin: 'user-managed-config-toml',
    },
    {
      path: safeJoinUnderRoot(input.homeDir, '.grok', 'requirements.toml'),
      origin: 'user-requirements-toml',
    },
  ]
  if (input.repoDir) {
    tomlTargets.push(
      {
        path: safeJoinUnderRoot(input.repoDir, '.grok', 'config.toml'),
        origin: 'repo-config-toml',
      },
      {
        path: safeJoinUnderRoot(input.repoDir, '.grok', 'managed_config.toml'),
        origin: 'repo-managed-config-toml',
      },
      {
        path: safeJoinUnderRoot(input.repoDir, '.grok', 'requirements.toml'),
        origin: 'repo-requirements-toml',
      },
    )
    const hooksDir = safeJoinUnderRoot(input.repoDir, '.grok', 'hooks')
    if (hooksDir && existsSync(hooksDir)) {
      evidence.push(`repo hooks dir: ${hooksDir}`)
      hooks.push(
        ...readHooksDirectory(
          hooksDir,
          input.repoDir,
          'repo-hooks-dir',
          input.hookCommandPath,
        ),
      )
    }
  }

  for (const target of tomlTargets) {
    if (!target.path || !existsSync(target.path)) {
      continue
    }
    evidence.push(`${target.origin}: ${target.path}`)
    hooks.push(
      ...readHooksToml(target.path, target.origin, input.hookCommandPath),
    )
  }

  for (const root of [
    safeJoinUnderRoot(input.homeDir, '.grok', 'plugins'),
    input.repoDir ? safeJoinUnderRoot(input.repoDir, '.grok', 'plugins') : null,
  ]) {
    if (!root || !existsSync(root)) {
      continue
    }
    for (const name of safeReadDir(root, root)) {
      const pluginDir = join(root, name)
      if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) {
        continue
      }
      pluginPaths.push(pluginDir)
      hooks.push(
        ...readHooksJsonFile(
          join(pluginDir, 'hooks', 'hooks.json'),
          'plugin',
          input.hookCommandPath,
        ),
      )
      hooks.push(
        ...readHooksToml(
          join(pluginDir, 'hooks.toml'),
          'plugin',
          input.hookCommandPath,
        ),
      )
    }
  }

  const ourHooks = hooks.filter((hook) => hook.ours)
  if (ourHooks.length > 0) {
    evidence.push(`Sikumi Grok Hook: ${ourHooks.length}件`)
  }
  if (pluginPaths.some((path) => path.includes(GROK_PLUGIN_ID))) {
    evidence.push('Sikumi plugin artifact が見つかりました')
  }
  evidence.push('ACP は Observer では使いません')

  return {
    homeDir: input.homeDir,
    repoDir: input.repoDir ?? null,
    hooks,
    ourHooks,
    pluginPaths,
    evidence,
  }
}

export function missingGrokEvents(discovery: GrokDiscovery): readonly string[] {
  const present = new Set(discovery.ourHooks.map((hook) => hook.eventName))
  return GROK_REQUIRED_HOOK_EVENTS.filter((event) => !present.has(event))
}

function readHooksToml(
  path: string,
  origin: GrokHookOrigin,
  hookCommandPath: string,
): DiscoveredGrokHook[] {
  const text = readTextIfExists(path)
  if (!text) {
    return []
  }
  return parseGrokHooksToml(text).map((hook) => ({
    origin,
    path,
    eventName: hook.eventName,
    command: hook.command,
    ours: hook.command === hookCommandPath,
  }))
}

function readHooksDirectory(
  directory: string,
  root: string,
  origin: GrokHookOrigin,
  hookCommandPath: string,
): DiscoveredGrokHook[] {
  const found: DiscoveredGrokHook[] = []
  for (const name of safeReadDir(directory, root)) {
    const file = join(directory, name)
    if (!existsSync(file) || !statSync(file).isFile()) {
      continue
    }
    if (name.endsWith('.toml')) {
      found.push(...readHooksToml(file, origin, hookCommandPath))
      continue
    }
    if (name.endsWith('.json')) {
      found.push(...readHooksJsonFile(file, origin, hookCommandPath))
    }
  }
  return found
}

function readHooksJsonFile(
  path: string,
  origin: GrokHookOrigin,
  hookCommandPath: string,
): DiscoveredGrokHook[] {
  const parsed = readJsonObject(path)
  if (!parsed.ok) {
    return []
  }
  const hooksObject = extractHooksObject(parsed.value)
  if (!hooksObject) {
    return []
  }
  const found: DiscoveredGrokHook[] = []
  for (const [eventName, entries] of Object.entries(hooksObject)) {
    if (!Array.isArray(entries)) {
      continue
    }
    for (const entry of entries) {
      found.push({
        origin,
        path,
        eventName,
        command: hookCommandPath,
        ours: isHookEntryOurs(entry, hookCommandPath),
      })
    }
  }
  return found
}

function extractHooksObject(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  if (isPlainObject(value.hooks)) {
    return value.hooks
  }
  const eventKeys = Object.keys(value).filter((key) =>
    /^[A-Z][A-Za-z0-9]+$/.test(key),
  )
  return eventKeys.length > 0 ? value : null
}

function safeReadDir(directory: string, root: string): string[] {
  try {
    if (!isInsideResolvedRoot(directory, root)) {
      return []
    }
    return readdirSync(directory).filter((name) => {
      try {
        return (
          statSync(join(directory, name)).isDirectory() || name.includes('.')
        )
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}
