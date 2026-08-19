import { describe, expect, it } from 'vitest'
import { resolveGardenPresence } from './presence'

describe('garden presence', () => {
  it('moves from idle to archive, observatory, waiting, and delivery from canonical events', () => {
    expect(resolveGardenPresence({ job: null, events: [] }).station).toBe(
      'rest',
    )
    expect(
      resolveGardenPresence({
        job: sampleJob('running'),
        events: [event('repository.read', 'この工房の資料を読んでいます')],
      }),
    ).toMatchObject({
      station: 'archive',
      summary: 'この工房の資料を読んでいます',
    })
    expect(
      resolveGardenPresence({
        job: sampleJob('running'),
        events: [event('web.search', '外の世界を調べています')],
      }).station,
    ).toBe('observatory')
    expect(
      resolveGardenPresence({
        job: sampleJob('waiting_for_user'),
        events: [event('approval.requested', '確認')],
      }).station,
    ).toBe('waiting')
    expect(
      resolveGardenPresence({
        job: sampleJob('completed'),
        events: [event('artifact.created', '届けました')],
      }).station,
    ).toBe('delivery')
    expect(
      resolveGardenPresence({
        job: sampleJob('failed'),
        events: [event('run.failed', '失敗')],
      }).summary,
    ).toBe('調査を完了できませんでした')
    expect(
      resolveGardenPresence({
        job: sampleJob('cancelled'),
        events: [],
      }).summary,
    ).toBe('仕事を中止しました')
    expect(
      resolveGardenPresence({
        job: sampleJob('running'),
        events: [event('file.changed', '作業台で整理しています')],
      }).station,
    ).toBe('workbench')
    expect(
      resolveGardenPresence({
        job: { ...sampleJob('running'), status: 'preparing' },
        events: [],
      }).summary,
    ).toBe('仕事の準備をしています')
    expect(
      resolveGardenPresence({
        job: {
          ...sampleJob('completed'),
          status: 'completed_with_invalid_result',
        },
        events: [],
      }).summary,
    ).toBe('結果の形式が正しくありません')
    expect(
      resolveGardenPresence({
        job: { ...sampleJob('running'), status: 'queued' },
        events: [],
      }).summary,
    ).toBe('仕事の準備をしています')
    expect(
      resolveGardenPresence({
        job: sampleJob('running'),
        events: [undefined as never, event('web.search', '')],
      }),
    ).toMatchObject({
      station: 'observatory',
      summary: '外の世界を調べています',
    })
    expect(
      resolveGardenPresence({
        job: sampleJob('running'),
        events: [
          {
            id: 'other',
            jobId: 'job_1',
            runId: 'run_1',
            type: 'run.state_changed',
            payload: {},
            occurredAt: 't',
          },
        ],
      }).summary,
    ).toBe('仕事を進めています')
    expect(
      resolveGardenPresence({
        job: sampleJob('running'),
        events: [],
        stateMap: { states: {}, eventBindings: {} },
      }),
    ).toMatchObject({ station: 'rest', pose: 'idle', stateName: 'idle' })
  })
})

function sampleJob(
  status: 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'cancelled',
) {
  return {
    id: 'job_1',
    workspaceId: 'ws_1',
    employeeId: 'saguru',
    request: '調べて',
    jobType: 'research',
    selectedProvider: 'fake' as const,
    selectedModel: null,
    permissionProfile: 'research' as const,
    status,
    providerSessionId: null,
    createdAt: 't',
    startedAt: 't',
    completedAt: status === 'running' ? null : 't',
  }
}

function event(
  type:
    | 'repository.read'
    | 'web.search'
    | 'approval.requested'
    | 'artifact.created'
    | 'run.failed'
    | 'file.changed',
  summary: string,
) {
  return {
    id: type,
    jobId: 'job_1',
    runId: 'run_1',
    type,
    payload: { summary },
    occurredAt: 't',
  }
}
