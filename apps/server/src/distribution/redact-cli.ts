import {
  redactRemoteUrl,
  redactSensitiveText,
  sanitizeEventPayload,
  textContainsSecrets,
} from '@sikumi-local/core'

const REASONING_KEYS = new Set([
  'reasoning',
  'thinking',
  'chain_of_thought',
  'chainOfThought',
])

const NON_FILE_URL = /\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi
const FILE_URL = /\bfile:\/\/[^\s"'`]+/gi
const EMBEDDED_POSIX = /(?:^|[\s"'`=])\/(?!\/)[^\s"'`]*/
const EMBEDDED_WINDOWS = /(?:^|[\s"'`=])[A-Za-z]:[\\/][^\s"'`]*/

export function hideSecrets(value: string): string {
  return redactSensitiveText(value)
    .replace(FILE_URL, '[redacted-path]')
    .replace(/(^|[\s"'`=])(\/(?!\/)[^\s"'`]+)/g, '$1[redacted-path]')
    .replace(/(^|[\s"'`=])([A-Za-z]:[\\/][^\s"'`]+)/g, '$1[redacted-path]')
}

export function hideSecretsInUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return hideSecrets(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => hideSecretsInUnknown(item))
  }
  if (value && typeof value === 'object') {
    try {
      return sanitizeEventPayload({ ...value } as Record<string, unknown>)
    } catch {
      return {}
    }
  }
  return value
}

export function portableValueLooksUnsafe(value: unknown): boolean {
  return inspectPortableValue(value, new WeakSet())
}

export function portableTextLooksUnsafe(value: string): boolean {
  try {
    return portableValueLooksUnsafe(JSON.parse(value))
  } catch {
    return stringLooksUnsafe(value)
  }
}

export function assertPortableValueIsSafe(value: unknown): void {
  if (portableValueLooksUnsafe(value)) {
    throw new Error(
      'Portable archive contains secrets, reasoning, or absolute paths',
    )
  }
}

export function stringContainsAbsoluteFilesystemPath(value: string): boolean {
  if (FILE_URL.test(value) || /^\s*file:/i.test(value)) {
    FILE_URL.lastIndex = 0
    return true
  }
  FILE_URL.lastIndex = 0
  const stripped = value.replace(NON_FILE_URL, ' ')
  NON_FILE_URL.lastIndex = 0
  return (
    EMBEDDED_POSIX.test(stripped) ||
    EMBEDDED_WINDOWS.test(stripped) ||
    /^\s*\/(?!\/)/.test(stripped) ||
    /^\s*[A-Za-z]:[\\/]/.test(stripped)
  )
}

export function redactRepositoryUrl(url: string | null): string | null {
  if (!url) {
    return null
  }
  const redacted = redactRemoteUrl(url)
  return redacted.includes('@') && redacted.includes('://')
    ? redactRemoteUrl(redacted)
    : redacted
}

function inspectPortableValue(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === 'string') {
    return stringLooksUnsafe(value)
  }
  if (value === null || typeof value !== 'object') {
    return false
  }
  if (seen.has(value)) {
    return true
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.some((item) => inspectPortableValue(item, seen))
  }
  return Object.entries(value).some(([key, child]) => {
    return REASONING_KEYS.has(key) || inspectPortableValue(child, seen)
  })
}

function stringLooksUnsafe(value: string): boolean {
  return (
    textContainsSecrets(value) || stringContainsAbsoluteFilesystemPath(value)
  )
}
