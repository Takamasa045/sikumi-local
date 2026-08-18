import type { CanonicalEvent } from '@sikumi-local/provider-sdk'
import { extractJsonObject } from '@sikumi-local/provider-sdk'

export function mapCodexNotification(
  runId: string,
  method: string,
  params: unknown,
  occurredAt: string,
): CanonicalEvent | null {
  const body = isPlainObject(params) ? params : {}
  const item = isPlainObject(body.item) ? body.item : undefined
  const itemType = typeof item?.type === 'string' ? item.type : undefined

  if (itemType === 'reasoning') {
    return null
  }

  switch (method) {
    case 'thread/started':
      return event(runId, occurredAt, 'run.started', '仕事を始めます')
    case 'turn/started':
      return state(runId, occurredAt, 'preparing', '仕事を進めています')
    case 'item/started':
      return mapItemStarted(runId, occurredAt, itemType, item)
    case 'item/completed':
      return mapItemCompleted(runId, occurredAt, itemType, item)
    case 'turn/completed': {
      const turn = isPlainObject(body.turn) ? body.turn : {}
      if (turn.status === 'interrupted') {
        return event(runId, occurredAt, 'run.cancelled', '仕事を中止しました')
      }
      return event(runId, occurredAt, 'run.completed', '調査が完了しました')
    }
    case 'error':
      return event(
        runId,
        occurredAt,
        'run.failed',
        typeof body.message === 'string'
          ? body.message
          : '調査を完了できませんでした',
      )
    case 'item/agentMessage/delta':
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/summaryPartAdded':
      return null
    default:
      return null
  }
}

export function mapCodexExecEvent(
  runId: string,
  raw: Record<string, unknown>,
  occurredAt: string,
): CanonicalEvent | null {
  const type = typeof raw.type === 'string' ? raw.type : ''
  if (type.includes('reasoning')) {
    return null
  }
  if (type === 'thread.started' || type === 'thread/started') {
    return event(runId, occurredAt, 'run.started', '仕事を始めます')
  }
  if (type === 'turn.started' || type === 'turn/started') {
    return state(runId, occurredAt, 'preparing', '仕事を進めています')
  }
  if (type === 'turn.completed' || type === 'turn/completed') {
    return event(runId, occurredAt, 'run.completed', '調査が完了しました')
  }
  if (type === 'error') {
    return event(runId, occurredAt, 'run.failed', '調査を完了できませんでした')
  }
  const item = isPlainObject(raw.item) ? raw.item : undefined
  const itemType = typeof item?.type === 'string' ? item.type : undefined
  if (type === 'item.started' || type === 'item/started') {
    return mapItemStarted(runId, occurredAt, itemType, item)
  }
  if (type === 'item.completed' || type === 'item/completed') {
    return mapItemCompleted(runId, occurredAt, itemType, item)
  }
  return null
}

export function agentMessageText(
  item: Record<string, unknown> | undefined,
): string {
  if (!item) {
    return ''
  }
  if (typeof item.text === 'string') {
    return item.text
  }
  return ''
}

export function structuredFromAgentMessage(
  item: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  return extractJsonObject(agentMessageText(item))
}

function mapItemStarted(
  runId: string,
  occurredAt: string,
  itemType: string | undefined,
  item: Record<string, unknown> | undefined,
): CanonicalEvent | null {
  if (itemType === 'commandExecution') {
    return {
      type: 'command.started',
      runId,
      occurredAt,
      summary: 'コマンドを実行しています',
    }
  }
  if (itemType === 'fileChange') {
    return {
      type: 'file.changed',
      runId,
      occurredAt,
      summary: 'ファイルを確認しています',
    }
  }
  if (itemType === 'webSearch' || itemType === 'web_search') {
    return {
      type: 'web.search',
      runId,
      occurredAt,
      summary: '公式情報を探しています',
      ...(typeof item?.query === 'string' ? { query: item.query } : {}),
    }
  }
  if (itemType === 'agentMessage') {
    return state(runId, occurredAt, 'organizing', '調査結果を整理しています')
  }
  return {
    type: 'tool.started',
    runId,
    occurredAt,
    summary: '作業を進めています',
  }
}

function mapItemCompleted(
  runId: string,
  occurredAt: string,
  itemType: string | undefined,
  item: Record<string, unknown> | undefined,
): CanonicalEvent | null {
  if (itemType === 'commandExecution') {
    return {
      type: 'command.completed',
      runId,
      occurredAt,
      summary: 'コマンドが終わりました',
    }
  }
  if (itemType === 'fileChange') {
    return {
      type: 'file.changed',
      runId,
      occurredAt,
      summary: 'ファイルが更新されました',
    }
  }
  if (itemType === 'webSearch' || itemType === 'web_search') {
    return {
      type: 'web.search',
      runId,
      occurredAt,
      summary: '公式情報を探しています',
      ...(typeof item?.query === 'string' ? { query: item.query } : {}),
    }
  }
  if (itemType === 'agentMessage') {
    return state(runId, occurredAt, 'delivering', '成果を届けています')
  }
  return {
    type: 'tool.completed',
    runId,
    occurredAt,
    summary: '作業が終わりました',
  }
}

function event(
  runId: string,
  occurredAt: string,
  type: CanonicalEvent['type'],
  summary: string,
): CanonicalEvent {
  return { type, runId, occurredAt, summary } as CanonicalEvent
}

function state(
  runId: string,
  occurredAt: string,
  stateName: 'preparing' | 'organizing' | 'delivering',
  summary: string,
): CanonicalEvent {
  return {
    type: 'run.state_changed',
    runId,
    occurredAt,
    summary,
    state: stateName,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
