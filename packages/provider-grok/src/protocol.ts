import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '@sikumi-local/core'

export const GROK_PROTOCOL_ID = 'grok-acp'
export const GROK_SUPPORTED_PROTOCOL_VERSIONS = [1] as const
export const GROK_SUPPORTED_PROTOCOL_VERSION =
  GROK_SUPPORTED_PROTOCOL_VERSIONS[0]
export type GrokProtocolVersion =
  (typeof GROK_SUPPORTED_PROTOCOL_VERSIONS)[number]

export const GROK_PROTOCOL_VARIANTS = [
  'supported',
  'unknown',
  'malformed',
  'future',
  'future-unknown',
] as const
export type GrokProtocolVariant = (typeof GROK_PROTOCOL_VARIANTS)[number]

export interface GrokProtocolFixture {
  readonly id?: string
  readonly protocolVersion?: unknown
  readonly transport?: string
  readonly supported?: boolean
  readonly initializeResult?: Record<string, unknown>
  readonly sessionUpdates?: readonly Record<string, unknown>[]
  readonly expectedEventTypes?: readonly string[]
}

const PROTOCOL_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/protocol',
)

export function assertSupportedGrokProtocol(
  value: unknown,
): GrokProtocolVersion {
  const version = extractProtocolVersion(value)
  if (
    version === GROK_SUPPORTED_PROTOCOL_VERSION ||
    version === String(GROK_SUPPORTED_PROTOCOL_VERSION)
  ) {
    return GROK_SUPPORTED_PROTOCOL_VERSION
  }
  throw new AppError(
    'PROVIDER_CAPABILITY_MISMATCH',
    'Grok ACP protocol version is not supported',
    409,
    { protocolVersion: version },
  )
}

export function assertWorkspaceGrokProtocol(cwd: string): void {
  const marker = join(cwd, '.sikumi-protocol-version')
  if (!existsSync(marker)) {
    return
  }
  const raw = readFileSync(marker, 'utf8').trim()
  assertSupportedGrokProtocol(/^\d+$/.test(raw) ? Number(raw) : raw)
}

export function resolveGrokProtocolFixture(name: string): string {
  const fileName = name.endsWith('.json') ? name : `${name}.json`
  return join(PROTOCOL_FIXTURE_DIR, fileName)
}

export function loadGrokProtocolFixture(name: string): GrokProtocolFixture {
  return JSON.parse(
    readFileSync(resolveGrokProtocolFixture(name), 'utf8'),
  ) as GrokProtocolFixture
}

function extractProtocolVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value === '1' ? 1 : value
  }
  if ('protocolVersion' in value) {
    return (value as { protocolVersion: unknown }).protocolVersion
  }
  return value
}
