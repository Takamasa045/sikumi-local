import type { CanonicalEvent } from '@sikumi-local/provider-sdk'

export function mapClaudeStreamEvent(
  runId: string,
  raw: Record<string, unknown>,
  occurredAt: string,
): CanonicalEvent | null {
  const type = typeof raw.type === 'string' ? raw.type : ''
  if (type.includes('thinking') || type.includes('reasoning')) {
    return null
  }
  if (type === 'system' && raw.subtype === 'init') {
    return {
      type: 'run.started',
      runId,
      occurredAt,
      summary: '仕事を始めます',
    }
  }
  if (type === 'assistant') {
    return {
      type: 'run.state_changed',
      runId,
      occurredAt,
      summary: '調査結果を整理しています',
      state: 'organizing',
    }
  }
  if (type === 'result' && raw.subtype === 'success') {
    return {
      type: 'run.completed',
      runId,
      occurredAt,
      summary: '調査が完了しました',
    }
  }
  if (type === 'result' && raw.subtype === 'error') {
    return {
      type: 'run.failed',
      runId,
      occurredAt,
      summary: '調査を完了できませんでした',
    }
  }
  if (type === 'tool_use' || raw.subtype === 'tool_use') {
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (/web|search/i.test(name)) {
      return {
        type: 'web.search',
        runId,
        occurredAt,
        summary: '公式情報を探しています',
      }
    }
    if (/read|glob|grep/i.test(name)) {
      return {
        type: 'repository.read',
        runId,
        occurredAt,
        summary: 'この工房の資料を読んでいます',
      }
    }
    return {
      type: 'tool.started',
      runId,
      occurredAt,
      summary: '作業を進めています',
    }
  }
  return null
}

export function claudeSessionId(
  raw: Record<string, unknown>,
): string | undefined {
  if (typeof raw.session_id === 'string') {
    return raw.session_id
  }
  if (typeof raw.sessionId === 'string') {
    return raw.sessionId
  }
  return undefined
}

export function claudeResultText(raw: Record<string, unknown>): string {
  if (typeof raw.result === 'string') {
    return raw.result
  }
  const message = isPlainObject(raw.message) ? raw.message : {}
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .map((item) => {
      const block = isPlainObject(item) ? item : {}
      return typeof block.text === 'string' ? block.text : ''
    })
    .join('')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
