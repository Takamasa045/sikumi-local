import { sanitizeObserverSummary } from '@sikumi-local/observer-core'

const GENERIC_TITLES = new Set([
  '作業',
  '作業中',
  '無題',
  'untitled',
  'new session',
  'new chat',
  '変更元不明の作業',
  'codex',
  'claude',
  'claude code',
  'cursor',
  'grok',
  'grok build',
])

const GENERIC_PATTERNS = [
  /の作業が始まりました$/,
  /の作業が終わりました$/,
  /の様子が届きました$/,
  /が確認を待っています$/,
]

export function acceptStoredTitle(value: unknown): string | null {
  const sanitized = sanitizeObserverSummary(value)
  if (!sanitized) {
    return null
  }
  if (sanitized.includes('\n') || sanitized.startsWith('/')) {
    return null
  }
  if (sanitized.length > 80) {
    return null
  }
  const lowered = sanitized.toLowerCase()
  if (GENERIC_TITLES.has(lowered)) {
    return null
  }
  if (GENERIC_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    return null
  }
  return sanitized
}

export function firstExplicitTitle(
  record: Record<string, unknown> | null | undefined,
  keys: readonly string[] = [
    'customTitle',
    'thread_name',
    'threadName',
    'sessionName',
    'title',
    'name',
  ],
): string | null {
  if (!record) {
    return null
  }
  for (const key of keys) {
    const accepted = acceptStoredTitle(record[key])
    if (accepted) {
      return accepted
    }
  }
  return null
}
