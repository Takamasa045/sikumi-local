import type {
  GardenStationId,
  Job,
  PersistedEvent,
  ShikumiEventType,
} from '@sikumi-local/core'

export interface GardenStateBinding {
  readonly station: GardenStationId
  readonly pose: string
  readonly summary: string
}

export interface GardenStateMap {
  readonly states: Readonly<Record<string, GardenStateBinding>>
  readonly eventBindings: Readonly<Partial<Record<ShikumiEventType, string>>>
}

export interface GardenPresence {
  readonly station: GardenStationId
  readonly pose: string
  readonly summary: string
  readonly stateName: string
}

const FALLBACK_STATES: GardenStateMap = {
  states: {
    idle: {
      station: 'rest',
      pose: 'idle',
      summary: 'まだ仕事は始まっていません',
    },
    reading_repository: {
      station: 'archive',
      pose: 'reading',
      summary: 'この工房の資料を読んでいます',
    },
    searching_web: {
      station: 'observatory',
      pose: 'searching',
      summary: '外の世界を調べています',
    },
    working: {
      station: 'workbench',
      pose: 'working',
      summary: '作業台で整理しています',
    },
    waiting_for_user: {
      station: 'waiting',
      pose: 'waiting',
      summary: 'あなたの確認を待っています',
    },
    delivering: {
      station: 'delivery',
      pose: 'delivering',
      summary: '成果を納品台へ運んでいます',
    },
    completed: {
      station: 'delivery',
      pose: 'completed',
      summary: '調査が完了しました',
    },
    failed: {
      station: 'rest',
      pose: 'failed',
      summary: '調査を完了できませんでした',
    },
    cancelled: {
      station: 'rest',
      pose: 'cancelled',
      summary: '仕事を中止しました',
    },
  },
  eventBindings: {
    'repository.read': 'reading_repository',
    'web.search': 'searching_web',
    'file.changed': 'working',
    'approval.requested': 'waiting_for_user',
    'artifact.created': 'delivering',
    'run.completed': 'completed',
    'run.failed': 'failed',
    'run.cancelled': 'cancelled',
  },
}

export function resolveGardenPresence(input: {
  readonly job: Job | null
  readonly events: readonly PersistedEvent[]
  readonly stateMap?: GardenStateMap
}): GardenPresence {
  const stateMap = input.stateMap ?? FALLBACK_STATES
  if (!input.job) {
    return presenceFrom(stateMap, 'idle', 'まだ仕事は始まっていません')
  }
  if (input.job.status === 'failed') {
    return presenceFrom(stateMap, 'failed', statusLabel(input.job.status))
  }
  if (input.job.status === 'cancelled') {
    return presenceFrom(stateMap, 'cancelled', statusLabel(input.job.status))
  }
  if (
    input.job.status === 'completed' ||
    input.job.status === 'completed_with_invalid_result'
  ) {
    return presenceFrom(stateMap, 'completed', statusLabel(input.job.status))
  }
  if (input.job.status === 'waiting_for_user') {
    return presenceFrom(
      stateMap,
      'waiting_for_user',
      statusLabel(input.job.status),
    )
  }

  for (let index = input.events.length - 1; index >= 0; index -= 1) {
    const event = input.events[index]
    if (!event) {
      continue
    }
    const stateName = stateMap.eventBindings[event.type]
    if (stateName && stateMap.states[stateName]) {
      const summary =
        typeof event.payload.summary === 'string' &&
        event.payload.summary.length > 0
          ? event.payload.summary
          : stateMap.states[stateName].summary
      return presenceFrom(stateMap, stateName, summary)
    }
  }

  if (input.job.status === 'preparing' || input.job.status === 'queued') {
    return presenceFrom(stateMap, 'idle', '仕事の準備をしています')
  }
  return presenceFrom(stateMap, 'idle', statusLabel(input.job.status))
}

export function statusLabel(status: Job['status']): string {
  switch (status) {
    case 'waiting_for_user':
      return 'あなたの確認を待っています'
    case 'running':
    case 'preparing':
      return '仕事を進めています'
    case 'completed':
      return '調査が完了しました'
    case 'failed':
      return '調査を完了できませんでした'
    case 'cancelled':
      return '仕事を中止しました'
    case 'completed_with_invalid_result':
      return '結果の形式が正しくありません'
    default:
      return 'まだ仕事は始まっていません'
  }
}

function presenceFrom(
  stateMap: GardenStateMap,
  stateName: string,
  summary: string,
): GardenPresence {
  const state = stateMap.states[stateName] ?? stateMap.states.idle
  return {
    station: state?.station ?? 'rest',
    pose: state?.pose ?? 'idle',
    summary,
    stateName,
  }
}
