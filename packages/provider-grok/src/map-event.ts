import type { CanonicalEvent } from '@sikumi-local/provider-sdk'

export function mapGrokSessionUpdate(
  runId: string,
  update: unknown,
  occurredAt: string,
): CanonicalEvent | null {
  const body = isPlainObject(update) ? update : {}
  const nested = isPlainObject(body.update) ? body.update : body
  const kind =
    typeof nested.sessionUpdate === 'string'
      ? nested.sessionUpdate
      : typeof body.sessionUpdate === 'string'
        ? body.sessionUpdate
        : undefined

  if (!kind || kind.includes('thought') || kind.includes('reasoning')) {
    return kind?.includes('thought') || kind?.includes('reasoning')
      ? null
      : null
  }

  if (kind === 'agent_message_chunk') {
    return {
      type: 'run.state_changed',
      runId,
      occurredAt,
      summary: '調査結果を整理しています',
      state: 'organizing',
    }
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const title = typeof nested.title === 'string' ? nested.title : ''
    if (/search|web/i.test(title)) {
      return {
        type: 'web.search',
        runId,
        occurredAt,
        summary: '公式情報を探しています',
      }
    }
    if (/read|glob|grep/i.test(title)) {
      return {
        type: 'repository.read',
        runId,
        occurredAt,
        summary: 'この工房の資料を読んでいます',
      }
    }
    return {
      type: kind === 'tool_call' ? 'tool.started' : 'tool.completed',
      runId,
      occurredAt,
      summary:
        kind === 'tool_call' ? '作業を進めています' : '作業が終わりました',
    }
  }
  if (kind === 'plan') {
    return {
      type: 'run.state_changed',
      runId,
      occurredAt,
      summary: '計画を立てています',
      state: 'planning',
    }
  }
  return null
}

export function isDuplicateNonTerminalProgress(
  previous: CanonicalEvent | undefined,
  next: CanonicalEvent,
): boolean {
  if (!previous || previous.type !== 'run.state_changed') {
    return false
  }
  if (next.type !== 'run.state_changed') {
    return false
  }
  return previous.summary === next.summary && previous.state === next.state
}

export function permissionOptionId(
  options: unknown,
  decision: 'approved' | 'denied',
): string | undefined {
  if (!Array.isArray(options)) {
    return undefined
  }
  const preferred =
    decision === 'approved'
      ? ['allow_once', 'allow-once', 'allow']
      : ['reject_once', 'reject-once', 'reject', 'deny']
  for (const name of preferred) {
    const match = options.find((item) => {
      const option = isPlainObject(item) ? item : {}
      return option.kind === name || option.optionId === name
    })
    if (isPlainObject(match) && typeof match.optionId === 'string') {
      return match.optionId
    }
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
