import { createHash, randomUUID } from 'node:crypto'
import type { ObserverSourceId } from './types.js'

export function createObserverEventId(): string {
  return randomUUID()
}

export function buildIdempotencyKey(input: {
  readonly source: ObserverSourceId
  readonly externalSessionId?: string | null
  readonly nativeEventType: string
  readonly toolUseId?: string | null
  readonly occurredAt: string
  readonly resourcePath?: string | null
}): string {
  const material = [
    input.source,
    input.externalSessionId ?? '',
    input.nativeEventType,
    input.toolUseId ?? '',
    input.occurredAt,
    input.resourcePath ?? '',
  ].join('\0')
  return createHash('sha256').update(material).digest('hex').slice(0, 64)
}

export function nowIso(at: Date = new Date()): string {
  return at.toISOString()
}
