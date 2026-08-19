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
  /がファイルを扱っています$/,
  /が道具を使っています$/,
]

const GOAL_MAX_LENGTH = 80

export function acceptStoredTitle(value: unknown): string | null {
  const sanitized = sanitizeObserverSummary(value)
  if (!sanitized) {
    return null
  }
  if (sanitized.includes('\n') || sanitized.startsWith('/')) {
    return null
  }
  if (sanitized.length > GOAL_MAX_LENGTH) {
    return null
  }
  return acceptGoalCandidate(sanitized)
}

export function clipGoalText(value: string, max = GOAL_MAX_LENGTH): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) {
    return normalized
  }
  const sliced = normalized.slice(0, max)
  const breakAt = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('、'),
    sliced.lastIndexOf(' '),
  )
  const cut = (
    breakAt >= Math.floor(max / 2) ? sliced.slice(0, breakAt) : sliced
  ).replace(/[、。\s]+$/, '')
  return cut
}

export function acceptGoalText(value: unknown): string | null {
  const sanitized = sanitizeObserverSummary(value)
  if (!sanitized) {
    return null
  }
  const firstLine = sanitized.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!firstLine || firstLine.startsWith('/')) {
    return null
  }
  return acceptGoalCandidate(clipGoalText(firstLine))
}

function acceptGoalCandidate(value: string): string | null {
  if (!value) {
    return null
  }
  const lowered = value.toLowerCase()
  if (GENERIC_TITLES.has(lowered) || value === '動いている') {
    return null
  }
  if (GENERIC_PATTERNS.some((pattern) => pattern.test(value))) {
    return null
  }
  if (
    value.includes('まだ分かっていません') ||
    value.includes('変更元不明')
  ) {
    return null
  }
  if (/[\\/]/.test(value) && /\.(md|ya?ml|log|ts|tsx|css|json)$/i.test(value)) {
    return null
  }
  if (/^[0-9a-f]{7,40}$/i.test(value)) {
    return null
  }
  if (/\b(SHA|commit|HEAD|origin)\b/i.test(value)) {
    return null
  }
  return value
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
