import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '@sikumi-local/core'

export const CLAUDE_PROTOCOL_ID = 'claude-stream-json'
export const CLAUDE_SUPPORTED_PROTOCOL_VERSIONS = [1] as const
export const CLAUDE_SUPPORTED_PROTOCOL_VERSION =
  CLAUDE_SUPPORTED_PROTOCOL_VERSIONS[0]
export type ClaudeProtocolVersion =
  (typeof CLAUDE_SUPPORTED_PROTOCOL_VERSIONS)[number]

export const CLAUDE_PROTOCOL_VARIANTS = [
  'supported',
  'unknown',
  'malformed',
  'future',
  'future-unknown',
] as const
export type ClaudeProtocolVariant = (typeof CLAUDE_PROTOCOL_VARIANTS)[number]

export interface ClaudeProtocolFixture {
  readonly id?: string
  readonly protocolVersion?: unknown
  readonly transport?: string
  readonly supported?: boolean
  readonly initializeEvent?: Record<string, unknown>
  readonly events?: readonly Record<string, unknown>[]
  readonly expectedEventTypes?: readonly string[]
}

const PROTOCOL_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/protocol',
)

export function assertSupportedClaudeProtocol(
  value: unknown,
): ClaudeProtocolVersion {
  const version = extractProtocolVersion(value)
  if (
    version === CLAUDE_SUPPORTED_PROTOCOL_VERSION ||
    version === String(CLAUDE_SUPPORTED_PROTOCOL_VERSION)
  ) {
    return CLAUDE_SUPPORTED_PROTOCOL_VERSION
  }
  throw new AppError(
    'PROVIDER_CAPABILITY_MISMATCH',
    'Claude stream-json protocol version is not supported',
    409,
    { protocolVersion: version },
  )
}

export function assertWorkspaceClaudeProtocol(cwd: string): void {
  const marker = join(cwd, '.sikumi-protocol-version')
  if (!existsSync(marker)) {
    return
  }
  const raw = readFileSync(marker, 'utf8').trim()
  assertSupportedClaudeProtocol(/^\d+$/.test(raw) ? Number(raw) : raw)
}

export function resolveClaudeProtocolFixture(name: string): string {
  const fileName = name.endsWith('.json') ? name : `${name}.json`
  return join(PROTOCOL_FIXTURE_DIR, fileName)
}

export function loadClaudeProtocolFixture(name: string): ClaudeProtocolFixture {
  return JSON.parse(
    readFileSync(resolveClaudeProtocolFixture(name), 'utf8'),
  ) as ClaudeProtocolFixture
}

function extractProtocolVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value === '1' ? 1 : value
  }
  if ('protocolVersion' in value) {
    return (value as { protocolVersion: unknown }).protocolVersion
  }
  if ('protocol_version' in value) {
    return (value as { protocol_version: unknown }).protocol_version
  }
  return value
}
