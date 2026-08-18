import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '@sikumi-local/core'

export const CODEX_PROTOCOL_ID = 'codex-app-server'
export const CODEX_SUPPORTED_PROTOCOL_VERSIONS = [1] as const
export const CODEX_SUPPORTED_PROTOCOL_VERSION =
  CODEX_SUPPORTED_PROTOCOL_VERSIONS[0]
export type CodexProtocolVersion =
  (typeof CODEX_SUPPORTED_PROTOCOL_VERSIONS)[number]

export const CODEX_PROTOCOL_VARIANTS = [
  'supported',
  'unknown',
  'malformed',
  'future',
  'future-unknown',
] as const
export type CodexProtocolVariant = (typeof CODEX_PROTOCOL_VARIANTS)[number]

export interface CodexProtocolFixture {
  readonly id?: string
  readonly protocolVersion?: unknown
  readonly transport?: string
  readonly supported?: boolean
  readonly initializeResult?: Record<string, unknown>
  readonly notifications?: readonly {
    readonly method: string
    readonly params: unknown
  }[]
  readonly expectedEventTypes?: readonly string[]
}

const PROTOCOL_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/protocol',
)

export function assertSupportedCodexProtocol(
  value: unknown,
): CodexProtocolVersion {
  const version = extractProtocolVersion(value)
  if (
    version === CODEX_SUPPORTED_PROTOCOL_VERSION ||
    version === String(CODEX_SUPPORTED_PROTOCOL_VERSION)
  ) {
    return CODEX_SUPPORTED_PROTOCOL_VERSION
  }
  throw new AppError(
    'PROVIDER_CAPABILITY_MISMATCH',
    'Codex protocol version is not supported',
    409,
    { protocolVersion: version },
  )
}

export function assertWorkspaceCodexProtocol(cwd: string): void {
  const marker = join(cwd, '.sikumi-protocol-version')
  if (!existsSync(marker)) {
    return
  }
  const raw = readFileSync(marker, 'utf8').trim()
  assertSupportedCodexProtocol(/^\d+$/.test(raw) ? Number(raw) : raw)
}

export function resolveCodexProtocolFixture(name: string): string {
  const fileName = name.endsWith('.json') ? name : `${name}.json`
  return join(PROTOCOL_FIXTURE_DIR, fileName)
}

export function loadCodexProtocolFixture(name: string): CodexProtocolFixture {
  return JSON.parse(
    readFileSync(resolveCodexProtocolFixture(name), 'utf8'),
  ) as CodexProtocolFixture
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
