import type { ObserverSurface } from '@sikumi-local/observer-core'
import { basename } from 'node:path'
import type { LiveAgentSource } from './types.js'

const HELPER_MARKERS = [
  'helper',
  'crashpad',
  'gpu',
  'renderer',
  'plugin',
  'language server',
]

const TEST_PROCESS_MARKERS = [
  'fake-claude',
  'fake-codex',
  'fake-cli',
  'linger-child',
  '/fixtures/',
  '\\fixtures\\',
]

export function isIgnoredLiveHaystack(value: string): boolean {
  const haystack = value.toLowerCase().replaceAll('\\', '/')
  if (
    TEST_PROCESS_MARKERS.some((marker) =>
      haystack.includes(marker.replaceAll('\\', '/')),
    )
  ) {
    return true
  }
  return /(?:^|[/\s._-])(?:fake-|linger-)/.test(haystack)
}

export function identifyLiveAgent(input: {
  readonly command: string
  readonly args: string
}): { source: LiveAgentSource; surface: ObserverSurface } | null {
  const haystack = `${input.command} ${input.args}`.toLowerCase()
  if (HELPER_MARKERS.some((marker) => haystack.includes(marker))) {
    return null
  }
  if (haystack.includes('sikumi-observer')) {
    return null
  }
  if (isIgnoredLiveHaystack(`${input.command} ${input.args}`)) {
    return null
  }

  const tokens = [input.command, ...splitArgs(input.args)]
    .map((token) => basename(token.replaceAll('\\', '/')))
    .filter((token) => token.length > 0)

  for (const token of tokens) {
    const identified = identifyToken(token)
    if (identified) {
      return identified
    }
  }
  return null
}

function identifyToken(
  token: string,
): { source: LiveAgentSource; surface: ObserverSurface } | null {
  if (token === 'Cursor') {
    return { source: 'cursor', surface: 'ide' }
  }
  const exact = token.toLowerCase()
  if (exact.startsWith('fake-') || exact.startsWith('linger-')) {
    return null
  }
  if (exact === 'codex' || exact === 'codex-exec') {
    return { source: 'codex', surface: 'cli' }
  }
  if (exact === 'chatgpt') {
    return { source: 'codex', surface: 'desktop-app' }
  }
  if (exact === 'claude') {
    return { source: 'claude-code', surface: 'cli' }
  }
  if (exact === 'grok') {
    return { source: 'grok-build', surface: 'cli' }
  }
  if (exact === 'cursor-agent') {
    return { source: 'cursor', surface: 'cursor-agent' }
  }
  if (exact === 'cursor') {
    return { source: 'cursor', surface: 'cursor-cli' }
  }
  return null
}

function splitArgs(args: string): string[] {
  return args
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('-'))
}
