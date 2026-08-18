import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '@sikumi-local/core'

export const FAKE_PROTOCOL_VARIANTS = [
  'supported',
  'unknown',
  'malformed',
] as const
export type FakeProtocolVariant = (typeof FAKE_PROTOCOL_VARIANTS)[number]

export const FAKE_SUPPORTED_PROTOCOL_VERSION = 1

export function resolveFakeProtocolFixture(
  variant: FakeProtocolVariant,
): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../fixtures/protocol',
    `${variant}.json`,
  )
}

export function loadFakeProtocolFixture(
  variant: FakeProtocolVariant,
): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolveFakeProtocolFixture(variant), 'utf8'),
  ) as Record<string, unknown>
}

export function assertSupportedFakeProtocol(value: unknown): number {
  if (!isPlainObject(value) || !('protocolVersion' in value)) {
    throw new AppError(
      'PROVIDER_CAPABILITY_MISMATCH',
      'Fake protocol response is malformed',
      409,
    )
  }
  const version = value.protocolVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new AppError(
      'PROVIDER_CAPABILITY_MISMATCH',
      'Fake protocol version is unsupported',
      409,
    )
  }
  if (version !== FAKE_SUPPORTED_PROTOCOL_VERSION) {
    throw new AppError(
      'PROVIDER_CAPABILITY_MISMATCH',
      `Fake protocol version ${version} is unsupported`,
      409,
    )
  }
  return version
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
