import { AppError } from './errors.js'

const FORBIDDEN_EVENT_KEYS = new Set([
  'reasoning',
  'thinking',
  'chain_of_thought',
  'chainOfThought',
])

const SECRET_VALUE_KEYS = new Set([
  'token',
  'accessToken',
  'access_token',
  'password',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
])

const MAX_PAYLOAD_DEPTH = 32

export function redactRemoteUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0) {
    return trimmed
  }

  return trimmed.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/@]+)@/i, '$1')
}

export function sanitizeEventPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeValue(payload, 0, new WeakSet())
  if (!isPlainObject(sanitized)) {
    throw new AppError('VALIDATION_FAILED', 'Event payload is invalid', 400)
  }
  return sanitized
}

export function payloadContainsSecrets(payload: unknown): boolean {
  return containsSecrets(payload, 0, new WeakSet())
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  assertSafeDepth(depth)

  if (value === null || typeof value !== 'object') {
    return value
  }

  assertAcyclic(value, seen)
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen))
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EVENT_KEYS.has(key) || SECRET_VALUE_KEYS.has(key)) {
      continue
    }
    sanitized[key] = sanitizeValue(child, depth + 1, seen)
  }
  return sanitized
}

function containsSecrets(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): boolean {
  assertSafeDepth(depth)

  if (value === null || typeof value !== 'object') {
    return false
  }

  assertAcyclic(value, seen)
  seen.add(value)

  if (Array.isArray(value)) {
    return value.some((item) => containsSecrets(item, depth + 1, seen))
  }

  return Object.entries(value).some(([key, child]) => {
    return SECRET_VALUE_KEYS.has(key) || containsSecrets(child, depth + 1, seen)
  })
}

function assertSafeDepth(depth: number): void {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new AppError('VALIDATION_FAILED', 'Event payload is too deep', 400)
  }
}

function assertAcyclic(value: object, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Event payload contains a cycle',
      400,
    )
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
