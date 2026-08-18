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
const MAX_REDACT_INPUT = 8_192

const KNOWN_SECRET_PREFIX = /\b(?:sk|xai)-[A-Za-z0-9_-]{8,}/g
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._\-+/=]+/gi
const SECRET_ASSIGNMENT =
  /\b(?:API[_-]?KEY|KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*\S+/gi

export function redactSensitiveText(value: string): string {
  const bounded =
    value.length > MAX_REDACT_INPUT ? value.slice(0, MAX_REDACT_INPUT) : value
  return bounded
    .replace(KNOWN_SECRET_PREFIX, (match) => {
      const prefix = match.startsWith('xai-') ? 'xai-' : 'sk-'
      return `${prefix}[redacted]`
    })
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(SECRET_ASSIGNMENT, (match) => {
      const name = match.split(/[=:]/, 1)[0]?.trim() ?? 'SECRET'
      return `${name}=[redacted]`
    })
}

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

export function textContainsSecrets(value: string): boolean {
  if (value.length === 0) {
    return false
  }
  const windowSize = MAX_REDACT_INPUT
  const step = Math.max(1, windowSize - 256)
  for (let index = 0; index < value.length; index += step) {
    const slice = value.slice(index, index + windowSize)
    if (redactSensitiveText(slice) !== slice) {
      return true
    }
  }
  return false
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  assertSafeDepth(depth)

  if (typeof value === 'string') {
    return redactSensitiveText(value)
  }

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

  if (typeof value === 'string') {
    const bounded =
      value.length > MAX_REDACT_INPUT ? value.slice(0, MAX_REDACT_INPUT) : value
    return redactSensitiveText(bounded) !== bounded
  }

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
