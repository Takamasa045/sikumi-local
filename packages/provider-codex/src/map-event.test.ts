import { describe, expect, it } from 'vitest'
import { mapCodexExecEvent, mapCodexNotification } from './map-event.js'
import { classifyCommandRisk, mapCodexSandbox } from './sandbox.js'

describe('codex event mapping', () => {
  it('maps app-server notifications and drops reasoning', () => {
    expect(mapCodexNotification('run-1', 'thread/started', {}, 't')?.type).toBe(
      'run.started',
    )
    expect(
      mapCodexNotification(
        'run-1',
        'item/started',
        {
          item: { type: 'commandExecution' },
        },
        't',
      )?.type,
    ).toBe('command.started')
    expect(
      mapCodexNotification(
        'run-1',
        'item/started',
        {
          item: { type: 'webSearch', query: 'docs' },
        },
        't',
      ),
    ).toMatchObject({ type: 'web.search', query: 'docs' })
    expect(
      mapCodexNotification(
        'run-1',
        'item/started',
        { item: { type: 'reasoning', text: 'hidden' } },
        't',
      ),
    ).toBeNull()
    expect(
      mapCodexNotification(
        'run-1',
        'item/reasoning/textDelta',
        { delta: 'x' },
        't',
      ),
    ).toBeNull()
    expect(
      mapCodexExecEvent('run-1', { type: 'turn.completed' }, 't')?.type,
    ).toBe('run.completed')
    expect(
      mapCodexNotification(
        'run-1',
        'item/started',
        { item: { type: 'fileChange' } },
        't',
      )?.type,
    ).toBe('file.changed')
    expect(
      mapCodexNotification(
        'run-1',
        'item/completed',
        { item: { type: 'commandExecution' } },
        't',
      )?.type,
    ).toBe('command.completed')
    expect(
      mapCodexNotification(
        'run-1',
        'item/completed',
        { item: { type: 'fileChange' } },
        't',
      )?.type,
    ).toBe('file.changed')
    expect(
      mapCodexNotification(
        'run-1',
        'item/completed',
        { item: { type: 'web_search', query: 'q' } },
        't',
      ),
    ).toMatchObject({ type: 'web.search', query: 'q' })
    expect(
      mapCodexNotification(
        'run-1',
        'item/completed',
        { item: { type: 'agentMessage' } },
        't',
      )?.type,
    ).toBe('run.state_changed')
    expect(
      mapCodexNotification(
        'run-1',
        'item/started',
        { item: { type: 'otherTool' } },
        't',
      )?.type,
    ).toBe('tool.started')
    expect(
      mapCodexNotification(
        'run-1',
        'item/completed',
        { item: { type: 'otherTool' } },
        't',
      )?.type,
    ).toBe('tool.completed')
    expect(
      mapCodexNotification('run-1', 'error', { message: 'boom' }, 't'),
    ).toMatchObject({ type: 'run.failed', summary: 'boom' })
    expect(
      mapCodexNotification(
        'run-1',
        'turn/completed',
        { turn: { status: 'interrupted' } },
        't',
      )?.type,
    ).toBe('run.cancelled')
    expect(mapCodexExecEvent('run-1', { type: 'error' }, 't')?.type).toBe(
      'run.failed',
    )
    expect(
      mapCodexExecEvent(
        'run-1',
        { type: 'item.started', item: { type: 'commandExecution' } },
        't',
      )?.type,
    ).toBe('command.started')
    expect(mapCodexExecEvent('run-1', { type: 'unknown' }, 't')).toBeNull()
    expect(classifyCommandRisk('rm file')).toBe('high')
    expect(classifyCommandRisk(undefined)).toBe('low')
    expect(mapCodexSandbox('plan').enableSearch).toBe(false)
    expect(mapCodexSandbox('test-worktree').threadSandbox).toBe(
      'workspace-write',
    )
    expect(() => mapCodexSandbox('publish')).toThrow()
  })
})

describe('codex sandbox mapping', () => {
  it('maps permission profiles without danger-full-access', () => {
    expect(mapCodexSandbox('research').enableSearch).toBe(true)
    expect(mapCodexSandbox('observe').threadSandbox).toBe('read-only')
    expect(mapCodexSandbox('edit-worktree').threadSandbox).toBe(
      'workspace-write',
    )
    expect(() => mapCodexSandbox('unrestricted')).toThrow()
    expect(classifyCommandRisk('git push origin main')).toBe('critical')
    expect(classifyCommandRisk('curl https://example.com')).toBe('medium')
    expect(classifyCommandRisk('git status')).toBe('low')
  })
})
