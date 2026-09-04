const CODEX_THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIVE_CODEX_PREFIX = 'live:codex:'
const CODEX_THREAD_URL =
  /^codex:\/\/threads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export type CodexDeepLinkInput = {
  readonly source?: string
  readonly externalSessionId?: string | null
  readonly id?: string | null
}

export type CodexDeepLink = {
  readonly threadId: string
  readonly url: string
}

export function parseCodexDeepLink(
  input: CodexDeepLinkInput,
): CodexDeepLink | null {
  if (input.source !== 'codex') {
    return null
  }
  const raw = input.externalSessionId
  if (typeof raw !== 'string' || raw.length === 0) {
    return null
  }
  if (/[/?#]/.test(raw) || raw.includes(':pid:')) {
    return null
  }
  const threadId = extractCodexThreadId(raw)
  if (!threadId) {
    return null
  }
  return {
    threadId,
    url: buildCodexThreadUrl(threadId),
  }
}

export function isCodexLaunchUrl(
  value: string | null | undefined,
): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const match = CODEX_THREAD_URL.exec(value)
  if (!match?.[1]) {
    return false
  }
  return buildCodexThreadUrl(match[1]) === value
}

export function sanitizeCodexLaunchUrl(
  value: string | null | undefined,
): string | null {
  return isCodexLaunchUrl(value) ? value : null
}

function extractCodexThreadId(raw: string): string | null {
  if (CODEX_THREAD_ID.test(raw)) {
    return raw.toLowerCase()
  }
  if (!raw.startsWith(LIVE_CODEX_PREFIX)) {
    return null
  }
  const rest = raw.slice(LIVE_CODEX_PREFIX.length)
  if (!CODEX_THREAD_ID.test(rest)) {
    return null
  }
  return rest.toLowerCase()
}

function buildCodexThreadUrl(threadId: string): string {
  return `codex://threads/${encodeURIComponent(threadId.toLowerCase())}`
}
