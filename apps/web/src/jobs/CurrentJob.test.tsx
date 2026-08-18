import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CurrentJob } from './CurrentJob'
import type { Job } from '@sikumi-local/core'

describe('CurrentJob', () => {
  it('shows an empty garden when no job exists', () => {
    render(
      <CurrentJob
        job={null}
        presence={{
          station: 'rest',
          pose: 'idle',
          summary: 'まだ仕事は始まっていません',
          stateName: 'idle',
        }}
        employeeName="サグル"
        busy={false}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('まだ頼んだ仕事はありません')).toBeVisible()
  })

  it('names the selected tool and can cancel a running job', async () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <CurrentJob
        job={sample('codex', 'running')}
        presence={{
          station: 'archive',
          pose: 'reading',
          summary: '読んでいます',
          stateName: 'reading_repository',
        }}
        employeeName="サグル"
        busy={false}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByText('Codex')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '仕事を中止' }))
    expect(onCancel).toHaveBeenCalled()

    rerender(
      <CurrentJob
        job={sample('grok-build', 'completed')}
        presence={{
          station: 'delivery',
          pose: 'completed',
          summary: '完了',
          stateName: 'completed',
        }}
        employeeName="サグル"
        busy={false}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByText('Grok Build')).toBeVisible()

    rerender(
      <CurrentJob
        job={sample('claude-code', 'completed')}
        presence={{
          station: 'delivery',
          pose: 'completed',
          summary: '完了',
          stateName: 'completed',
        }}
        employeeName="サグル"
        busy={false}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByText('Claude Code')).toBeVisible()
  })
})

function sample(
  selectedProvider: Job['selectedProvider'],
  status: Job['status'],
): Job {
  return {
    id: 'job_1',
    workspaceId: 'ws_1',
    employeeId: 'saguru',
    request: '調べて',
    jobType: 'research',
    selectedProvider,
    selectedModel: null,
    permissionProfile: 'research',
    status,
    providerSessionId: null,
    createdAt: 't',
    startedAt: 't',
    completedAt: status === 'running' ? null : 't',
  }
}
