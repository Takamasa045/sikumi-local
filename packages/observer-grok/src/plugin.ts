import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatJson, quoteTomlString } from '@sikumi-local/observer-core'
import {
  GROK_COMMAND_PLACEHOLDER,
  GROK_PLUGIN_ID,
  GROK_REQUIRED_HOOK_EVENTS,
  GROK_TOML_BEGIN,
  GROK_TOML_END,
  matcherForGrokEvent,
} from './events.js'

export function resolveGrokPluginSourceDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../plugin')
}

export function renderGrokPluginManifest(): string {
  const source = join(resolveGrokPluginSourceDir(), 'plugin.json')
  try {
    const parsed = JSON.parse(readFileSync(source, 'utf8')) as unknown
    return formatJson(stripUnverifiedManifestFields(parsed))
  } catch {
    return formatJson({
      name: GROK_PLUGIN_ID,
      displayName: 'Sikumi Observer',
      version: '0.1.0',
      description:
        'Reports local Grok Build activity metadata to Sikumi-local. Does not start, stop, or control Grok. Plugin or config presence alone is not a ready signal.',
    })
  }
}

export function renderGrokHooksJson(command: string): string {
  return formatJson({
    description:
      'Reports local Grok Build activity metadata to Sikumi-local. Plugin or config presence is not a ready signal.',
    hooks: renderGrokHooksObject(command),
  })
}

export function renderGrokHooksToml(command: string): string {
  const lines = [
    GROK_TOML_BEGIN,
    '# Sikumi Observer metadata hook. Presence is not a ready signal.',
  ]
  for (const eventName of GROK_REQUIRED_HOOK_EVENTS) {
    const matcher = matcherForGrokEvent(eventName)
    lines.push(`[[hooks.${eventName}]]`)
    if (matcher) {
      lines.push(`matcher = "${matcher}"`)
    }
    lines.push(
      `  [[hooks.${eventName}.hooks]]`,
      '  type = "command"',
      `  command = ${quoteTomlString(command)}`,
      '',
    )
  }
  lines.push(GROK_TOML_END)
  return `${lines.join('\n')}\n`
}

export function mergeGrokToml(
  existing: string | null,
  command: string,
): string {
  const block = renderGrokHooksToml(command).trimEnd()
  if (!existing || existing.trim().length === 0) {
    return `${block}\n`
  }
  if (hasSikumiTomlMarkers(existing)) {
    return finalizeToml(replaceSikumiTomlBlock(existing, block))
  }
  const withoutLegacy = stripLegacySikumiHookTables(existing, command)
  if (withoutLegacy.trim().length === 0) {
    return `${block}\n`
  }
  return finalizeToml(`${withoutLegacy.replace(/\s+$/, '')}\n\n${block}`)
}

export function stripSikumiToml(existing: string, command: string): string {
  const withoutMarkers = hasSikumiTomlMarkers(existing)
    ? removeSikumiTomlBlock(existing)
    : existing
  return finalizeToml(stripLegacySikumiHookTables(withoutMarkers, command))
}

export function parseGrokHooksToml(
  text: string,
): readonly ParsedGrokTomlHook[] {
  const found: ParsedGrokTomlHook[] = []
  for (const group of collectTomlHookGroups(text)) {
    if (group.kind !== 'hooks') {
      continue
    }
    found.push({
      eventName: group.eventName,
      command: group.command,
      matcher: group.matcher,
      type: group.type,
    })
  }
  return found
}

export interface ParsedGrokTomlHook {
  readonly eventName: string
  readonly command: string | null
  readonly matcher: string | null
  readonly type: string | null
}

function renderGrokHooksObject(command: string): Record<string, unknown> {
  const hooks: Record<string, unknown> = {}
  for (const eventName of GROK_REQUIRED_HOOK_EVENTS) {
    const matcher = matcherForGrokEvent(eventName)
    hooks[eventName] = [
      {
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: 'command', command }],
      },
    ]
  }
  return hooks
}

function stripUnverifiedManifestFields(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      name: GROK_PLUGIN_ID,
      displayName: 'Sikumi Observer',
      version: '0.1.0',
    }
  }
  const next = { ...(value as Record<string, unknown>) }
  delete next.trustRequired
  delete next.trusted
  return next
}

function hasSikumiTomlMarkers(existing: string): boolean {
  return existing.includes(GROK_TOML_BEGIN) && existing.includes(GROK_TOML_END)
}

function replaceSikumiTomlBlock(existing: string, block: string): string {
  return existing.replace(sikumiBlockPattern(), block.trimEnd())
}

function removeSikumiTomlBlock(existing: string): string {
  return existing.replace(sikumiBlockPattern(), '')
}

function sikumiBlockPattern(): RegExp {
  return new RegExp(
    `${escapeRegExp(GROK_TOML_BEGIN)}[\\s\\S]*?${escapeRegExp(GROK_TOML_END)}`,
    'g',
  )
}

function stripLegacySikumiHookTables(text: string, command: string): string {
  if (!text.includes(command) && !text.includes(GROK_COMMAND_PLACEHOLDER)) {
    return text
  }
  const firstTable = text.search(/^\[\[/m)
  if (firstTable < 0) {
    return text
  }
  const preamble = text.slice(0, firstTable)
  const kept: string[] = []
  for (const group of collectTomlTableGroups(text.slice(firstTable))) {
    if (group.kind === 'hooks' && commandMatchesOurs(group.command, command)) {
      continue
    }
    kept.push(group.raw)
  }
  return `${preamble}${kept.join('')}`
}

function commandMatchesOurs(actual: string | null, command: string): boolean {
  return actual === command || actual === GROK_COMMAND_PLACEHOLDER
}

interface TomlTableGroup {
  readonly kind: 'hooks' | 'other'
  readonly eventName: string
  readonly command: string | null
  readonly matcher: string | null
  readonly type: string | null
  readonly raw: string
}

function collectTomlHookGroups(text: string): readonly TomlTableGroup[] {
  const firstTable = text.search(/^\[\[/m)
  if (firstTable < 0) {
    return []
  }
  return collectTomlTableGroups(text.slice(firstTable)).filter(
    (group) => group.kind === 'hooks',
  )
}

function collectTomlTableGroups(tableText: string): TomlTableGroup[] {
  const tables = tableText.split(/(?=^\[\[)/m).filter((part) => part.length > 0)
  const groups: TomlTableGroup[] = []
  for (const table of tables) {
    const header = table.match(/^\[\[([^\]]+)\]\]/)?.[1] ?? ''
    const inner = header.match(/^hooks\.([A-Za-z0-9_]+)\.hooks$/)
    const outer = header.match(/^hooks\.([A-Za-z0-9_]+)$/)
    if (inner && groups.length > 0) {
      const previous = groups[groups.length - 1]!
      if (
        previous.kind === 'hooks' &&
        previous.eventName ===
          canonicalizeTableEventName(inner[1] ?? 'unknown', null)
      ) {
        groups[groups.length - 1] = mergeTomlGroup(previous, table)
        continue
      }
    }
    if (outer) {
      const eventField = readTomlQuoted(table, 'event')
      groups.push({
        kind: 'hooks',
        eventName: canonicalizeTableEventName(
          outer[1] ?? 'unknown',
          eventField,
        ),
        command: readTomlQuoted(table, 'command'),
        matcher: readTomlQuoted(table, 'matcher'),
        type: readTomlQuoted(table, 'type'),
        raw: table,
      })
      continue
    }
    groups.push({
      kind: 'other',
      eventName: header || 'unknown',
      command: readTomlQuoted(table, 'command'),
      matcher: readTomlQuoted(table, 'matcher'),
      type: readTomlQuoted(table, 'type'),
      raw: table,
    })
  }
  return groups
}

function mergeTomlGroup(
  previous: TomlTableGroup,
  table: string,
): TomlTableGroup {
  return {
    ...previous,
    command: readTomlQuoted(table, 'command') ?? previous.command,
    matcher: readTomlQuoted(table, 'matcher') ?? previous.matcher,
    type: readTomlQuoted(table, 'type') ?? previous.type,
    raw: `${previous.raw}${table}`,
  }
}

function canonicalizeTableEventName(
  tableName: string,
  eventField: string | null,
): string {
  if (tableName === 'Event') {
    return eventField && eventField.length > 0 ? eventField : 'unknown'
  }
  return tableName
}

function readTomlQuoted(text: string, key: string): string | null {
  const line = text.match(
    new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"\\s*$`, 'm'),
  )
  if (line?.[1]?.trim()) {
    return line[1].trim()
  }
  const inline = text.match(
    new RegExp(`(?:^|[\\s{,])${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, 'm'),
  )
  const value = inline?.[1]?.trim()
  return value && value.length > 0 ? value : null
}

function finalizeToml(text: string): string {
  if (text.trim().length === 0) {
    return ''
  }
  return `${text.replace(/\s+$/, '')}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
