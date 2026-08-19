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
  if (exact === 'codex' || exact === 'codex-exec') {
    return { source: 'codex', surface: 'cli' }
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
